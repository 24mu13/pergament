import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GripHorizontal, Maximize2, Minimize2, NotebookPen, Pencil, Trash2, X } from "lucide-react";
import { useApp } from "@/app";
import { api, type Note } from "@/lib/api";
import { clampPanel, fieldsOf, fitPanelSize, parseTags, sameFields, type NoteDraft, type NoteFields, type Point, type Size } from "@/lib/notes";
import { renderMarkdown } from "@/lib/markdown";
import { loadNoteFull, loadNotePos, loadNoteSize, saveNoteFull, saveNotePos, saveNoteSize } from "@/lib/settings";
import { HIGHLIGHT_COLORS } from "@/lib/marks";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

/** Color swatches plus note and delete actions, shown at a selection or highlight. */
export function MarkToolbar({
  x,
  y,
  current,
  onColor,
  onNote,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  current?: number;
  onColor: (color: number) => void;
  onNote: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      style={{ left: x, top: y }}
      className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 shadow-sm"
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.index}
          title={t(c.name)}
          aria-label={t("Highlight {color}", { color: t(c.name) })}
          onClick={() => onColor(c.index)}
          className={cn(
            `hl-dot-${c.index} h-6 w-6 rounded-full ring-1 ring-black/20`,
            current === c.index && "ring-2 ring-fg",
          )}
        />
      ))}
      <span className="mx-1 h-5 w-px bg-line" />
      <button title={t("Note")} aria-label={t("Add note")} onClick={onNote} className="p-1 hover:text-accent">
        <NotebookPen size={18} />
      </button>
      {onDelete && (
        <button title={t("Remove highlight")} aria-label={t("Remove highlight")} onClick={onDelete} className="p-1 hover:text-accent">
          <Trash2 size={18} />
        </button>
      )}
    </div>
  );
}

