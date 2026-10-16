import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n";
import type { NoteDraft, NoteFields } from "./notes";

/** Label of the note window (NOTE in src-tauri/src/lib.rs). */
export const NOTE_LABEL = "note";
/** Events: the app sends `NOTE_OPEN` to the window; the window answers with the others. */
export const NOTE_OPEN = "note-open";
export const NOTE_READY = "note-ready";
export const NOTE_DIRTY = "note-dirty";
export const NOTES_CHANGED = "notes-changed";
export const NOTE_CLOSED = "note-closed";
/** A link to the app's own pages clicked in the note window, for the app to open. */
export const NOTE_LINK = "note-link";

/** A note for the window, with unsaved text when it was moved there from the study pane. */
export interface NoteWindowMessage {
  id: number;
  draft: NoteDraft;
  fields?: NoteFields;
}

export const isNoteWindow = () => getCurrentWebviewWindow().label === NOTE_LABEL;

export const sendToNoteWindow = (message: NoteWindowMessage) =>
  emitTo(NOTE_LABEL, NOTE_OPEN, message).catch(() => undefined);

/** A link the note window linked and opened with Ctrl+P, for the app to show behind it while the note is written. */
export const NOTE_SHOW_LINK = "note-show-link";

/** Asks the app's main window to open one of its own links, such as a Bible verse. */
export const sendNoteLink = (href: string) => emitTo("main", NOTE_LINK, href).catch(() => undefined);

/** Asks the app's main window to show one of its own links without coming in front of the note window. */
export const showNoteLink = (href: string) => emitTo("main", NOTE_SHOW_LINK, href).catch(() => undefined);

/** Whether a message is not the one shown already: the app may send it twice while the window opens. */
export const isNewMessage = (shown: NoteWindowMessage | null, message: NoteWindowMessage) => shown?.id !== message.id;

/** Set while the discard question is open in this window, so a second request does not stack another dialog. */
let asking = false;

/**
 * Whether unsaved text may be dropped: asks the user, once at a time. A request
 * while the question is open gets false, so it keeps the text.
 */
export async function askDiscard(): Promise<boolean> {
  if (asking) return false;
  asking = true;
  try {
    return await ask(t("The note you are writing has not been saved."), {
      title: t("Discard note?"),
      kind: "warning",
      okLabel: t("Discard"),
    });
  } catch {
    return false;
  } finally {
    asking = false;
  }
}
