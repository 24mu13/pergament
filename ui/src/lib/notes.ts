import type { Note } from "./api";

export type NoteSort = "newest" | "oldest" | "publication";

export interface NoteFilter {
  query: string;
  /** Highlight color index, or null for any. */
  color: number | null;
  sort: NoteSort;
}

const haystack = (n: Note) =>
  [n.title, n.content, n.location?.title ?? "", ...n.tags].join("\n").toLowerCase();

/** Notes matching a text (every word must occur) and a highlight color, in the chosen order. */
export function filterNotes(notes: Note[], { query, color, sort }: NoteFilter): Note[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = notes.filter((n) => (color === null || n.color === color) && words.every((w) => haystack(n).includes(w)));
  const byDate = (a: Note, b: Note) => a.lastModified.localeCompare(b.lastModified);
  return [...shown].sort((a, b) =>
    sort === "oldest"
      ? byDate(a, b)
      : sort === "publication"
        ? (a.location?.title ?? "￿").localeCompare(b.location?.title ?? "￿") || byDate(b, a)
        : byDate(b, a),
  );
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A floating panel's top left corner, moved so the panel stays inside the area (its top left wins if it cannot fit). */
export function clampPanel(pos: Point, size: Size, bounds: Size): Point {
  const fit = (v: number, room: number) => Math.max(0, Math.min(v, room));
  return { x: fit(pos.x, bounds.width - size.width), y: fit(pos.y, bounds.height - size.height) };
}

/** A floating panel's size, at least `min` but never larger than the area. */
export function fitPanelSize(size: Size, min: Size, bounds: Size): Size {
  const fit = (v: number, low: number, high: number) => Math.min(Math.max(v, low), high);
  return { width: fit(size.width, min.width, bounds.width), height: fit(size.height, min.height, bounds.height) };
}
