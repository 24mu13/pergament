// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isNewMessage, type NoteWindowMessage } from "./note-window";
import { loadNoteWindowSize, saveNoteWindowSize } from "./settings";

const message = (id: number): NoteWindowMessage => ({ id, draft: { note: { title: "t" } } });

describe("note window", () => {
  it("takes a message only once, as the app may send it again when the window gets ready", () => {
    expect(isNewMessage(null, message(1))).toBe(true);
    expect(isNewMessage(message(1), message(1))).toBe(false);
    expect(isNewMessage(message(1), message(2))).toBe(true);
  });

  it("remembers the window size and ignores broken values", () => {
    saveNoteWindowSize({ width: 600, height: 500 });
    expect(loadNoteWindowSize()).toEqual({ width: 600, height: 500 });
    localStorage.setItem("noteWindowSize", "{\"width\":\"x\"}");
    expect(loadNoteWindowSize()).toBeNull();
  });
});
