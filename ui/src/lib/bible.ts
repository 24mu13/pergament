import type { CatalogEntry, TocNode } from "./api";

/** "1. Mose (Genesis)" -> "1. Mose" for compact tiles. */
export function shortBookName(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Does this subtree contain Bible books? */
export function hasBooks(node: TocNode): boolean {
  return node.bible_book != null || node.children.some(hasBooks);
}

/** Index of the tab that holds the books (the default Bible tab). */
export function booksTabIndex(toc: TocNode[]): number {
  const i = toc.findIndex(hasBooks);
  return i < 0 ? 0 : i;
}


/**
 * The books of a Bible with the names the table of contents gives them ("Hebräer"), since the book list itself has
 * the long ones ("Der Brief an die Hebräer"). Books the contents do not name keep their long name.
 */
export function namedBooks(
  toc: TocNode[],
  books: { number: number; title: string; chapters: number; verses?: number[] }[],
): { number: number; title: string; chapters: number; verses?: number[] }[] {
  const names = new Map<number, string>();
  const walk = (nodes: TocNode[]) =>
    nodes.forEach((n) => {
      if (n.bible_book != null && !names.has(n.bible_book)) names.set(n.bible_book, n.title);
      walk(n.children);
    });
  walk(toc);
  return books.map((b) => ({ number: b.number, chapters: b.chapters, verses: b.verses, title: names.get(b.number) ?? b.title }));
}

/** A place in a Bible: chapter, and the verse if one was given. */
export interface Reference {
  book: number;
  chapter: number;
  verse: number | null;
}

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The names a book answers to: the shown name and the one in brackets, such as "1. Mose" and "Genesis". */
function bookNames(title: string): string[] {
  const inner = title.match(/\(([^)]*)\)\s*$/)?.[1];
  return [shortBookName(title), ...(inner ? [inner] : [])].map(plain).filter(Boolean);
}

/**
 * Reads a reference such as "Heb 10:24", "1 Joh 3:16", "1. Mose 2" or "Psalm 23" against the books of a Bible. A name
 * only has to start a book's name ("Heb" for Hebrews), and a book number may be written with or without a dot. Returns
 * null when no book fits or the chapter does not exist.
 */
export function parseReference(
  input: string,
  books: { number: number; title: string; chapters: number; verses?: number[] }[],
): Reference | null {
  const m = input.trim().match(/^(\d)?[.\s]*(\p{L}[\p{L}.\s]*?)\s*(?:(\d+)(?:\s*[:,.]\s*(\d+))?)?$/u);
  if (!m) return null;
  const query = plain(`${m[1] ?? ""} ${m[2]}`);
  const named = (names: string[], test: (n: string) => boolean) => names.some(test);
  const book =
    books.find((b) => named(bookNames(b.title), (n) => n === query)) ??
    books
      .filter((b) => named(bookNames(b.title), (n) => n.startsWith(query)))
      .sort((a, b) => a.title.length - b.title.length || a.number - b.number)[0];
  if (!book) return null;
  // A single number after a book of one chapter ("Jude 5") is the verse.
  const fits = (chapter: number, verse: number) => {
    const count = book.verses?.[chapter - 1];
    return verse >= 1 && (count == null || verse <= count);
  };
  if (book.chapters === 1 && m[3] && !m[4]) {
    return fits(1, Number(m[3])) ? { book: book.number, chapter: 1, verse: Number(m[3]) } : null;
  }
  const chapter = m[3] ? Number(m[3]) : 1;
  if (chapter < 1 || chapter > book.chapters) return null;
  const verse = m[4] ? Number(m[4]) : null;
  if (verse != null && !fits(chapter, verse)) return null;
  return { book: book.number, chapter, verse };
}

/** One Bible a language can be read in: downloaded (`dir`), in the catalog (`entry`), or both. */
export interface BibleChoice {
  lang: string;
  symbol: string;
  title: string;
  dir: string | null;
  entry: CatalogEntry | null;
}

/** The Bibles of one language: those in the library, then the catalog ones not downloaded yet. */
export function bibleChoices(
  lang: string,
  library: { dir: string; symbol: string; title: string; shortTitle: string | null; langCode: string | null; isBible: boolean }[],
  catalog: CatalogEntry[],
): BibleChoice[] {
  const out: BibleChoice[] = library
    .filter((p) => p.isBible && p.langCode === lang)
    .map((p) => ({ lang, symbol: p.symbol, title: p.shortTitle ?? p.title, dir: p.dir, entry: null }));
  for (const e of catalog) {
    const own = out.find((c) => c.symbol === e.item.symbol);
    if (own) own.entry ??= e;
    else out.push({ lang, symbol: e.item.symbol, title: e.item.short_title ?? e.item.title, dir: e.local, entry: e });
  }
  return out;
}

/** The Bible a language opens: the one picked last, else the study edition, else the first downloaded one. */
export function pickBible<T extends { symbol: string; dir: string | null }>(choices: T[], preferred: string | null): T | undefined {
  const here = choices.filter((c) => c.dir != null);
  return here.find((c) => c.symbol === preferred) ?? here.find((c) => c.symbol === "nwtsty") ?? here[0];
}
