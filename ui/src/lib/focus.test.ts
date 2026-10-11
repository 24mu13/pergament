// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installFocusModality, isModifierOnly } from "@/lib/focus";

let off = () => undefined as void;
afterEach(() => {
  off();
  delete document.documentElement.dataset.input;
});
const key = (k: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));
const mode = () => document.documentElement.dataset.input;

describe("focus modality", () => {
  it("switches to pointer on mouse down and back to keyboard on Tab", () => {
    off = installFocusModality();
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(mode()).toBe("pointer");
    key("Tab");
    expect(mode()).toBe("keyboard");
  });

  it("ignores bare modifier keys (Win/Super, Alt, Control, Shift, CapsLock)", () => {
    off = installFocusModality();
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    for (const k of ["Meta", "OS", "Alt", "Control", "Shift", "CapsLock", "AltGraph"]) key(k);
    expect(mode()).toBe("pointer");
  });

  it("ignores chords held with Meta or Alt (Win+key, Alt+Tab) but not Shift+Tab", () => {
    off = installFocusModality();
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    key("Tab", { altKey: true });
    key("d", { metaKey: true });
    expect(mode()).toBe("pointer");
    key("Tab", { shiftKey: true });
    expect(mode()).toBe("keyboard");
  });

  it("isModifierOnly", () => {
    expect(isModifierOnly(new KeyboardEvent("keydown", { key: "Meta" }))).toBe(true);
    expect(isModifierOnly(new KeyboardEvent("keydown", { key: "a" }))).toBe(false);
  });

  it("uninstalls", () => {
    off = installFocusModality();
    off();
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(mode()).toBeUndefined();
  });
});
