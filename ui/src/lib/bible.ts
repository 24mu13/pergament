import { chapterTarget, type BibleBook, type CatalogEntry, type TocNode } from "./api";
import { inLanguage } from "./settings";
import type { View } from "./nav";

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


/** A book of a Bible, by the name its contents give it and the abbreviation the Bible uses for it, if known. */
export interface Book {
  number: number;
  title: string;
  chapters: number;
  abbreviation?: string;
}

/**
 * The books of a Bible with the names the table of contents gives them ("Hebräer"), since the book list itself has
 * the long ones ("Der Brief an die Hebräer"). Books the contents do not name keep their long name. `abbreviations`
 * are the Bible's own ("Heb"), by book number.
 */
export function namedBooks(
  toc: TocNode[],
  books: { number: number; title: string; chapters: number }[],
  abbreviations: Record<number, string> = {},
): Book[] {
  const names = new Map<number, string>();
  const walk = (nodes: TocNode[]) =>
    nodes.forEach((n) => {
      if (n.bible_book != null && !names.has(n.bible_book)) names.set(n.bible_book, n.title);
      walk(n.children);
    });
  walk(toc);
  return books.map((b) => ({
    number: b.number,
    chapters: b.chapters,
    title: names.get(b.number) ?? b.title,
    ...(abbreviations[b.number] ? { abbreviation: abbreviations[b.number] } : {}),
  }));
}

/** A place in a Bible: chapter, and the verse if one was given. */
export interface Reference {
  book: number;
  chapter: number;
  verse: number | null;
  /** The last verse of a range such as "Heb 10:24-25". */
  verseEnd?: number;
}

/** The app's link to a reference: `pergament://bible/B:C:V-B:C:V`, or `pergament://bible/B:C` for a whole chapter. */
export function bibleHref({ book, chapter, verse, verseEnd }: Reference): string {
  if (verse == null) return `pergament://bible/${book}:${chapter}`;
  return `pergament://bible/${book}:${chapter}:${verse}-${book}:${chapter}:${verseEnd ?? verse}`;
}

/** Lower case, without accents, dots and spaces: "1. Könige" -> "1konige". */
const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.\s]/g, "");

/** Like `plain`, but keeping accents, which tell abbreviations apart: "1Kö" (Kings) is not "1Ko" (Corinthians). */
const exact = (s: string) => s.normalize("NFC").toLowerCase().replace(/[.\s]/g, "");

/** The names a book answers to: the shown name and the one in brackets, such as "1. Mose" and "Genesis". */
function bookNames(title: string): string[] {
  const inner = title.match(/\(([^)]*)\)\s*$/)?.[1];
  return [shortBookName(title), ...(inner ? [inner] : [])].map(plain).filter(Boolean);
}

/** Whether `short` keeps the first letter of `name` and the rest of its letters appear in `name` in the same order. */
function abbreviates(short: string, name: string): boolean {
  if (short[0] !== name[0]) return false;
  let i = 0;
  for (const c of name) if (c === short[i]) i++;
  return i === short.length;
}

/**
 * Reads a reference such as "Heb 10:24", "Heb 10:24-25", "1 Joh 3:16", "1. Mose 2" or "Psalm 23" against the books of
 * a Bible. A book is found by its name or the Bible's abbreviation for it, then by the start of its name ("Heb" for
 * Hebrews), books of several chapters and then the shortest name first; a book whose chapter does not exist is
 * passed over ("Phil 4:13" is not Philemon).
 * Only when none fits, letters left out of a name count ("Mt" for Matthew), and only if a single book fits so.
 * Returns null when no book fits or a range is not one of verses in one chapter.
 */
export function parseReference(input: string, books: Book[]): Reference | null {
  const m = input.trim().match(/^(\d)?[.\s]*(\p{L}[\p{L}.\s]*?)\s*(?:(\d+)(?:\s*[:,.]\s*(\d+))?(?:\s*[-–]\s*(\d+))?)?$/u);
  if (!m) return null;
  const typed = `${m[1] ?? ""}${m[2]}`;
  const query = plain(typed);
  /** The verse, with the end of its range when there is one that does not run backwards. */
  const verses = (verse: number) => {
    if (verse < 1) return null;
    if (!m[5]) return { verse };
    const verseEnd = Number(m[5]);
    return verseEnd < verse ? null : { verse, verseEnd };
  };
  /** The place in `book`, or null when it has no such chapter. */
  const place = (book: Book): Reference | null => {
    // A single number after a book of one chapter ("Jude 5") is the verse.
    if (book.chapters === 1 && m[3] && !m[4]) {
      const v = verses(Number(m[3]));
      return v && { book: book.number, chapter: 1, ...v };
    }
    const chapter = m[3] ? Number(m[3]) : 1;
    if (chapter < 1 || chapter > book.chapters) return null;
    if (!m[4]) return m[5] ? null : { book: book.number, chapter, verse: null };
    const v = verses(Number(m[4]));
    return v && { book: book.number, chapter, ...v };
  };
  const named = (test: (n: string) => boolean) => books.filter((b) => bookNames(b.title).some(test));
  const shortest = (a: Book, b: Book) => a.title.length - b.title.length || a.number - b.number;
  // Started names try books of several chapters first: "Phil 4" is Philippians 4, not Philemon 4 (the verse).
  const longFirst = (a: Book, b: Book) => Number(a.chapters === 1) - Number(b.chapters === 1) || shortest(a, b);
  const tiers = [
    books.filter((b) => bookNames(b.title).includes(query) || (b.abbreviation && exact(b.abbreviation) === exact(typed))).sort(shortest),
    named((n) => n.startsWith(query)).sort(longFirst),
  ];
  for (const tier of tiers) {
    for (const book of tier) {
      const found = place(book);
      if (found) return found;
    }
  }
  // "Kor" leaves out the number of 1. and 2. Korinther, so it fits them as well as Kolosser, and fits none.
  const loose = named((n) => abbreviates(query, n) || abbreviates(query, n.replace(/^\d/, "")));
  return loose.length === 1 ? place(loose[0]) : null;
}