/** A note as shown in the study pane and in Personal Study. */
export function NoteCard({
  note,
  onClick,
  onEdit,
  subtitle,
}: {
  note: Note;
  onClick?: () => void;
  onEdit?: () => void;
  subtitle?: string;
}) {
  const card = (
    <button onClick={onClick} className={cn("flex w-full gap-3 rounded-md border border-line p-3 text-left hover:bg-bar", onEdit && "pr-9")}>
      <span className={cn("w-1 shrink-0 self-stretch", note.color ? `hl-dot-${note.color}` : "bg-line")} />
      <div className="min-w-0 flex-1">
        {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
        {note.title && <div className="font-semibold">{note.title}</div>}
        {note.content && (
          <div
            className="note-md line-clamp-4 text-sm text-fg/85"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content, { links: false }) }}
          />
        )}
        {note.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {note.tags.map((t) => (
              <span key={t} className="rounded border border-line px-1.5 py-0.5 text-xs">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
  if (!onEdit) return card;
  return (
    <div className="relative">
      {card}
      <button title={t("Edit note")} aria-label={t("Edit note")} onClick={onEdit} className="absolute right-2 top-2 p-1 text-muted hover:text-accent">
        <Pencil size={14} />
      </button>
    </div>
  );
}

/** Space kept between the editor and the edges of the content area when it first opens. */
const EDGE = 16;
/** The editor's size until the user resizes it, and the smallest it can be. */
const DEFAULT_SIZE = { width: 440, height: 420 };
const MIN_SIZE = { width: 380, height: 320 };

/** How far one arrow key press on the grip moves or resizes the editor. */
const KEY_STEP = 16;

/**
 * `size` with the axes a resize changed from `shown` to `now`. An axis that did not change
 * keeps its value: what was shown there may only have been capped by a small window.
 */
const resized = (size: Size, shown: Size, now: Size): Size => ({
  width: now.width !== shown.width ? now.width : size.width,
  height: now.height !== shown.height ? now.height : size.height,
});

const translate = (p: Point) => `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;

/** The content area above the player bar. */
const contentArea = () => document.querySelector<HTMLElement>("#content > div:first-child");

/** The content area's height, kept up to date as the window and the player bar change. */
function useContentHeight(): number | null {
  const [height, setHeight] = useState<number | null>(() => contentArea()?.offsetHeight ?? null);
  useEffect(() => {
    const el = contentArea();
    if (!el || typeof ResizeObserver === "undefined") return;
    const seen = new ResizeObserver(() => setHeight(el.offsetHeight));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return height;
}

/** Where the panel's resize handles sit: thin strips along the edges, squares in the corners. */
const EDGES = {
  n: "inset-x-3 top-0 h-1.5 cursor-ns-resize",
  s: "inset-x-3 bottom-0 h-1.5 cursor-ns-resize",
  w: "inset-y-3 left-0 w-1.5 cursor-ew-resize",
  e: "inset-y-3 right-0 w-1.5 cursor-ew-resize",
  nw: "left-0 top-0 h-3 w-3 cursor-nwse-resize",
  ne: "right-0 top-0 h-3 w-3 cursor-nesw-resize",
  sw: "left-0 bottom-0 h-3 w-3 cursor-nesw-resize",
  se: "right-0 bottom-0 flex h-4 w-4 cursor-nwse-resize items-end justify-end p-0.5 text-muted hover:text-fg",
};
type Edge = keyof typeof EDGES;

/** Keeps WebKitGTK's page menu (Back, Reload, ...) from opening on a press held on the panel's handles. */
const noMenu = (e: React.MouseEvent) => e.preventDefault();

export type NoteSaveInput = { title: string; content: string; tags: string[] };

/** Saves a draft: an existing note by its guid, a new one on the page and highlight it was started on. */
export const saveDraft = (draft: NoteDraft, input: NoteSaveInput) =>
  api.saveNote(draft.note.guid ? null : (draft.target ?? null), {
    ...input,
    guid: draft.note.guid,
    blockType: draft.blockType ?? 0,
    blockIdentifier: draft.blockIdentifier ?? null,
    markGuid: draft.markGuid ?? null,
  });

/** The fields of a note and its buttons, shared by the study pane's editor and the note window. */
export function NoteForm({
  note,
  initial,
  focus = true,
  onSave,
  onDelete,
  onCancel,
  onDirty,
  onChange,
  onError,
}: {
  note: Partial<Note>;
  /** Fields to start with instead of the note's, such as unsaved text moved from another editor. */
  initial?: NoteFields;
  /** Focus the title once this is true; a hidden field cannot take focus. */
  focus?: boolean;
  onSave: (input: NoteSaveInput) => void;
  onDelete?: () => void;
  onCancel: () => void;
  /** Called with whether the fields differ from the note as opened. */
  onDirty?: (dirty: boolean) => void;
  onChange?: (fields: NoteFields) => void;
  onError?: (message: string) => void;
}) {
  const start = initial ?? fieldsOf(note);
  const [title, setTitle] = useState(start.title);
  const [content, setContent] = useState(start.content);
  const [tags, setTags] = useState(start.tags);
  const [preview, setPreview] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dirty = !sameFields({ title, content, tags }, fieldsOf(note));
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  useEffect(() => onChange?.({ title, content, tags }), [title, content, tags, onChange]);
  useEffect(() => {
    if (focus) titleRef.current?.focus();
  }, [focus]);
  /** Links in the preview open in the browser, not in the app's window. */
  const openLink = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    api.openExternal(a.href).catch((err) => onError?.(String(err)));
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <input
        id="note-title"
        ref={titleRef}
        placeholder={t("Title")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="rounded-md border border-line bg-surface px-3 py-2 focus:border-accent"
      />
      <div role="group" aria-label={t("Note")} className="-mb-1.5 flex justify-end gap-1 text-xs">
        {[false, true].map((on) => (
          <button
            key={String(on)}
            type="button"
            aria-pressed={preview === on}
            onClick={() => setPreview(on)}
            className="rounded px-2 py-0.5 text-muted hover:text-fg aria-pressed:bg-bar aria-pressed:font-medium aria-pressed:text-fg"
          >
            {on ? t("Preview") : t("Write")}
          </button>
        ))}
      </div>
      {preview ? (
        <div
          data-testid="note-preview"
          onClick={openLink}
          className="note-md min-h-0 flex-1 overflow-auto rounded-md border border-line px-3 py-2"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(content, { links: true }) || `<p class="text-muted">${t("Nothing to preview")}</p>`,
          }}
        />
      ) : (
        <textarea
          id="note-content"
          placeholder={t("Note")}
          rows={6}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-0 flex-1 resize-none rounded-md border border-line bg-surface px-3 py-2 focus:border-accent"
        />
      )}
      <input
        id="note-tags"
        placeholder={t("Tags, separated by commas")}
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm focus:border-accent"
      />
      <div className="flex items-center gap-2">
        {onDelete && (
          <button onClick={onDelete} className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted hover:text-fg">
            <Trash2 size={16} /> {t("Delete")}
          </button>
        )}
        <span className="flex-1" />
        <button onClick={onCancel} className="px-4 py-2 text-sm hover:bg-bar">
          {t("Cancel")}
        </button>
        <button
          disabled={!title.trim() && !content.trim()}
          onClick={() => onSave({ title: title.trim(), content, tags: parseTags(tags) })}
          className="rounded-md bg-brand px-4 py-2 text-sm text-brand-fg hover:opacity-90 dark:bg-fg dark:text-surface disabled:opacity-50"
        >
          {t("Save")}
        </button>
      </div>
    </div>
  );
}

/**
 * A floating panel to write or change a note. It does not block the app, so
 * the user can keep reading. It can be dragged by its header, resized from its
 * edges and corners, and maximized to fill the content area. It opens where, as large as
 * and maximized or not as the user last left it.
 */
export function NoteEditor({
  note,
  onSave,
  onDelete,
  onClose,
  onDirty,
}: {
  note: Partial<Note>;
  onSave: (input: NoteSaveInput) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** Called with whether the fields differ from the note as opened. */
  onDirty?: (dirty: boolean) => void;
}) {
  const { toast } = useApp();

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Point | null>(null);
  const [full, setFull] = useState(loadNoteFull);
  const fullRef = useRef(full);
  fullRef.current = full;
  /**
   * The size outside full mode; the user changes it with the resize handles or Shift+arrows.
   * A size saved while the minimum was smaller is raised to it, or the panel could slip past the edges.
   */
  const dims = useRef<Size>(fitPanelSize(loadNoteSize() ?? DEFAULT_SIZE, MIN_SIZE, { width: Infinity, height: Infinity }));
  /**
   * Opened at the default place or above a player bar, the size shown is kept above the bar (and
   * off the edges) without changing the chosen size; resizing then moves this cap along with the panel.
   */
  const cap = useRef<Size | null>(null);
  /** The size the panel is drawn at, before max-width/height cap it to the area. */
  const shownSize = (): Size => {
    const c = cap.current;
    const d = dims.current;
    return c ? { width: Math.min(d.width, c.width), height: Math.min(d.height, c.height) } : d;
  };
  const area = () => {
    const parent = ref.current?.offsetParent as HTMLElement | null;
    return { width: parent?.clientWidth ?? window.innerWidth, height: parent?.clientHeight ?? window.innerHeight };
  };
  const size = () => ({ width: ref.current?.offsetWidth ?? 0, height: ref.current?.offsetHeight ?? 0 });
  /** Height of the content area above the player bar, which the maximized editor fills. */
  const room = useContentHeight();
  // Open where the user last put it, or else at the bottom right, above the player bar when there is one.
  // A small window only caps the size shown (max-width/height); `dims` keeps the chosen one.
  useLayoutEffect(() => {
    const bounds = area();
    const saved = loadNotePos();
    const bar = contentArea()?.offsetHeight ?? bounds.height;
    if (saved) {
      // With a player bar it ends above the bar, as at the default place, even in a window that got shorter:
      // moved up to keep its size where there is room, shortened where there is not.
      const above = bar < bounds.height;
      const s = fitPanelSize(dims.current, MIN_SIZE, above ? { width: bounds.width, height: bar - 2 * EDGE } : bounds);
      const p = clampPanel(saved, s, bounds);
      if (above) {
        p.y = Math.max(0, Math.min(p.y, bar - EDGE - s.height));
        cap.current = { width: Infinity, height: Math.max(MIN_SIZE.height, Math.min(s.height, bar - EDGE - p.y)) };
      }
      setPos(p);
      return;
    }
    const s = (cap.current = fitPanelSize(dims.current, MIN_SIZE, { width: bounds.width - 2 * EDGE, height: bar - 2 * EDGE }));
    setPos(clampPanel({ x: bounds.width - s.width - EDGE, y: bar - s.height - EDGE }, s, bounds));
  }, []);
  // The panel starts hidden until placed, and a hidden field cannot take focus, so focus it once visible.
  const shown = pos !== null;
  // Give focus back to where the user was, if that is still on the page.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const fit = () => {
      // Maximized, the panel's own size is the whole area; keep the place it goes back to.
      if (!fullRef.current) setPos((p) => p && clampPanel(p, shownSize(), area()));
    };
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  // Leaving full mode, fit the panel back into the area: the window may have shrunk meanwhile.
  useEffect(() => {
    if (!full) setPos((p) => p && clampPanel(p, shownSize(), area()));
  }, [full]);
  /** Arrow keys on the grip move the panel; with Shift they resize it. */
  const nudge = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step || !pos || full) return;
    e.preventDefault();
    const [dx, dy] = step.map((v) => v * KEY_STEP);
    const bounds = area();
    if (e.shiftKey) {
      const room = { width: bounds.width - pos.x, height: bounds.height - pos.y };
      // Step from the size shown, which a small window may cap below the chosen one.
      const shown = fitPanelSize(shownSize(), MIN_SIZE, room);
      const s = fitPanelSize({ width: shown.width + dx, height: shown.height + dy }, MIN_SIZE, room);
      const next = resized(dims.current, shown, s);
      if (next.width !== dims.current.width || next.height !== dims.current.height) {
        dims.current = next;
        saveNoteSize(next);
      }
      if (cap.current) cap.current = resized(cap.current, shown, s);
      setPos({ ...pos });
    } else {
      const next = clampPanel({ x: pos.x + dx, y: pos.y + dy }, shownSize(), bounds);
      saveNotePos(next);
      setPos(next);
    }
  };

  const toggleFull = () => {
    saveNoteFull(!full);
    setFull(!full);
  };

  const placed = (p: Point): React.CSSProperties => {
    const bounds = area();
    return {
      left: 0,
      top: 0,
      transform: translate(p),
      width: shownSize().width,
      height: shownSize().height,
      maxWidth: bounds.width - p.x,
      maxHeight: bounds.height - p.y,
    };
  };

  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button:not([data-grip])") || !pos || full) return;
    // Without this WebKit starts a text selection that follows the pointer over the page behind.
    e.preventDefault();
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const handle = e.currentTarget;
    const panel = ref.current!;
    handle.setPointerCapture(e.pointerId);
    // Moving writes the transform directly and React only learns the end position:
    // a render and layout per pointer move made dragging lag in WebKitGTK.
    const s = size();
    const bounds = area();
    let at = pos;
    const move = (ev: PointerEvent) => {
      at = clampPanel({ x: ev.clientX - start.x, y: ev.clientY - start.y }, s, bounds);
      panel.style.transform = translate(at);
    };
    const up = () => {
      if (at !== pos) saveNotePos(at);
      setPos(at);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  /**
   * Resizes from an edge or corner, like a window; the left and top ones move the panel too.
   * Unlike CSS `resize`, the size the user picks is known for sure.
   */
  const resize = (edge: Edge) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !pos || full) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const panel = ref.current!;
    handle.setPointerCapture(e.pointerId);
    // Like dragging, this writes the place and size directly and React only learns the end result.
    const start = { x: e.clientX, y: e.clientY };
    const bounds = area();
    // The size shown: the chosen one, capped by max-width/height in a window that shrank.
    const from = fitPanelSize(shownSize(), MIN_SIZE, { width: bounds.width - pos.x, height: bounds.height - pos.y });
    const right = pos.x + from.width;
    const bottom = pos.y + from.height;
    const fit = (v: number, low: number, high: number) => Math.min(Math.max(v, low), high);
    let at = pos;
    let to = from;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      let { x, y } = pos;
      let { width, height } = from;
      if (edge.includes("e")) width = fit(from.width + dx, MIN_SIZE.width, bounds.width - x);
      if (edge.includes("w")) x = right - (width = fit(from.width - dx, MIN_SIZE.width, right));
      if (edge.includes("s")) height = fit(from.height + dy, MIN_SIZE.height, bounds.height - y);
      if (edge.includes("n")) y = bottom - (height = fit(from.height - dy, MIN_SIZE.height, bottom));
      at = { x, y };
      to = { width, height };
      Object.assign(panel.style, {
        transform: translate(at),
        width: `${width}px`,
        height: `${height}px`,
        maxWidth: `${bounds.width - x}px`,
        maxHeight: `${bounds.height - y}px`,
      });
    };
    const up = () => {
      const next = resized(dims.current, from, to);
      if (next.width !== dims.current.width || next.height !== dims.current.height) {
        dims.current = next;
        saveNoteSize(next);
      }
      if (cap.current) cap.current = resized(cap.current, from, to);
      if (at.x !== pos.x || at.y !== pos.y) saveNotePos(at);
      // `move` wrote the capped size of the other axis too; React would not rewrite a value it already rendered.
      const shown = shownSize();
      Object.assign(panel.style, { width: `${shown.width}px`, height: `${shown.height}px` });
      setPos(at);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      data-note-editor
      aria-label={note.guid ? t("Edit note") : t("New note")}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
      style={
        full
          ? { left: 0, top: 0, width: "100%", height: room ?? "100%" }
          : pos
            ? placed(pos)
            : { visibility: "hidden" }
      }
      className={cn(
        "absolute z-35 flex min-h-[320px] min-w-[380px] flex-col gap-3 overflow-hidden border border-line bg-surface p-4 shadow-lg will-change-transform",
        full ? "rounded-none" : "rounded-md",
      )}
    >
      <div
        onPointerDown={drag}
        onContextMenu={noMenu}
        className={cn(
          "-mx-4 -mt-4 flex touch-none items-center justify-between gap-2 border-b border-line bg-bar px-4 py-2 select-none",
          !full && "cursor-move rounded-t-md",
        )}
      >
        <h2 className="flex items-center gap-2 font-semibold">
          {!full && (
            <button
              data-grip
              type="button"
              aria-label={t("Move note (arrow keys, Shift to resize)")}
              title={t("Move note (arrow keys, Shift to resize)")}
              onKeyDown={nudge}
              className="cursor-move rounded text-muted hover:text-fg"
            >
              <GripHorizontal size={16} aria-hidden />
            </button>
          )}
          {note.guid ? t("Edit note") : t("New note")}
        </h2>
        <div className="flex items-center gap-2">
          <button
            aria-label={full ? t("Restore size") : t("Maximize")}
            title={full ? t("Restore size") : t("Maximize")}
            aria-pressed={full}
            onClick={toggleFull}
          >
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button aria-label={t("Close")} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </div>
      <NoteForm note={note} focus={shown} onSave={onSave} onDelete={onDelete} onCancel={onClose} onDirty={onDirty} onError={toast} />
      {!full &&
        (Object.keys(EDGES) as Edge[]).map((edge) => (
          <div
            key={edge}
            data-testid={`note-resize-${edge}`}
            aria-hidden
            onPointerDown={resize(edge)}
            onContextMenu={noMenu}
            className={cn("absolute touch-none", EDGES[edge])}
          >
            {edge === "se" && (
              <svg viewBox="0 0 8 8" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M7 1L1 7M7 4.5L4.5 7" />
              </svg>
            )}
          </div>
        ))}
    </div>
  );
}

/**
 * The note being written, floating over the content area. It lives next to the
 * player so it stays open while the user navigates, and saves to the page the
 * note was started on.
 */
export function NoteHost() {
  const { note, closeNote, setNoteDirty, notesChanged, toast } = useApp();
  /** Set while a save or delete runs, so a second click does not save the note twice. */
  const busy = useRef(false);
  if (!note) return null;
  const { id, draft } = note;
  // The editor stays open until the backend agreed, so a failure does not lose the text.
  const run = (action: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    action()
      .then(() => {
        notesChanged();
        return closeNote(id, { force: true });
      })
      .catch((e) => toast(String(e)))
      .finally(() => (busy.current = false));
  };
  return (
    <NoteEditor
      key={id}
      note={draft.note}
      onDirty={setNoteDirty}
      onClose={() => void closeNote(id)}
      onSave={(input) => run(() => saveDraft(draft, input))}
      onDelete={draft.note.guid ? () => run(() => api.deleteNote(draft.note.guid!)) : undefined}
    />
  );
}
