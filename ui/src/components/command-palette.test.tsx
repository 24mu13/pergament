// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PlanSchedule, PubCard, ReadingPlanState, SearchResponse, Target } from "@/lib/api";
import { addDays, isoDate } from "@/lib/dates";

const { push, searchPublications, lastVerse, datedPage, loadBooks, toast, openTarget, readingPlanCatalog, readingPlans, app } = vi.hoisted(() => ({
  readingPlanCatalog: vi.fn(),
  readingPlans: vi.fn(),
  app: { noBible: false },
  push: vi.fn(),
  searchPublications: vi.fn(),
  lastVerse: vi.fn(),
  datedPage: vi.fn(),
  loadBooks: vi.fn(),
  toast: vi.fn(),
  openTarget: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, searchPublications, lastVerse, datedPage, readingPlanCatalog, readingPlans } };
});
const publications: PubCard[] = [
  { dir: "w26_1", title: "The Watchtower", shortTitle: "Watchtower", symbol: "w", keySymbol: "w", year: 2026, issueTag: "1", mepsLanguage: 0, langCode: "X", publicationType: null, isBible: false, cover: null },
  { dir: "lff", title: "Enjoy Life Forever!", shortTitle: "Enjoy Life", symbol: "lff", keySymbol: "lff", year: 2026, issueTag: "", mepsLanguage: 0, langCode: "X", publicationType: null, isBible: false, cover: null },
  { dir: "bible", title: "Bible", shortTitle: "Bible", symbol: "nwtsty", keySymbol: "nwtsty", year: 2026, issueTag: "", mepsLanguage: 0, langCode: "X", publicationType: null, isBible: true, cover: null },
];

vi.mock("@/lib/note-links", () => ({ loadBooks }));

vi.mock("@/app", () => ({
  useApp: () => ({ publications: app.noBible ? publications.filter((p) => !p.isBible) : publications, push, openTarget, toast, lang: "X", bibles: { X: "nwtsty" }, view: { name: "home" }, userVersion: 0 }),
}));

import { CommandPalette } from "./command-palette";

const schedule = (key: string, total: number): PlanSchedule => ({
  key,
  days: Array.from({ length: total }, (_, i) => ({ day: i + 1, startBook: 2, startChapter: i + 1, endBook: 2, endChapter: i + 1 })),
});
const daysAgo = (n: number) => isoDate(addDays(new Date(), -n));
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
let planStates: ReadingPlanState[] = [];

beforeEach(() => {
  planStates = [];
  app.noBible = false;
  readingPlanCatalog.mockResolvedValue([schedule("bible-365-v1", 365), schedule("psalms-30-v1", 30)]);
  readingPlans.mockImplementation(async () => planStates);
});

afterEach(() => {
  cleanup();
  openTarget.mockReset();
  push.mockReset();
  searchPublications.mockReset();
  lastVerse.mockReset();
  datedPage.mockReset();
  loadBooks.mockReset();
  toast.mockReset();
});

