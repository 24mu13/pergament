import { describe, expect, it } from "vitest";
import { bibleChoices, pickBible } from "./bible";
import { loadBibles, saveBibles } from "./settings";
import type { CatalogEntry } from "./api";

const lib = (dir: string, symbol: string, langCode = "X", isBible = true) => ({
  dir,
  symbol,
  title: `${symbol} title`,
  shortTitle: null,
  langCode,
  isBible,
});
const cat = (symbol: string, local: string | null = null) =>
  ({ item: { symbol, title: `${symbol} cat`, short_title: null }, local }) as unknown as CatalogEntry;

describe("bibleChoices", () => {
  it("lists library Bibles of the language, then catalog ones not downloaded", () => {
    const choices = bibleChoices(
      "X",
      [lib("nwtsty_X", "nwtsty"), lib("nwtsty_E", "nwtsty", "E"), lib("wt_X", "wt", "X", false)],
      [cat("nwtsty", "nwtsty_X"), cat("nwt"), cat("bi12")],
    );
    expect(choices.map((c) => [c.symbol, c.dir, c.entry !== null])).toEqual([
      ["nwtsty", "nwtsty_X", true],
      ["nwt", null, true],
      ["bi12", null, true],
    ]);
  });
  it("keeps a downloaded Bible when there is no catalog", () => {
    expect(bibleChoices("X", [lib("nwt_X", "nwt")], [])).toMatchObject([{ symbol: "nwt", dir: "nwt_X", entry: null }]);
  });
});

describe("pickBible", () => {
  const choices = [
    { symbol: "nwt", dir: "nwt_X" },
    { symbol: "nwtsty", dir: "nwtsty_X" },
    { symbol: "bi12", dir: null },
  ];
  it("prefers the picked one, then the study edition, then the first downloaded", () => {
    expect(pickBible(choices, "nwt")?.symbol).toBe("nwt");
    expect(pickBible(choices, null)?.symbol).toBe("nwtsty");
    expect(pickBible([choices[0], choices[2]], "bi12")?.symbol).toBe("nwt");
    expect(pickBible([choices[2]], null)).toBeUndefined();
  });
});

describe("saved Bibles", () => {
  it("round-trips and ignores junk", () => {
    saveBibles({ X: "nwt" });
    expect(loadBibles()).toEqual({ X: "nwt" });
    localStorage.setItem("bibles", "[1]");
    expect(loadBibles()).toEqual({});
  });
});
