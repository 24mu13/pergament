import { describe, expect, it } from "vitest";
import type { Conflict, MergeReport } from "@/lib/api";
import { conflictText, mergeToast } from "@/lib/merge";

const report = (added: number, updated: number, device: string | null = null): MergeReport => ({
  added,
  updated,
  unchanged: 4,
  conflicts: [],
  device,
});

describe("mergeToast", () => {
  it("says when there is nothing new", () => {
    expect(mergeToast(report(0, 0))).toBe("Nothing new in the backup");
    expect(mergeToast(report(0, 0, "Phone"))).toBe("Nothing new in the backup");
  });
  it("counts added and updated together", () => {
    expect(mergeToast(report(1, 0))).toBe("Merged 1 change");
    expect(mergeToast(report(0, 1))).toBe("Merged 1 change");
    expect(mergeToast(report(3, 2))).toBe("Merged 5 changes");
  });
  it("names the device", () => {
    expect(mergeToast(report(1, 0, "Phone"))).toBe("Merged 1 change from Phone");
    expect(mergeToast(report(2, 3, "Phone"))).toBe("Merged 5 changes from Phone");
  });
});

describe("conflictText", () => {
  const conflicts = (n: number): Conflict[] =>
    Array.from({ length: n }, (_, i) => ({ table: "Note", guid: `secret-${i}`, summary: `Title ${i}` }));

  it("lists a single conflict in the singular", () => {
    expect(conflictText(conflicts(1))).toBe("1 conflict, your version was kept:\nNote: Title 0");
  });
  it("falls back to the table when the summary is empty and never shows the key", () => {
    const text = conflictText([{ table: "Bookmark", guid: "1:2", summary: "" }]);
    expect(text).toBe("1 conflict, your version was kept:\nBookmark");
    expect(text).not.toContain("1:2");
  });
  it("shows ten and counts the rest", () => {
    const lines = conflictText(conflicts(12)).split("\n");
    expect(lines[0]).toBe("12 conflicts, your version was kept:");
    expect(lines).toHaveLength(12);
    expect(lines[10]).toBe("Note: Title 9");
    expect(lines[11]).toBe("… and 2 more");
  });
  it("shows exactly ten without a tail", () => {
    expect(conflictText(conflicts(10)).split("\n")).toHaveLength(11);
  });
});
