// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BibleChoice } from "@/lib/bible";

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: {
    languages: async () => [{ code: "X", name: "German", vernacular: "Deutsch", rtl: false, signLanguage: false }],
  },
}));

import { LanguageMenu, type Translations } from "./language-menu";

afterEach(cleanup);

const choice = (symbol: string, dir: string | null): BibleChoice => ({ lang: "X", symbol, title: symbol, dir, entry: null });
const choices = [choice("nwtsty", "nwtsty_X"), choice("nwt", null)];

const menu = (over: Partial<Translations>) => {
  const translations: Translations = { choicesFor: () => choices, current: "nwtsty", onPick: vi.fn(), progress: () => undefined, ...over };
  return <LanguageMenu value="X" onChange={() => undefined} libraryCodes={["X"]} translations={translations} />;
};

describe("language menu translations", () => {
  it("closes at once for a downloaded translation", async () => {
    const onPick = vi.fn();
    render(menu({ onPick }));
    fireEvent.click(screen.getByLabelText("Language"));
    fireEvent.click(await screen.findByText("nwtsty"));
    expect(onPick).toHaveBeenCalledWith(choices[0]);
    expect(screen.queryByPlaceholderText("Search languages")).toBeNull();
  });

  it("stays open for a download and closes when it is over, but not for someone else's download", async () => {
    const running = { done: 1, total: 10 };
    const { rerender } = render(menu({}));
    fireEvent.click(screen.getByLabelText("Language"));
    // A download started elsewhere (not picked here) neither keeps nor closes the menu.
    rerender(menu({ progress: (c) => (c.symbol === "nwt" ? running : undefined) }));
    rerender(menu({}));
    expect(screen.queryByPlaceholderText("Search languages")).not.toBeNull();

    fireEvent.click(await screen.findByText("nwt"));
    expect(screen.queryByPlaceholderText("Search languages")).not.toBeNull();
    rerender(menu({ progress: (c) => (c.symbol === "nwt" ? running : undefined) }));
    expect(screen.queryByPlaceholderText("Search languages")).not.toBeNull();
    rerender(menu({}));
    expect(screen.queryByPlaceholderText("Search languages")).toBeNull();
  });
});