describe("CommandPalette", () => {
  it("opens with Ctrl+K and Meta+K, but ignores Alt combinations", () => {
    render(<CommandPalette />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(window, { key: "k", altKey: true, ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes with Escape", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders action and publication groups and filters publication titles locally", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByText("Actions")).toBeTruthy();
    expect(screen.getByText("Publications")).toBeTruthy();
    expect(screen.getByText("The Watchtower")).toBeTruthy();
    expect(screen.getByText("Enjoy Life Forever!")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "watchtower" } });
    expect(screen.getByText("The Watchtower")).toBeTruthy();
    expect(screen.queryByText("Enjoy Life Forever!")).toBeNull();
  });

  it("clears the query and results when closed and reopened", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "watchtower" } });
    expect(screen.getByText("The Watchtower")).toBeTruthy();
    expect(screen.queryByText("Enjoy Life Forever!")).toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("The Watchtower")).toBeTruthy();
    expect(screen.getByText("Enjoy Life Forever!")).toBeTruthy();
  });

  it("opens a publication when its command is selected", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("The Watchtower"));
    expect(push).toHaveBeenCalledWith({ name: "publication", dir: "w26_1" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("loads debounced full-text previews and opens a result", async () => {
    const target: Target = { publication: "w26_1", kind: { documentParagraph: { document: 1, paragraph: 2 } } };
    const response: SearchResponse = { hits: [{ title: "Search hit", publicationTitle: "The Watchtower", snippet: "A matching excerpt", target }], status: { state: "ready", total: 1, indexed: 1, failed: 0, unanchored: 0 } };
    searchPublications.mockResolvedValue(response);
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "matching" } });
    expect(screen.queryByText("Search hit")).toBeNull();
    expect(await screen.findByText("Search hit", {}, { timeout: 1000 })).toBeTruthy();
    expect(searchPublications).toHaveBeenCalledWith({ query: "matching", scope: { kind: "all" }, limit: 8, offset: 0 });
    fireEvent.click(screen.getByText("Search hit"));
    expect(push).toHaveBeenCalledWith({ name: "reader", target, fromSearch: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps working when typing on after full-text results appeared", async () => {
    const target: Target = { publication: "bible", kind: { documentParagraph: { document: 1, paragraph: 1 } } };
    searchPublications.mockResolvedValue({ hits: [{ title: "John 1", publicationTitle: "Bible", snippet: "In the beginning", target }], status: { state: "ready", total: 1, indexed: 1, failed: 0, unanchored: 0 } });
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByText("Full-text results")).toBeNull();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Jo 1" } });
    expect(await screen.findByText("John 1", {}, { timeout: 1000 })).toBeTruthy();
    fireEvent.change(input, { target: { value: "Jo 1:" } });
    expect(await screen.findByText("John 1", {}, { timeout: 1000 })).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("opens Search with the palette query", async () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "phrase" } });
    await waitFor(() => expect(screen.getByText("Search all text")).toBeTruthy());
    fireEvent.click(screen.getByText("Search all text"));
    expect(push).toHaveBeenCalledWith({ name: "search", query: "phrase" });
  });

  it("keeps local commands and publications usable when full-text search fails", async () => {
    searchPublications.mockRejectedValue(new Error("search unavailable"));
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "watchtower" } });

    await waitFor(() => expect(searchPublications).toHaveBeenCalled());
    expect(screen.getByText("The Watchtower")).toBeTruthy();
    fireEvent.click(screen.getByText("The Watchtower"));
    expect(push).toHaveBeenCalledWith({ name: "publication", dir: "w26_1" });
  });

  it("offers Bible reference, daily text, and shortcut commands", async () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByText("Open Bible reference")).toBeTruthy();
    expect(screen.getByText("Daily Text")).toBeTruthy();
    expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
  });

  it("opens the shortcut reference dialog and lists shortcuts", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("Keyboard shortcuts"));
    expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeTruthy();
    expect(screen.getByText("Open command palette")).toBeTruthy();
    expect(screen.getByText("Go to a verse")).toBeTruthy();
  });

  it("opens a valid Bible reference and reports missing or invalid references", async () => {
    loadBooks.mockResolvedValue([{ number: 58, title: "Hebrews", chapters: 13, abbreviation: "Heb" }]);
    lastVerse.mockResolvedValue(25);
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Heb 10:24" } });
    fireEvent.click(screen.getByText("Open Bible reference"));
    await waitFor(() => expect(openTarget).toHaveBeenCalled());

    loadBooks.mockRejectedValue(new Error("missing Bible"));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("Open Bible reference"));
    await waitFor(() => expect(toast).toHaveBeenCalled());
  });

  it("opens daily text and toasts when unavailable", async () => {
    datedPage.mockResolvedValue({ target: { publication: "daily", kind: { documentParagraph: { document: 1, paragraph: 1 } } } });
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("Daily Text"));
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "reader" })));
    datedPage.mockResolvedValue(null);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("Daily Text"));
    await waitFor(() => expect(toast).toHaveBeenCalled());
  });

  it("ignores stale full-text responses after a later query", async () => {
    const pending: Record<string, (response: SearchResponse) => void> = {};
    searchPublications.mockImplementation(({ query }: { query: string }) => new Promise<SearchResponse>((resolve) => {
      pending[query] = resolve;
    }));
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "first" } });
    await waitFor(() => expect(pending.first).toBeDefined());
    fireEvent.change(input, { target: { value: "second" } });
    await waitFor(() => expect(pending.second).toBeDefined());
    const result = (title: string): SearchResponse => ({
      hits: [{ title, publicationTitle: "The Watchtower", snippet: "excerpt", target: { publication: "w26_1", kind: { documentParagraph: { document: 1, paragraph: 1 } } } }],
      status: { state: "ready", total: 1, indexed: 1, failed: 0, unanchored: 0 },
    });
    pending.second(result("second current"));
    expect(await screen.findByText("second current")).toBeTruthy();
    pending.first(result("second stale"));
    await waitFor(() => expect(screen.queryByText("second stale")).toBeNull());
    expect(screen.getByText("second current")).toBeTruthy();
  });

  describe("reading plans", () => {
    const open = () => {
      render(<CommandPalette />);
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    };

    it("shows no reading plans group without a plan", async () => {
      open();
      await waitFor(() => expect(readingPlans).toHaveBeenCalled());
      expect(screen.queryByText("Reading plans")).toBeNull();
    });

    it("lists each plan with today's passage, progress and behind count", async () => {
      planStates = [{ guid: "g1", planKey: "bible-365-v1", startDate: daysAgo(20), done: range(18) }];
      open();
      expect(await screen.findByText("Reading plans")).toBeTruthy();
      expect(screen.getByText("Bible in a year")).toBeTruthy();
      expect(screen.getByText("Day 21 · Exodus 21")).toBeTruthy();
      expect(screen.getByText("18 / 365")).toBeTruthy();
      expect(screen.getByText("2 days behind")).toBeTruthy();
      expect(screen.getByRole("progressbar", { name: "Bible in a year" })).toBeTruthy();
    });

    it("filters plans by title", async () => {
      planStates = [
        { guid: "g1", planKey: "bible-365-v1", startDate: daysAgo(0), done: [] },
        { guid: "g2", planKey: "psalms-30-v1", startDate: daysAgo(0), done: [] },
      ];
      open();
      await screen.findByText("Bible in a year");
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "psalms" } });
      expect(screen.queryByText("Bible in a year")).toBeNull();
      expect(screen.getByText("Psalms in 30 days")).toBeTruthy();
    });

    it("opens today's first chapter and closes the palette", async () => {
      planStates = [{ guid: "g1", planKey: "bible-365-v1", startDate: daysAgo(20), done: range(20) }];
      open();
      fireEvent.click(await screen.findByText("Bible in a year"));
      expect(openTarget).toHaveBeenCalledWith({ publication: "bible", kind: { chapter: { book: 2, chapter: 21, verse: 1 } } });
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens the first unread day after the schedule ended", async () => {
      planStates = [{ guid: "g1", planKey: "psalms-30-v1", startDate: daysAgo(40), done: [1, 2] }];
      open();
      fireEvent.click(await screen.findByText("Psalms in 30 days"));
      expect(openTarget).toHaveBeenCalledWith({ publication: "bible", kind: { chapter: { book: 2, chapter: 3, verse: 1 } } });
    });

    it("opens Personal Study for a finished plan", async () => {
      planStates = [{ guid: "g1", planKey: "psalms-30-v1", startDate: daysAgo(40), done: range(30) }];
      open();
      fireEvent.click(await screen.findByText("Psalms in 30 days"));
      expect(push).toHaveBeenCalledWith({ name: "personal" });
      expect(openTarget).not.toHaveBeenCalled();
    });

    it("toasts and stays open without a Bible", async () => {
      app.noBible = true;
      planStates = [{ guid: "g1", planKey: "bible-365-v1", startDate: daysAgo(0), done: [] }];
      open();
      fireEvent.click(await screen.findByText("Bible in a year"));
      expect(toast).toHaveBeenCalledWith("No Bible in this language in your library yet");
      expect(openTarget).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });
});
