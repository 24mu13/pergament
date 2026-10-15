import { describe, expect, it } from "vitest";
import { bibleFor, namedBooks, parseReference, parseReferences, type Book } from "./bible";
import { linkEdit } from "./note-links";

const CHAPTERS = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7,
  3, 3, 3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
];

/** The 66 books with the given names and abbreviations, as the New World Translation has them. */
const bible = (names: string, abbreviations?: string): Book[] => {
  const titles = names.split(",");
  const abbr = abbreviations?.split(",");
  return namedBooks(
    [],
    titles.map((title, i) => ({ number: i + 1, title, chapters: CHAPTERS[i] })),
    Object.fromEntries((abbr ?? []).map((a, i) => [i + 1, a])),
  );
};

const DE_NAMES =
  "1. Mose,2. Mose,3. Mose,4. Mose,5. Mose,Josua,Richter,Ruth,1. Samuel,2. Samuel,1. Könige,2. Könige,1. Chronika,2. Chronika," +
  "Esra,Nehemia,Esther,Hiob,Psalmen,Sprüche,Prediger,Hohes Lied,Jesaja,Jeremia,Klagelieder,Hesekiel,Daniel,Hosea,Joel,Amos," +
  "Obadja,Jona,Micha,Nahum,Habakuk,Zephanja,Haggai,Sacharja,Maleachi,Matthäus,Markus,Lukas,Johannes,Apostelgeschichte,Römer," +
  "1. Korinther,2. Korinther,Galater,Epheser,Philipper,Kolosser,1. Thessalonicher,2. Thessalonicher,1. Timotheus,2. Timotheus," +
  "Titus,Philemon,Hebräer,Jakobus,1. Petrus,2. Petrus,1. Johannes,2. Johannes,3. Johannes,Judas,Offenbarung";
/** Mined from the German study Bible (nwtsty_2), as `book_abbreviations` gives them. */
const DE_ABBR =
  "1Mo,2Mo,3Mo,4Mo,5Mo,Jos,Ri,Ru,1Sa,2Sa,1Kö,2Kö,1Ch,2Ch,Esr,Ne,Est,Hi,Ps,Spr,Pr,Hoh,Jes,Jer,Klg,Hes,Da,Hos,Joel,Am,Ob,Jon," +
  "Mi,Nah,Hab,Ze,Hag,Sach,Mal,Mat,Mar,Luk,Joh,Apg,Rö,1Ko,2Ko,Gal,Eph,Php,Kol,1Th,2Th,1Ti,2Ti,Tit,Phm,Heb,Jak,1Pe,2Pe,1Jo," +
  "2Jo,3Jo,Jud,Off";
const EN_NAMES =
  "Genesis,Exodus,Leviticus,Numbers,Deuteronomy,Joshua,Judges,Ruth,1 Samuel,2 Samuel,1 Kings,2 Kings,1 Chronicles,2 Chronicles," +
  "Ezra,Nehemiah,Esther,Job,Psalms,Proverbs,Ecclesiastes,Song of Solomon,Isaiah,Jeremiah,Lamentations,Ezekiel,Daniel,Hosea,Joel," +
  "Amos,Obadiah,Jonah,Micah,Nahum,Habakkuk,Zephaniah,Haggai,Zechariah,Malachi,Matthew,Mark,Luke,John,Acts,Romans,1 Corinthians," +
  "2 Corinthians,Galatians,Ephesians,Philippians,Colossians,1 Thessalonians,2 Thessalonians,1 Timothy,2 Timothy,Titus,Philemon," +
  "Hebrews,James,1 Peter,2 Peter,1 John,2 John,3 John,Jude,Revelation";
/** Mined from the English study Bible (nwtsty_0). */
const EN_ABBR =
  "Ge,Ex,Le,Nu,De,Jos,Jg,Ru,1Sa,2Sa,1Ki,2Ki,1Ch,2Ch,Ezr,Ne,Es,Job,Ps,Pr,Ec,Ca,Isa,Jer,La,Eze,Da,Ho,Joe,Am,Ob,Jon,Mic,Na,Hab,Zep," +
  "Hag,Zec,Mal,Mt,Mr,Lu,Joh,Ac,Ro,1Co,2Co,Ga,Eph,Php,Col,1Th,2Th,1Ti,2Ti,Tit,Phm,Heb,Jas,1Pe,2Pe,1Jo,2Jo,3Jo,Jude,Re";

const de = bible(DE_NAMES, DE_ABBR);
const en = bible(EN_NAMES, EN_ABBR);
const deNames = bible(DE_NAMES);
const enNames = bible(EN_NAMES);
const book = (text: string, books: Book[]) => parseReference(text, books)?.book ?? null;

