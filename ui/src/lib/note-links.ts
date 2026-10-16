import { useEffect, useState } from "react";
import { api } from "./api";
import { bibleFor, bibleHref, namedBooks, parseReferences, type Book } from "./bible";

/** The books of the Bible in `dir`, by the names its contents give them and with their abbreviations. */
export const loadBooks = (dir: string): Promise<Book[]> =>
  // Without its abbreviations the Bible's books are still found by name.
  Promise.all([api.publication(dir), api.bookAbbreviations(dir).catch(() => ({}))]).then(([d, abbr]) =>
    namedBooks(d.toc, d.books, abbr),
  );

/** What Ctrl+L writes: `text` in place of `start`..`end`, then the caret at `caret`. */
export interface LinkEdit {
  start: number;
  end: number;
  text: string;
  caret: number;
  /** The first verses linked, which Ctrl+P opens; none when no reference was linked. */
  href?: string;
}

/**
 * Turns the selection `start`..`end` of a note's text into a Markdown link. A Bible reference with a chapter links to
 * its verses; other text, such as a name alone ("Ruth"), gets an empty address with the caret in it, and no selection
 * an empty link with the caret in its text. A list of verses ("Joh 15:13, 15") becomes one link for each, since a link
 * holds one run of verses; the text between them stays as it was. Spaces at the edges of the selection stay outside the
 * link, and line breaks in it become spaces, since a link cannot span lines.
 */
export function linkEdit(value: string, start: number, end: number, books: Book[] | null): LinkEdit {
  const selected = value.slice(start, end);
  const trimmed = selected.trim();
  if (!trimmed) return { start: end, end, text: "[]()", caret: end + 1 };
  start += selected.length - selected.trimStart().length;
  end = start + trimmed.length;
  const label = trimmed.replace(/\s+/g, " ");
  // A number after a letter is the chapter; "1 Joh" alone is a name. A long selection is no reference, and reading it
  // as one would take a while.
  const parts = books && label.length <= 500 && /\p{L}.*\d/u.test(label) ? parseReferences(label, books) : null;
  if (!parts) {
    const text = `[${label}]()`;
    return { start, end, text, caret: start + text.length - 1 };
  }
  let text = "";
  let at = 0;
  for (const p of parts) {
    text += `${label.slice(at, p.start)}[${label.slice(p.start, p.end)}](${bibleHref(p.ref)})`;
    at = p.end;
  }
  text += label.slice(at);
  return { start, end, text, caret: start + text.length, href: bibleHref(parts[0].ref) };
}

/**
 * The Bible a note's references link to, like the "go to" box picks it: the one open in the reader, else the one
 * chosen for the language. Null until its books are loaded, or when there is no Bible.
 */
export function useLinkBible(
  openDir: string | null,
  publications: { dir: string; symbol: string; langCode: string | null; isBible: boolean }[],
  lang: string,
  bibles: Record<string, string>,
): { dir: string; books: Book[] } | null {
  const dir = bibleFor(openDir, publications, lang, bibles)?.dir ?? null;
  const [bible, setBible] = useState<{ dir: string; books: Book[] } | null>(null);
  useEffect(() => {
    if (!dir) return;
    let live = true;
    loadBooks(dir)
      .then((books) => live && setBible({ dir, books }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [dir]);
  return bible?.dir === dir ? bible : null;
}
