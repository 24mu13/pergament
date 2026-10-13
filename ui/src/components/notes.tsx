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
const MIN_SIZE = { width: 320, height: 280 };

const translate = (p: Point) => `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;

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
  const [pos, setPos] = useState<Point | null>(null);
  const [full, setFull] = useState(false);
  /** The size outside full mode; the user changes it with the resize handle. */
  const dims = useRef<Size>(loadNoteSize() ?? DEFAULT_SIZE);
  const area = () => {
    const parent = ref.current?.offsetParent as HTMLElement | null;
    return { width: parent?.clientWidth ?? window.innerWidth, height: parent?.clientHeight ?? window.innerHeight };
  };
  const size = () => ({ width: ref.current?.offsetWidth ?? 0, height: ref.current?.offsetHeight ?? 0 });
  // Open at the bottom right, above the player bar when there is one.
  useLayoutEffect(() => {
    const bounds = area();
    const bar = document.querySelector<HTMLElement>("#content > div:first-child")?.offsetHeight ?? bounds.height;
    const s = (dims.current = fitPanelSize(dims.current, MIN_SIZE, { width: bounds.width - 2 * EDGE, height: bar - 2 * EDGE }));
    setPos(clampPanel({ x: bounds.width - s.width - EDGE, y: bar - s.height - EDGE }, s, bounds));
  }, []);
  useEffect(() => {
    const fit = () => setPos((p) => p && clampPanel(p, size(), area()));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  // Remember the size the user drags the panel to.
  useEffect(() => {
    const el = ref.current;
    if (!el || full || typeof ResizeObserver === "undefined") return;
    const seen = new ResizeObserver(() => {
      const s = size();
      if (s.width === dims.current.width && s.height === dims.current.height) return;
      dims.current = s;
      saveNoteSize(s);
    });
    seen.observe(el, { box: "border-box" });
    return () => seen.disconnect();
  }, [full]);

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
    if (e.button !== 0 || (e.target as HTMLElement).closest("button") || !pos || full) return;
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
      aria-label={note.guid ? t("Edit note") : t("New note")}
      style={full ? { left: 0, top: 0, width: "100%", height: "100%" } : pos ? placed(pos) : { visibility: "hidden" }}
      className={cn(
        "absolute z-35 flex min-h-[280px] min-w-[320px] flex-col gap-3 overflow-hidden border border-line bg-surface p-4 shadow-lg will-change-transform",
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
          {!full && <GripHorizontal size={16} className="text-muted" aria-hidden />}
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
        autoFocus
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
  const { note, closeNote, setNoteDirty, userChanged, toast } = useApp();
  if (!note) return null;
  const { draft } = note;
  const run = (action: () => Promise<unknown>) => {
    closeNote();
    action()
      .then(userChanged)
      .catch((e) => toast(String(e)));
  };
  return (
    <NoteEditor
      key={note.id}
      note={draft.note}
      onDirty={setNoteDirty}
      onClose={closeNote}
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
