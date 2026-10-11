const MODIFIERS = new Set(["Meta", "OS", "Super", "Hyper", "Alt", "AltGraph", "Control", "Shift", "CapsLock", "NumLock", "ScrollLock", "Fn", "FnLock"]);

/** A key press that is only a modifier, or a chord held with Meta/Alt (Win+key, Alt+Tab) that belongs to the system. */
export function isModifierOnly(e: KeyboardEvent): boolean {
  return MODIFIERS.has(e.key) || e.metaKey || e.altKey;
}

/**
 * Tracks whether the last real input came from a pointer or the keyboard, as
 * `data-input` on <html>, so the focus ring can stay hidden after a click
 * even when a key like Win/Super is pressed (browsers count any key press as keyboard use).
 */
export function installFocusModality(doc: Document = document): () => void {
  const set = (mode: "pointer" | "keyboard") => {
    doc.documentElement.dataset.input = mode;
  };
  const down = () => set("pointer");
  const key = (e: KeyboardEvent) => {
    if (!isModifierOnly(e)) set("keyboard");
  };
  doc.addEventListener("mousedown", down, true);
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("touchstart", down, true);
  doc.addEventListener("keydown", key, true);
  return () => {
    doc.removeEventListener("mousedown", down, true);
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("touchstart", down, true);
    doc.removeEventListener("keydown", key, true);
  };
}
