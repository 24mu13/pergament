import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OutlineSection, outlineRange } from "./outline-section";
import type { OutlineEntry } from "@/lib/api";

const entry = (o: Partial<OutlineEntry>): OutlineEntry => ({
  level: 2,
  text: "Abram",
  begin_chapter: 12,
  begin_verse: 1,
  end_chapter: 12,
  end_verse: 9,
  ...o,
});

describe("outlineRange", () => {
  it("shortens a range within a chapter", () => {
    expect(outlineRange(entry({}))).toBe("1-9");
    expect(outlineRange(entry({ end_verse: 1 }))).toBe("1");
    expect(outlineRange(entry({ end_verse: null }))).toBe("1");
  });
  it("names the chapters across chapters", () => {
    expect(outlineRange(entry({ end_chapter: 13, end_verse: 4 }))).toBe("12:1–13:4");
  });
});

describe("OutlineSection", () => {
  it("links to the verse in the open chapter", () => {
    render(<OutlineSection title="Übersicht" outline={[entry({})]} book={1} />);
    expect(screen.getByRole("link", { name: "(1-9)" }).getAttribute("href")).toBe("#v1-12-1-1");
  });
});
