// Local dates are compared as calendar days, so the suite runs where clocks change (DST on 29 Mar and 25 Oct 2026).
process.env.TZ = "Europe/Berlin";

import { afterEach, describe, expect, it } from "vitest";
import { locales } from "@/locales";
import { setUiLang } from "@/lib/i18n";
import type { DaySpan, PlanSchedule, ReadingPlanState } from "@/lib/api";
import { BOOK_NAMES, bookName, dayOf, knownPlans, passageLabel, planStatus, planTitle, readBefore } from "@/lib/reading-plans";

afterEach(() => setUiLang("en"));

const plan = (startDate: string, done: number[], planKey = "greek-90-v1"): ReadingPlanState => ({
  guid: `g-${planKey}`,
  planKey,
  startDate,
  done,
});
const span = (startBook: number, startChapter: number, endBook: number, endChapter: number): DaySpan => ({
  day: 1,
  startBook,
  startChapter,
  endBook,
  endChapter,
});

describe("dayOf", () => {
  it("counts calendar days from the start, the start being day 1", () => {
    expect(dayOf("2026-11-01", "2026-11-21")).toBe(21);
    expect(dayOf("2026-11-21", "2026-11-20")).toBe(0);
  });

  it("is not thrown off by clock changes or leap days", () => {
    expect(dayOf("2026-03-28", "2026-03-30")).toBe(3);
    expect(dayOf("2026-10-24", "2026-10-26")).toBe(3);
    expect(dayOf("2028-02-28", "2028-03-01")).toBe(3);
  });
});

describe("planStatus", () => {
  // Started 1 Nov: 5 Nov is day 5, 12 Nov is day 12.
  const start = "2026-11-01";

  it("is upcoming before the start", () => {
    expect(planStatus(plan(start, []), 10, "2026-10-31")).toEqual({ kind: "upcoming", startsOn: start });
  });

  it("counts unticked days before today as behind, but not today", () => {
    expect(planStatus(plan(start, [1, 2]), 10, "2026-11-05")).toEqual({ kind: "running", day: 5, behind: 2 });
    expect(planStatus(plan(start, [1, 2, 3, 4, 5]), 10, "2026-11-05")).toEqual({ kind: "running", day: 5, behind: 0 });
  });

  it("has ended after the last day with days left", () => {
    expect(planStatus(plan(start, [1, 2, 3, 4, 5, 6, 7, 8]), 10, "2026-11-12")).toEqual({ kind: "ended", left: 2, firstOpen: 9 });
  });

  it("is finished with every day ticked, on any day", () => {
    const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const today of ["2026-10-01", "2026-11-05", "2027-01-01"]) {
      expect(planStatus(plan(start, all), 10, today)).toEqual({ kind: "finished" });
    }
  });

  it("ignores ticked days outside the plan", () => {
    expect(planStatus(plan(start, [0, 1, 11, 12, 99]), 10, "2026-11-05")).toEqual({ kind: "running", day: 5, behind: 3 });
    expect(planStatus(plan(start, [1, 2, 3, 4, 5, 6, 7, 8, 9, 11]), 10, "2026-11-12")).toEqual({
      kind: "ended",
      left: 1,
      firstOpen: 10,
    });
  });
});

describe("passageLabel", () => {
  it("names a range, a single chapter and a range across books", () => {
    expect(passageLabel(span(1, 1, 1, 3))).toBe("Genesis 1–3");
    expect(passageLabel(span(19, 119, 19, 119))).toBe("Psalms 119");
    expect(passageLabel(span(1, 50, 2, 2))).toBe("Genesis 50 – Exodus 2");
  });

  it("takes the book names from the interface language", () => {
    setUiLang("de");
    expect(passageLabel(span(1, 1, 1, 3))).toBe("1. Mose 1–3");
    expect(passageLabel(span(1, 50, 2, 2))).toBe("1. Mose 50 – 2. Mose 2");
    expect(bookName(66)).toBe("Offenbarung");
  });
});

describe("readBefore", () => {
  it("ticks the days before today for a past start, never more than the plan has", () => {
    expect(readBefore("2026-11-21", "2026-11-21", 90)).toBeNull();
    expect(readBefore("2026-11-20", "2026-11-21", 90)).toBe(2);
    expect(readBefore("2026-05-05", "2026-11-21", 90)).toBe(91);
    expect(readBefore("2026-11-22", "2026-11-21", 90)).toBeNull();
  });
});

describe("knownPlans", () => {
  it("joins plans with their schedule and drops keys the catalog does not have", () => {
    const catalog: PlanSchedule[] = [
      { key: "bible-365-v1", days: [] },
      { key: "greek-90-v1", days: [] },
      { key: "psalms-30-v1", days: [] },
    ];
    const states = [plan("2026-11-01", [], "bible-365-v1"), plan("2026-11-01", [], "nt-60-v2"), plan("2026-11-01", [], "psalms-30-v1")];
    expect(knownPlans(states, catalog)).toEqual([
      { state: states[0], schedule: catalog[0] },
      { state: states[2], schedule: catalog[2] },
    ]);
  });

  it("drops plans whose start date is not a calendar date", () => {
    const catalog: PlanSchedule[] = [{ key: "psalms-30-v1", days: [] }];
    const good = plan("2028-02-29", [], "psalms-30-v1");
    const bad = ["", "2026-11", "2026-1-01", "2026-02-30", "2026-13-01", "2027-02-29", "26-11-01", "2026-11-01T00:00", "x"];
    const states = [good, ...bad.map((d) => plan(d, [], "psalms-30-v1"))];
    expect(knownPlans(states, catalog)).toEqual([{ state: good, schedule: catalog[0] }]);
  });
});

describe("planTitle", () => {
  it("titles the known plans and nothing else", () => {
    expect(planTitle("bible-365-v1")).toBe("Bible in a year");
    expect(planTitle("greek-90-v1")).toBe("Greek Scriptures in 90 days");
    expect(planTitle("psalms-30-v1")).toBe("Psalms in 30 days");
    expect(planTitle("nt-60-v2")).toBeNull();
  });
});

describe("book names", () => {
  it("has the 66 books", () => {
    expect(BOOK_NAMES).toHaveLength(66);
    expect([BOOK_NAMES[0], BOOK_NAMES[18], BOOK_NAMES[21], BOOK_NAMES[65]]).toEqual([
      "Genesis",
      "Psalms",
      "Song of Solomon",
      "Revelation",
    ]);
  });

  it.each(locales)("every locale names every book and plan: $code", (l) => {
    const titles = ["Bible in a year", "Greek Scriptures in 90 days", "Psalms in 30 days"];
    for (const key of [...BOOK_NAMES, ...titles]) expect(l.texts[key]?.trim(), key).toBeTruthy();
  });
});
