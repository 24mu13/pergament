import type { DaySpan, PlanSchedule, ReadingPlanState } from "./api";
import { t } from "./i18n";

/** English names, index = book number - 1; each is also a translation key. The New World Translation's names, as wol.jw.org lists them. */
export const BOOK_NAMES: readonly string[] = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
  "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew",
  "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians",
  "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter",
  "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
];

export const bookName = (book: number): string => t(BOOK_NAMES[book - 1]);

/** Titles for the known keys; unknown keys return null and are not shown. */
export function planTitle(key: string): string | null {
  switch (key) {
    case "bible-365-v1":
      return t("Bible in a year");
    case "greek-90-v1":
      return t("Greek Scriptures in 90 days");
    case "psalms-30-v1":
      return t("Psalms in 30 days");
    default:
      return null;
  }
}

const utcDay = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Calendar day of `today` in a plan started on `start` (both YYYY-MM-DD): start → 1, the day before → 0. */
export function dayOf(start: string, today: string): number {
  return utcDay(today) - utcDay(start) + 1;
}

export type PlanStatus =
  | { kind: "upcoming"; startsOn: string }
  | { kind: "running"; day: number; behind: number }
  | { kind: "ended"; left: number; firstOpen: number }
  | { kind: "finished" };

/** Where a plan stands on `today`. Behind counts the unticked days before today; after the last day, every unticked day. */
export function planStatus(state: ReadingPlanState, total: number, today: string): PlanStatus {
  const done = new Set(state.done.filter((d) => d >= 1 && d <= total));
  if (done.size === total) return { kind: "finished" };
  const day = dayOf(state.startDate, today);
  if (day < 1) return { kind: "upcoming", startsOn: state.startDate };
  if (day > total) {
    let firstOpen = 1;
    while (done.has(firstOpen)) firstOpen++;
    return { kind: "ended", left: total - done.size, firstOpen };
  }
  let behind = 0;
  for (let d = 1; d < day; d++) if (!done.has(d)) behind++;
  return { kind: "running", day, behind };
}

/** "Genesis 1–3", "Psalms 119", "Genesis 50 – Exodus 2" (en dash; spaced when crossing books). */
export function passageLabel(span: DaySpan): string {
  const start = bookName(span.startBook);
  if (span.startBook !== span.endBook) return `${start} ${span.startChapter} – ${bookName(span.endBook)} ${span.endChapter}`;
  if (span.startChapter === span.endChapter) return `${start} ${span.startChapter}`;
  return `${start} ${span.startChapter}–${span.endChapter}`;
}

/** The `readBefore` to send for a start date: today's day when it is past day 1, capped at total + 1; else null. */
export function readBefore(start: string, today: string, total: number): number | null {
  const day = dayOf(start, today);
  return day > 1 ? Math.min(day, total + 1) : null;
}

/** True for a real YYYY-MM-DD calendar date ("2026-02-30" is not one). */
export function isCalendarDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

/** Running plans joined with their schedule; unknown keys and malformed start dates (e.g. from a merge) dropped. */
export function knownPlans(
  states: ReadingPlanState[],
  catalog: PlanSchedule[],
): { state: ReadingPlanState; schedule: PlanSchedule }[] {
  const byKey = new Map(catalog.map((s) => [s.key, s]));
  return states.flatMap((state) => {
    const schedule = byKey.get(state.planKey);
    return schedule && isCalendarDate(state.startDate) ? [{ state, schedule }] : [];
  });
}
