import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { NoteDraft, NoteFields } from "./notes";

/** Label of the note window (NOTE in src-tauri/src/lib.rs). */
export const NOTE_LABEL = "note";
/** Events: the app sends `NOTE_OPEN` to the window; the window answers with the others. */
export const NOTE_OPEN = "note-open";
export const NOTE_READY = "note-ready";
export const NOTE_DIRTY = "note-dirty";
export const NOTES_CHANGED = "notes-changed";
export const NOTE_CLOSED = "note-closed";

/** A note for the window, with unsaved text when it was moved there from the study pane. */
export interface NoteWindowMessage {
  id: number;
  draft: NoteDraft;
  fields?: NoteFields;
}

export const isNoteWindow = () => getCurrentWebviewWindow().label === NOTE_LABEL;

export const sendToNoteWindow = (message: NoteWindowMessage) =>
  emitTo(NOTE_LABEL, NOTE_OPEN, message).catch(() => undefined);

/** Whether a message is not the one shown already: the app may send it twice while the window opens. */
export const isNewMessage = (shown: NoteWindowMessage | null, message: NoteWindowMessage) => shown?.id !== message.id;