describe("parseReference in a whole Bible", () => {
  it("has the books right", () => {
    expect([CHAPTERS.length, de.length, en.length]).toEqual([66, 66, 66]);
    expect(de[45]).toEqual({ number: 46, title: "1. Korinther", chapters: 16, abbreviation: "1Ko" });
  });

  it("reads the Bible's own abbreviations, accents and all", () => {
    expect(parseReference("1Ko 13:4", de)).toEqual({ book: 46, chapter: 13, verse: 4 });
    expect(book("1Kö 13:4", de)).toBe(11);
    expect(book("1 Ko 13", de)).toBe(46);
    expect(book("Phil 4:13", de)).toBe(50);
    expect(book("Ca 2", en)).toBe(22);
    expect(book("Mr 1", en)).toBe(41);
    expect(book("Jas 1:5", en)).toBe(59);
  });

  it("reads Phil as Philippians and leaves Philemon to its own abbreviations", () => {
    for (const books of [de, deNames, en, enNames]) {
      expect(parseReference("Phil 4", books)).toEqual({ book: 50, chapter: 4, verse: null });
      expect(parseReference("Phil 2", books)?.book).toBe(50);
      expect(parseReference("Phil 1:6", books)).toEqual({ book: 50, chapter: 1, verse: 6 });
      expect(parseReference("Phlm 5", books)).toEqual({ book: 57, chapter: 1, verse: 5 });
      expect(parseReference("Philem 5", books)).toEqual({ book: 57, chapter: 1, verse: 5 });
    }
    expect(book("Phm 5", de)).toBe(57);
    expect(book("Php 4:13", de)).toBe(50);
  });

  it("passes over a book whose chapter does not exist", () => {
    expect(book("Phil 4:13", deNames)).toBe(50);
    expect(book("Phil 4:13", en)).toBe(50);
    expect(book("Phil 4:13", enNames)).toBe(50);
    expect(book("Phil 5", deNames)).toBe(57); // Philemon 5, a book of one chapter
  });

  it("reads abbreviations that leave out letters only when one book fits", () => {
    expect(book("Mt 24:14", de)).toBe(40);
    expect(book("Mt 24:14", enNames)).toBe(40);
    expect(book("Hbr 10", de)).toBe(58);
    expect(book("Jn 3:16", de)).toBeNull();
    expect(book("Jn 3:16", deNames)).toBeNull();
    expect(book("Er 2", de)).toBeNull();
  });

  it("never reads Kor as Kolosser", () => {
    expect([46, 47, null]).toContain(book("Kor 2:9", de));
    expect([46, 47, null]).toContain(book("Kor 2:9", deNames));
  });

  it("does not take Ca for Colossians without the Bible's abbreviations", () => {
    expect(book("Ca 2", enNames)).toBeNull();
  });

  it("gives nothing for verse 0", () => {
    expect(parseReference("Mt 24:0", de)).toBeNull();
  });
});

describe("bibleFor", () => {
  const pubs = [
    { dir: "nwt_E", symbol: "nwt", langCode: "E", isBible: true },
    { dir: "nwtsty_E", symbol: "nwtsty", langCode: "E", isBible: true },
    { dir: "nwt_X", symbol: "nwt", langCode: "X", isBible: true },
    { dir: "w_E", symbol: "w", langCode: "E", isBible: false },
  ];
  it("takes the open Bible, else the one chosen for the language, else the study edition", () => {
    expect(bibleFor("nwt_X", pubs, "E", {})?.dir).toBe("nwt_X");
    expect(bibleFor("w_E", pubs, "E", { E: "nwt" })?.dir).toBe("nwt_E");
    expect(bibleFor(null, pubs, "E", {})?.dir).toBe("nwtsty_E");
    expect(bibleFor(null, pubs, "F", {})).toBeUndefined();
  });
});

