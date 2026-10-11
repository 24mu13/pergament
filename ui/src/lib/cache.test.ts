import { describe, expect, it } from "vitest";
import { formatSize, rows } from "@/lib/cache";

const usage = { catalog: 58_000_000, covers: 2_000_000, partial: 0, other: 400_000, total: 60_400_000 };

describe("cache helpers", () => {
  it("formats sizes", () => {
    expect(formatSize(0)).toBe("0 MB");
    expect(formatSize(400_000)).toBe("1 MB");
    expect(formatSize(58_000_000)).toBe("58 MB");
  });
  it("keeps a stable row order including empty kinds", () => {
    expect(rows(usage).map((r) => [r.key, r.bytes])).toEqual([
      ["catalog", 58_000_000],
      ["covers", 2_000_000],
      ["partial", 0],
      ["other", 400_000],
    ]);
  });
});
