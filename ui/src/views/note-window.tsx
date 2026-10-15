import { useCallback, useEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import { NoteForm, saveDraft, type NoteSaveInput } from "@/components/notes";
import { api } from "@/lib/api";
import { isNewMessage, NOTE_DIRTY, NOTE_OPEN, NOTE_READY, NOTES_CHANGED, type NoteWindowMessage } from "@/lib/note-window";
import { loadTheme, loadUiLang, prefersDark, saveNoteWindowSize } from "@/lib/settings";
import { resolveUiLang, setUiLang, t } from "@/lib/i18n";
import { useSystemDark } from "@/lib/theme";

/** Whether unsaved text may be dropped; the window asks itself, the app may be behind it. */
const askDiscard = () =>
  ask(t("The note you are writing has not been saved."), { title: t("Discard note?"), kind: "warning", okLabel: t("Discard") }).catch(
    () => false,
  );

/**
 * The note window: one note at a time, sent by the app. It saves on its own and
 * tells the app, which reloads its notes.
 */
export function NoteWindowView() {
  setUiLang(resolveUiLang(loadUiLang(), navigator.language));
  const dark = prefersDark(loadTheme(), useSystemDark());
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);

  const win = getCurrentWebviewWindow();
  const [message, setMessage] = useState<NoteWindowMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = useRef<NoteWindowMessage | null>(null);
  const dirty = useRef(false);
  /** Set while a save or delete runs, so a second click does not save the note twice. */
  const busy = useRef(false);

  const setDirty = useCallback((d: boolean) => {
    dirty.current = d;
    void emitTo("main", NOTE_DIRTY, d).catch(() => undefined);
  }, []);
  /** Closes without asking; `destroy` skips the close request. */
  const close = useCallback(() => {
    setDirty(false);
    void win.destroy();
  }, [setDirty, win]);
  const cancel = useCallback(async () => {
    if (!dirty.current || (await askDiscard())) close();
  }, [close]);

  useEffect(() => {
    const un = listen<NoteWindowMessage>(NOTE_OPEN, async ({ payload: m }) => {
      if (!isNewMessage(shown.current, m)) return;
      if (dirty.current && !(await askDiscard())) return;
      shown.current = m;
      setError(null);
      setMessage(m);
    });
    // Ask for the note, in case the app sent it before this window listened.
    void un.then(() => emitTo("main", NOTE_READY));
    return () => void un.then((f) => f());
  }, []);

  useEffect(() => {
    const closing = win.onCloseRequested(async (e) => {
      if (dirty.current && !(await askDiscard())) e.preventDefault();
    });
    const resized = win.onResized(async ({ payload }) => {
      const size = payload.toLogical(await win.scaleFactor());
      saveNoteWindowSize({ width: Math.round(size.width), height: Math.round(size.height) });
    });
    return () => {
      void closing.then((f) => f());
      void resized.then((f) => f());
    };
  }, [win]);

  // The window stays open until the backend agreed, so a failure does not lose the text.
  const run = (action: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    action()
      .then(async () => {
        await emitTo("main", NOTES_CHANGED).catch(() => undefined);
        close();
      })
      .catch((e) => setError(String(e)))
      .finally(() => (busy.current = false));
  };

  if (!message) return <div className="h-full bg-surface" />;
  const { draft } = message;
  return (
    <div
      role="dialog"
      aria-label={draft.note.guid ? t("Edit note") : t("New note")}
      data-note-editor
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        void cancel();
      }}
      className="flex h-full flex-col gap-3 bg-surface p-4 text-fg"
    >
      <h1 className="font-semibold">{draft.note.guid ? t("Edit note") : t("New note")}</h1>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <NoteForm
        key={message.id}
        note={draft.note}
        initial={message.fields}
        onDirty={setDirty}
        onError={setError}
        onCancel={() => void cancel()}
        onSave={(input: NoteSaveInput) => run(() => saveDraft(draft, input))}
        onDelete={draft.note.guid ? () => run(() => api.deleteNote(draft.note.guid!)) : undefined}
      />
    </div>
  );
}
