import { describe, expect, it } from "vitest";
import { confirmText, totalSize } from "@/lib/references";
import type { CatalogEntry } from "@/lib/api";

const entry = (title: string, size: number): CatalogEntry =>
  ({ item: { title, issue_title: null, size }, local: null }) as unknown as CatalogEntry;

describe("references", () => {
  it("sums sizes", () => {
    expect(totalSize([entry("a", 1000), entry("b", 2500)])).toBe(3500);
    expect(totalSize([])).toBe(0);
  });
  it("lists up to 10 titles, then counts the rest", () => {
    const many = Array.from({ length: 13 }, (_, i) => entry(`T${i}`, 1 << 20));
    const text = confirmText(many);
    expect(text).toContain("T0");
    expect(text).toContain("T9");
    expect(text).not.toContain("T10");
    expect(text).toContain("3");
    expect(text).toContain("13");
  });
});
