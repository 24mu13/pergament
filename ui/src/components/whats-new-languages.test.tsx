// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: {
    languages: async () => [
      { code: "X", name: "German", vernacular: "Deutsch", rtl: false, signLanguage: false },
      { code: "E", name: "English", vernacular: "English", rtl: false, signLanguage: false },
    ],
  },
}));

import { WhatsNewLanguages } from "./whats-new-languages";

afterEach(cleanup);

const picker = (value: string[], onChange: (codes: string[]) => void = vi.fn()) => (
  <WhatsNewLanguages value={value} onChange={onChange} />
);

describe("whats new languages picker", () => {
  it("opens the list and toggles a second language on", async () => {
    const onChange = vi.fn();
    render(picker(["X"], onChange));
    fireEvent.click(screen.getByLabelText("What's New languages"));
    // The row shows the vernacular and the English name, both "English" here.
    fireEvent.click((await screen.findAllByText("English"))[0]);
    expect(onChange).toHaveBeenLastCalledWith(["X", "E"]);
    expect(screen.queryByPlaceholderText("Search languages")).not.toBeNull();
  });

  it("keeps the last language selected", async () => {
    const onChange = vi.fn();
    render(picker(["X"], onChange));
    fireEvent.click(screen.getByLabelText("What's New languages"));
    // "German" is the English name under the vernacular "Deutsch"; only the row has it.
    const row = await screen.findByText("German");
    expect(row.closest("[role=option]")?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("search filters the rows", async () => {
    render(picker(["X", "E"]));
    fireEvent.click(screen.getByLabelText("What's New languages"));
    fireEvent.change(await screen.findByPlaceholderText("Search languages"), { target: { value: "engl" } });
    expect((await screen.findAllByText("English")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Deutsch")).toBeNull();
  });

  it("closes on Done", async () => {
    render(picker(["X"]));
    fireEvent.click(screen.getByLabelText("What's New languages"));
    fireEvent.click(await screen.findByText("Done"));
    expect(screen.queryByPlaceholderText("Search languages")).toBeNull();
  });

  it("labels the button", async () => {
    const { rerender } = render(picker(["X"]));
    expect(await screen.findByText("Deutsch")).not.toBeNull();
    rerender(picker(["X", "E"]));
    expect(screen.getByText("2 languages")).not.toBeNull();
  });

  it("prunes codes the loaded language list does not have", async () => {
    const onChange = vi.fn();
    render(picker(["X", "ZZ"], onChange));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["X"]));
  });

  it("prunes down to an empty selection when no code is in the list", async () => {
    const onChange = vi.fn();
    render(picker(["ZZ"], onChange));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
  });

  it("does not prune when every code is in the list", async () => {
    const onChange = vi.fn();
    render(picker(["X"], onChange));
    // The label shows the loaded vernacular, so the list is in by then.
    expect(await screen.findByText("Deutsch")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("prunes once, not again on later renders", async () => {
    const onChange = vi.fn();
    const { rerender } = render(picker(["X", "ZZ"], onChange));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    rerender(picker(["X"], onChange));
    rerender(picker(["X", "E"], onChange));
    await new Promise((r) => setTimeout(r, 20));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
