import { describe, expect, it } from "vitest";
import { confirmText, failedText, importedText, totalSize } from "@/lib/references";
import type { CatalogEntry } from "@/lib/api";
import { sizeMb } from "@/lib/player";

const entry = (title: string, size: number, issueTitle: string | null = null): CatalogEntry =>
  ({ item: { title, issue_title: issueTitle, size }, local: null }) as unknown as CatalogEntry;

const MB = 1 << 20;

describe("references", () => {
  it("sums sizes", () => {
    expect(totalSize([entry("a", 1000), entry("b", 2500)])).toBe(3500);
    expect(totalSize([])).toBe(0);
  });
  it("lists up to 10 titles, then counts the rest", () => {
    const many = Array.from({ length: 13 }, (_, i) => entry(`T${i}`, MB));
    const lines = confirmText(many).split("\n");
    expect(lines[0]).toBe(`13 publications, ${sizeMb(13 * MB)} in total:`);
    expect(lines).toContain(`• T0 (${sizeMb(MB)})`);
    expect(lines).toContain(`• T9 (${sizeMb(MB)})`);
    expect(lines.some((l) => l.includes("T10"))).toBe(false);
    expect(lines.at(-1)).toBe("… and 3 more");
  });
  it("lists every title without a remainder line up to 10", () => {
    const ten = Array.from({ length: 10 }, (_, i) => entry(`T${i}`, MB));
    const lines = confirmText(ten).split("\n");
    expect(lines).toHaveLength(2 + 10);
    expect(lines.at(-1)).toBe(`• T9 (${sizeMb(MB)})`);
    expect(lines.some((l) => l.startsWith("…"))).toBe(false);
  });
  it("prefers the issue title", () => {
    const text = confirmText([entry("Watchtower", MB, "August 2026"), entry("Book", MB)]);
    expect(text).toContain("• August 2026 (");
    expect(text).not.toContain("Watchtower");
    expect(text).toContain("• Book (");
  });
  it("uses the singular for one publication", () => {
    expect(confirmText([entry("a", MB)]).split("\n")[0]).toBe(`1 publication, ${sizeMb(MB)} in total:`);
  });
  it("pluralizes the result texts", () => {
    expect(importedText(1)).toBe("Imported 1 publication");
    expect(importedText(4)).toBe("Imported 4 publications");
    expect(failedText(1)).toBe("1 download failed");
    expect(failedText(2)).toBe("2 downloads failed");
  });
});