/** One reference of a list such as "Joh 15:13, 15-17", and where its text is: `start`..`end` of the trimmed input. */
export interface ListedReference {
  ref: Reference;
  start: number;
  end: number;
}

/** A verse or run of verses after a comma: ", 15" or ", 15-17". */
const MORE_VERSES = /\s*,\s*((\d+)(?:\s*[-–]\s*(\d+))?)/g;

/**
 * Reads a reference that may go on with more verses of its chapter, as in "Joh 15:13,15", "Joh 15:13-14, 16" or, with
 * the comma between chapter and verse, "Joh 15,13,15", and with more chapters of its book after semicolons, as in
 * "Joh 15:13, 15; 16:2-4". A comma starts another verse only after a verse; "Joh 15,13" alone is chapter 15, verse 13.
 * A part after a semicolon is a chapter and verse of the same book. Returns the parts in their order, one for a plain
 * reference, or null when the reference or any further chapter or verse does not fit.
 */
export function parseReferences(input: string, books: Book[]): ListedReference[] | null {
  const text = input.trim();
  const [head, ...rest] = text.split(";");
  const m = head.match(/^(.*?\d+\s*[:,]\s*\d+(?:\s*[-–]\s*\d+)?)((?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)\s*$/u);
  if (!m) {
    const ref = rest.length === 0 && parseReference(text, books);
    return ref ? [{ ref, start: 0, end: text.length }] : null;
  }
  const first = parseReference(m[1], books);
  if (!first || first.verse == null) return null;
  const out: ListedReference[] = [{ ref: first, start: 0, end: m[1].length }];
  /** Adds the verses listed in `list`, found at `offset`; false when one does not fit. */
  const more = (list: string, offset: number, chapter: number) => {
    for (const g of list.matchAll(MORE_VERSES)) {
      const verse = Number(g[2]);
      const verseEnd = g[3] ? Number(g[3]) : undefined;
      if (verse < 1 || (verseEnd != null && verseEnd < verse)) return false;
      const start = offset + g.index + g[0].length - g[1].length;
      out.push({
        ref: { book: first.book, chapter, verse, ...(verseEnd != null ? { verseEnd } : {}) },
        start,
        end: start + g[1].length,
      });
    }
    return true;
  };
  if (!more(m[2], m[1].length, first.chapter)) return null;
  const chapters = books.find((b) => b.number === first.book)?.chapters ?? 0;
  let at = head.length + 1;
  for (const part of rest) {
    const c = part.match(/^(\s*)((\d+)\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?)((?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)\s*$/);
    if (!c) return null;
    const [chapter, verse] = [Number(c[3]), Number(c[4])];
    const verseEnd = c[5] ? Number(c[5]) : undefined;
    if (chapter < 1 || chapter > chapters || verse < 1 || (verseEnd != null && verseEnd < verse)) return null;
    const start = at + c[1].length;
    out.push({
      ref: { book: first.book, chapter, verse, ...(verseEnd != null ? { verseEnd } : {}) },
      start,
      end: start + c[2].length,
    });
    if (!more(c[6], start + c[2].length, chapter)) return null;
    at += part.length + 1;
  }
  return out;
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

/** The Bible references are read against: the one open (`openDir`) if it is a Bible, else the one chosen for `lang`. */
export function bibleFor<T extends { dir: string; symbol: string; langCode: string | null; isBible: boolean }>(
  openDir: string | null,
  publications: T[],
  lang: string,
  bibles: Record<string, string>,
): T | undefined {
  const open = publications.find((p) => p.isBible && p.dir === openDir);
  return open ?? pickBible(inLanguage(publications, lang).filter((p) => p.isBible), bibles[lang] ?? null);
}

/**
 * The stack to open in another Bible for the place the user is in: the same book, chapter and verse when the new Bible
 * has the book, otherwise just its book list.
 */
export function bibleStackFor(view: View, dir: string, books: BibleBook[]): View[] {
  if (view.name === "reader" && "chapter" in view.target.kind) {
    const { book, chapter, verse } = view.target.kind.chapter;
    const info = books.find((b) => b.number === book);
    if (info) {
      return [
        { name: "publication", dir },
        { name: "chapters", dir, book },
        { name: "reader", target: chapterTarget(dir, book, Math.min(chapter, info.chapters), verse) },
      ];
    }
  } else if (view.name === "chapters" && books.some((b) => b.number === view.book)) {
    return [
      { name: "publication", dir },
      { name: "chapters", dir, book: view.book },
    ];
  }
  return [{ name: "publication", dir }];
}
