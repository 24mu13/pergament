import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GripHorizontal, Maximize2, Minimize2, NotebookPen, Pencil, Trash2, X } from "lucide-react";
import { useApp } from "@/app";
import { api, type Note, type NoteInput } from "@/lib/api";
import { clampPanel, fitPanelSize, type Point, type Size } from "@/lib/notes";
import { renderMarkdown } from "@/lib/markdown";
import { loadNoteSize, saveNoteSize } from "@/lib/settings";
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

/**
 * A floating panel to write or change a note. It does not block the app, so
 * the user can keep reading. It can be dragged by its header, resized from its
 * corner, and maximized to fill the content area.
 */
export function NoteEditor({
  note,
  onSave,
  onDelete,
  onClose,
  onDirty,
}: {
  note: Partial<Note>;
  onSave: (input: Omit<NoteInput, "guid" | "blockType" | "blockIdentifier" | "markGuid">) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** Called with whether the fields differ from the note as opened. */
  onDirty?: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState(note.title ?? "");
  const [content, setContent] = useState(note.content ?? "");
  const [tags, setTags] = useState((note.tags ?? []).join(", "));
  const [preview, setPreview] = useState(false);
  const { toast } = useApp();
  /** Links in the preview open in the browser, not in the app's window. */
  const openLink = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    api.openExternal(a.href).catch((err) => toast(String(err)));
  };
  const dirty = title !== (note.title ?? "") || content !== (note.content ?? "") || tags !== (note.tags ?? []).join(", ");
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<Point | null>(null);
  const [full, setFull] = useState(false);
  const fullRef = useRef(full);
  fullRef.current = full;
  /** The size outside full mode; the user changes it with the resize handle or Shift+arrows. */
  const dims = useRef<Size>(loadNoteSize() ?? DEFAULT_SIZE);
  const area = () => {
    const parent = ref.current?.offsetParent as HTMLElement | null;
    return { width: parent?.clientWidth ?? window.innerWidth, height: parent?.clientHeight ?? window.innerHeight };
  };
  const size = () => ({ width: ref.current?.offsetWidth ?? 0, height: ref.current?.offsetHeight ?? 0 });
  /** Height of the content area above the player bar, which the maximized editor fills. */
  const room = useContentHeight();
  // Open at the bottom right, above the player bar when there is one.
  useLayoutEffect(() => {
    const bounds = area();
    const bar = contentArea()?.offsetHeight ?? bounds.height;
    const s = (dims.current = fitPanelSize(dims.current, MIN_SIZE, { width: bounds.width - 2 * EDGE, height: bar - 2 * EDGE }));
    setPos(clampPanel({ x: bounds.width - s.width - EDGE, y: bar - s.height - EDGE }, s, bounds));
  }, []);
  // The panel starts hidden until placed, and a hidden field cannot take focus, so focus it once visible.
  const shown = pos !== null;
  useEffect(() => {
    if (shown) titleRef.current?.focus();
  }, [shown]);
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
      if (!fullRef.current) setPos((p) => p && clampPanel(p, dims.current, area()));
    };
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  // Leaving full mode, fit the panel back into the area: the window may have shrunk meanwhile.
  useEffect(() => {
    if (!full) setPos((p) => p && clampPanel(p, dims.current, area()));
  }, [full]);
  // Remember the size the user drags the panel to, but not one forced on it by a small
  // window: shrunk onto its max-width/height, or grown only to the CSS minimum. Each axis
  // counts on its own, so a forced width does not drop a height the user did change.
  useEffect(() => {
    const el = ref.current;
    if (!el || full || typeof ResizeObserver === "undefined") return;
    const forced = (now: number, want: number, max: number, min: number) =>
      (now < want && now >= max - 1) || (now > want && now <= min + 1);
    const seen = new ResizeObserver(() => {
      const s = size();
      const d = dims.current;
      const style = getComputedStyle(el);
      const next = {
        width: forced(s.width, d.width, parseFloat(style.maxWidth), parseFloat(style.minWidth)) ? d.width : s.width,
        height: forced(s.height, d.height, parseFloat(style.maxHeight), parseFloat(style.minHeight)) ? d.height : s.height,
      };
      if (next.width === d.width && next.height === d.height) return;
      dims.current = next;
      saveNoteSize(next);
    });
    seen.observe(el, { box: "border-box" });
    return () => seen.disconnect();
  }, [full]);

  /** Arrow keys on the grip move the panel; with Shift they resize it. */
  const nudge = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step || !pos || full) return;
    e.preventDefault();
    const [dx, dy] = step.map((v) => v * KEY_STEP);
    const bounds = area();
    if (e.shiftKey) {
      const s = fitPanelSize({ width: dims.current.width + dx, height: dims.current.height + dy }, MIN_SIZE, {
        width: bounds.width - pos.x,
        height: bounds.height - pos.y,
      });
      dims.current = s;
      saveNoteSize(s);
      setPos({ ...pos });
    } else {
      setPos(clampPanel({ x: pos.x + dx, y: pos.y + dy }, dims.current, bounds));
    }
  };

  const placed = (p: Point): React.CSSProperties => {
    const bounds = area();
    return {
      left: 0,
      top: 0,
      transform: translate(p),
      width: dims.current.width,
      height: dims.current.height,
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
        full ? "rounded-none" : "resize rounded-md",
      )}
    >
      <div
        onPointerDown={drag}
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
            onClick={() => setFull((f) => !f)}
          >
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button aria-label={t("Close")} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </div>
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
        <button onClick={onClose} className="px-4 py-2 text-sm hover:bg-bar">
          {t("Cancel")}
        </button>
        <button
          disabled={!title.trim() && !content.trim()}
          onClick={() =>
            onSave({
              title: title.trim(),
              content,
              tags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          className="rounded-md bg-brand px-4 py-2 text-sm text-brand-fg hover:opacity-90 dark:bg-fg dark:text-surface disabled:opacity-50"
        >
          {t("Save")}
        </button>
      </div>
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
      onSave={(input) =>
        run(() =>
          api.saveNote(draft.note.guid ? null : (draft.target ?? null), {
            ...input,
            guid: draft.note.guid,
            blockType: draft.blockType ?? 0,
            blockIdentifier: draft.blockIdentifier ?? null,
            markGuid: draft.markGuid ?? null,
          }),
        )
      }
      onDelete={draft.note.guid ? () => run(() => api.deleteNote(draft.note.guid!)) : undefined}
    />
  );
}
