// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PlanSchedule, ReadingPlanState } from "@/lib/api";
import { addDays, isoDate } from "@/lib/dates";

const calls: { cmd: string; args: unknown }[] = [];
let states: ReadingPlanState[] = [];

const schedule = (key: string, total: number): PlanSchedule => ({
  key,
  days: Array.from({ length: total }, (_, i) => ({ day: i + 1, startBook: 19, startChapter: i + 1, endBook: 19, endChapter: i + 1 })),
});
const catalog = [schedule("bible-365-v1", 365), schedule("greek-90-v1", 90), schedule("psalms-30-v1", 30)];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    calls.push({ cmd, args });
    if (cmd === "reading_plan_catalog") return catalog;
    if (cmd === "reading_plans") return states;
    return undefined;
  }),
  convertFileSrc: (p: string) => p,
}));

const push = vi.fn();
const toast = vi.fn();
let userVersion = 0;
vi.mock("@/app", () => ({
  useApp: () => ({ publications: [], lang: "E", bibles: {}, openTarget: vi.fn(), push, toast, userVersion }),
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { ReadingPlansSection, TodayReadingCard } from "./reading-plans";

const daysAgo = (n: number) => isoDate(addDays(new Date(), -n));
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const plan = (over: Partial<ReadingPlanState> = {}): ReadingPlanState => ({
  guid: "g1",
  planKey: "bible-365-v1",
  startDate: daysAgo(20),
  done: range(20),
  ...over,
});
const sent = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);

beforeEach(() => {
  calls.length = 0;
  states = [];
  userVersion = 0;
  toast.mockClear();
  push.mockClear();
});
afterEach(cleanup);

async function startDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Start a plan" }));
  return screen.findByRole("dialog");
}

async function pick(dialog: HTMLElement, title: string) {
  fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Plan" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: title }));
}

describe("ReadingPlansSection", () => {
  it("starts a plan, counting the days before today as read while the box is on", async () => {
    render(<ReadingPlansSection />);
    expect(await screen.findByText("No reading plan yet")).toBeTruthy();
    const dialog = await startDialog();
    await pick(dialog, "Greek Scriptures in 90 days");
    fireEvent.change(within(dialog).getByLabelText("Start date"), { target: { value: daysAgo(10) } });
    const box = within(dialog).getByRole("checkbox", { name: "I've already read the days before today" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(sent("start_reading_plan")).toEqual([{ planKey: "greek-90-v1", startDate: daysAgo(10), readBefore: 11 }]),
    );
  });

  it("sends no read days when the box is off", async () => {
    render(<ReadingPlansSection />);
    const dialog = await startDialog();
    await pick(dialog, "Greek Scriptures in 90 days");
    fireEvent.change(within(dialog).getByLabelText("Start date"), { target: { value: daysAgo(10) } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "I've already read the days before today" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(sent("start_reading_plan")).toEqual([{ planKey: "greek-90-v1", startDate: daysAgo(10), readBefore: null }]),
    );
  });

  it("does not offer a plan that is already running", async () => {
    states = [plan()];
    render(<ReadingPlansSection />);
    const dialog = await startDialog();
    fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Plan" }), { key: "Enter" });
    expect(await screen.findByRole("option", { name: "Psalms in 30 days" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Bible in a year" })).toBeNull();
  });

  it("shows the progress and how far behind the reading is", async () => {
    states = [plan()];
    render(<ReadingPlansSection />);
    expect(await screen.findByText("20 / 365")).toBeTruthy();
    expect(screen.queryByText(/behind/)).toBeNull();
    cleanup();
    states = [plan({ done: range(18) })];
    render(<ReadingPlansSection />);
    expect(await screen.findByText("2 days behind")).toBeTruthy();
  });

  it("ticks a day and reloads the plans", async () => {
    states = [plan()];
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<ReadingPlansSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Show days" }));
    expect(scroll).toHaveBeenCalledWith({ block: "center" });
    scroll.mockRestore();
    const before = sent("reading_plans").length;
    fireEvent.click(screen.getByRole("checkbox", { name: "Day 21" }));
    await waitFor(() => expect(sent("set_reading_day")).toEqual([{ guid: "g1", day: 21, done: true }]));
    await waitFor(() => expect(sent("reading_plans").length).toBe(before + 1));
  });

  it("deletes a plan after asking", async () => {
    states = [plan()];
    render(<ReadingPlansSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete reading plan" }));
    const alert = await screen.findByRole("alertdialog");
    expect(within(alert).getByText("Delete this reading plan? Your progress in it is lost.")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(sent("delete_reading_plan")).toEqual([{ guid: "g1" }]));
  });

  it("sends one start for a double click", async () => {
    render(<ReadingPlansSection />);
    const dialog = await startDialog();
    const button = within(dialog).getByRole("button", { name: "Start" }) as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent("start_reading_plan")).toHaveLength(1);
  });

  it("closes the start dialog when the last offered plan starts elsewhere", async () => {
    states = [plan(), plan({ guid: "g2", planKey: "greek-90-v1" })];
    const { rerender } = render(<ReadingPlansSection />);
    const dialog = await startDialog();
    expect(within(dialog).getByRole("combobox", { name: "Plan" }).textContent).toBe("Psalms in 30 days");
    states = [...states, plan({ guid: "g3", planKey: "psalms-30-v1" })];
    userVersion = 1;
    rerender(<ReadingPlansSection />);
    // The section is still on screen (a throw would have unmounted it) and lists the new plan.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Psalms in 30 days")).toBeTruthy();
    expect(screen.getByText("Bible in a year")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start a plan" })).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("says when a plan that has not begun starts", async () => {
    const start = addDays(new Date(), 3);
    states = [plan({ startDate: isoDate(start), done: [] })];
    render(<ReadingPlansSection />);
    const date = start.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    expect(await screen.findByText(`Starts on ${date}`)).toBeTruthy();
    expect(screen.queryByText(/^Started /)).toBeNull();
    cleanup();
    states = [plan()];
    render(<ReadingPlansSection />);
    const begun = addDays(new Date(), -20).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    expect(await screen.findByText(`Started ${begun}`)).toBeTruthy();
  });

  it("leaves out a plan it does not know", async () => {
    states = [plan({ planKey: "nt-60-v2" })];
    render(<ReadingPlansSection />);
    expect(await screen.findByText("No reading plan yet")).toBeTruthy();
    expect(screen.queryByText(/ \/ /)).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("lets a plan with an unreadable start date be deleted, and does not offer it again", async () => {
    states = [plan({ planKey: "psalms-30-v1", startDate: "2026-02-30" })];
    render(<ReadingPlansSection />);
    expect(await screen.findByText("Psalms in 30 days")).toBeTruthy();
    expect(screen.getByText("The start date of this plan can't be read.")).toBeTruthy();
    const dialog = await startDialog();
    fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Plan" }), { key: "Enter" });
    expect(await screen.findByRole("option", { name: "Bible in a year" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Psalms in 30 days" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Delete reading plan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(sent("delete_reading_plan")).toEqual([{ guid: "g1" }]));
  });

  it("points to the library when there is no Bible to open passages in", async () => {
    states = [plan()];
    render(<ReadingPlansSection />);
    expect(await screen.findByText("Download a Bible to open passages.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(push).toHaveBeenCalledWith({ name: "library", tab: "publications" });
  });
});

describe("TodayReadingCard", () => {
  it("renders nothing without a plan", async () => {
    const { container } = render(<TodayReadingCard />);
    await waitFor(() => expect(sent("reading_plans").length).toBeGreaterThan(0));
    expect(container.innerHTML).toBe("");
    expect(screen.queryByText("Today's reading")).toBeNull();
  });

  it("shows today's passage of a running plan, ticked or not, and ticks it", async () => {
    states = [plan({ done: range(18) })];
    render(<TodayReadingCard />);
    expect(await screen.findByText("Today's reading")).toBeTruthy();
    expect(screen.getByText("Bible in a year")).toBeTruthy();
    expect(screen.getByText("Psalms 21")).toBeTruthy();
    expect(screen.getByText("2 days behind")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Day 21" }));
    await waitFor(() => expect(sent("set_reading_day")).toEqual([{ guid: "g1", day: 21, done: true }]));
    cleanup();
    states = [plan({ done: range(21) })];
    render(<TodayReadingCard />);
    const box = (await screen.findByRole("checkbox", { name: "Day 21" })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.queryByText(/behind/)).toBeNull();
  });

  it("shows when an upcoming plan starts, with day 1 and no checkbox", async () => {
    const start = addDays(new Date(), 3);
    states = [plan({ startDate: isoDate(start), done: [] })];
    render(<TodayReadingCard />);
    const date = start.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    expect(await screen.findByText(`Starts on ${date}`)).toBeTruthy();
    expect(screen.getByText("Psalms 1")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("picks up an ended schedule at the first unread day", async () => {
    states = [plan({ startDate: daysAgo(400), done: [1, 2, 4] })];
    render(<TodayReadingCard />);
    expect(await screen.findByText("Schedule ended · 362 days left")).toBeTruthy();
    expect(screen.getByText("Psalms 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Day 3" }));
    await waitFor(() => expect(sent("set_reading_day")).toEqual([{ guid: "g1", day: 3, done: true }]));
  });

  it("marks a finished plan", async () => {
    states = [plan({ planKey: "psalms-30-v1", startDate: daysAgo(40), done: range(30) })];
    render(<TodayReadingCard />);
    expect(await screen.findByText("Finished")).toBeTruthy();
    expect(screen.getByText("Psalms in 30 days")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
