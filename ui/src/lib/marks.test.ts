import { describe, expect, it } from "vitest";
import { applyMarks, BLOCK_VERSE } from "./marks";

const verse = (c: number, v: number) => `<span class="v" id="v46-${c}-${v}-1">Text ${c}:${v}</span>`;
const mark = { guid: "g", color: 1, ranges: [{ blockType: BLOCK_VERSE, identifier: 12, start: 0, end: 1 }] };

describe("applyMarks", () => {
  it("marks only the given chapter, for text that spans several", () => {
    const box = document.createElement("div");
    box.innerHTML = verse(12, 12) + verse(13, 12);
    applyMarks(box, [mark], 12);
    const marked = [...box.querySelectorAll("mark.hl")].map((m) => m.closest("span.v")?.id);
    expect(marked).toEqual(["v46-12-12-1"]);
    applyMarks(box, [mark], 13);
    expect(box.querySelectorAll("mark.hl")).toHaveLength(2);
  });
});