describe("parseReferences", () => {
  const v = (verse: number, verseEnd?: number) => ({ book: 43, chapter: 15, verse, ...(verseEnd ? { verseEnd } : {}) });
  /** The parts as [text, reference]. */
  const parts = (text: string, books = de) =>
    parseReferences(text, books)?.map((p) => [text.trim().slice(p.start, p.end), p.ref]) ?? null;

  it("reads a list of verses after chapter and verse", () => {
    expect(parts("Joh 15:13,15")).toEqual([["Joh 15:13", v(13)], ["15", v(15)]]);
    expect(parts("Joh 15:13, 15")).toEqual([["Joh 15:13", v(13)], ["15", v(15)]]);
    expect(parts("Joh 15:13-14,16")).toEqual([["Joh 15:13-14", v(13, 14)], ["16", v(16)]]);
    expect(parts("Joh 15:13,15-17")).toEqual([["Joh 15:13", v(13)], ["15-17", v(15, 17)]]);
    expect(parts(" Joh 15:13 , 15 – 17, 20 ")).toEqual([["Joh 15:13", v(13)], ["15 – 17", v(15, 17)], ["20", v(20)]]);
    expect(parts("Joh 15:16,13")).toEqual([["Joh 15:16", v(16)], ["13", v(13)]]);
    expect(parts("1. Kor 13:4, 7")).toEqual([
      ["1. Kor 13:4", { book: 46, chapter: 13, verse: 4 }],
      ["7", { book: 46, chapter: 13, verse: 7 }],
    ]);
    expect(parts("Röm 5:12, 18-19")).toEqual([
      ["Röm 5:12", { book: 45, chapter: 5, verse: 12 }],
      ["18-19", { book: 45, chapter: 5, verse: 18, verseEnd: 19 }],
    ]);
    expect(parts("John 15:13, 15", en)).toEqual([["John 15:13", v(13)], ["15", v(15)]]);
  });

  it("reads more chapters of the book after semicolons", () => {
    const at = (book: number, chapter: number, verse: number, verseEnd?: number) => ({
      book,
      chapter,
      verse,
      ...(verseEnd ? { verseEnd } : {}),
    });
    expect(parts("Joh 15:13; 16:2")).toEqual([["Joh 15:13", v(13)], ["16:2", at(43, 16, 2)]]);
    expect(parts("Joh 15:13, 15; 16:2-4")).toEqual([["Joh 15:13", v(13)], ["15", v(15)], ["16:2-4", at(43, 16, 2, 4)]]);
    expect(parts("Röm 5:12, 18; 6:3")).toEqual([["Röm 5:12", at(45, 5, 12)], ["18", at(45, 5, 18)], ["6:3", at(45, 6, 3)]]);
    expect(parts("Joh 15:13;16:2, 4-5")).toEqual([["Joh 15:13", v(13)], ["16:2", at(43, 16, 2)], ["4-5", at(43, 16, 4, 5)]]);
    expect(parts("John 15:13; 16:2-4", en)).toEqual([["John 15:13", v(13)], ["16:2-4", at(43, 16, 2, 4)]]);
  });

  it("gives nothing for a chapter list that does not fit", () => {
    expect(parts("Joh 15; 16:2")).toBeNull();
    expect(parts("Joh 15:13; 16")).toBeNull();
    expect(parts("Joh 3:16; Röm 5:8")).toBeNull();
    expect(parts("John 3:16; Rom 5:8", en)).toBeNull();
    expect(parts("Joh 15:13; 22:1")).toBeNull();
    expect(parts("Joh 15:13; 16:0")).toBeNull();
    expect(parts("Joh 15:13; 16:4-2")).toBeNull();
    expect(parts("Joh 15:13; 16:2, 0")).toBeNull();
    expect(parts("Joh 15:13;")).toBeNull();
    expect(parts("Ps 23;")).toBeNull();
  });

  it("keeps a comma between chapter and verse, and lists after it", () => {
    expect(parts("Joh 15,13")).toEqual([["Joh 15,13", v(13)]]);
    expect(parts("Joh 15,13,15")).toEqual([["Joh 15,13", v(13)], ["15", v(15)]]);
  });

  it("gives one part for a plain reference", () => {
    expect(parts("Joh 15:13-14")).toEqual([["Joh 15:13-14", v(13, 14)]]);
    expect(parts("Ps 23")).toEqual([["Ps 23", { book: 19, chapter: 23, verse: null }]]);
  });

  it("gives nothing when any verse does not fit", () => {
    expect(parts("Joh 15:13,0")).toBeNull();
    expect(parts("Joh 15:13,17-15")).toBeNull();
    expect(parts("Joh 15:13,")).toBeNull();
    expect(parts("Joh 15:13,15:2")).toBeNull();
    expect(parts("Joh 22:1,2")).toBeNull();
    expect(parts("Joh 15,")).toBeNull();
  });
});

describe("linkEdit", () => {
  it("does not read a long selection as a reference", () => {
    const text = `Joh 15:13, ${"1".repeat(600)}`;
    expect(linkEdit(text, 0, text.length, de).text).toBe(`[${text}]()`);
    expect(linkEdit("Joh 15:13", 0, 9, de).text).toBe("[Joh 15:13](pergament://bible/43:15:13-43:15:13)");
  });
});
