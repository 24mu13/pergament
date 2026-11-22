//! Built-in Bible reading plans. Schedules are generated here from a verse
//! table, so they depend only on the plan key and never on the installed Bible.

use std::ops::Range;
use std::sync::OnceLock;

use serde::Serialize;

/// One day of a plan: the chapters `(start_book, start_chapter) ..=
/// (end_book, end_chapter)`, which may cross a book boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaySpan {
    /// 1-based.
    pub day: i64,
    pub start_book: i64,
    pub start_chapter: i64,
    pub end_book: i64,
    pub end_chapter: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSchedule {
    pub key: &'static str,
    pub days: Vec<DaySpan>,
}

/// Highest verse number of every chapter, NWT: `VERSES[book - 1][chapter - 1]`.
///
/// Source: the New World Translation study Bible (`nwtsty_X.jwpub`), read with
/// `Publication::last_verse` and checked by
/// `tests/real_files.rs::verse_table_matches_the_study_bible`. The NWT keeps the
/// traditional chapter and verse numbering but leaves out Mark 16:9-20 and
/// John 7:53-8:11, so Mark 16 ends at 8 and John 7 at 52: 1,189 chapters and
/// 31,089 verses rather than the 31,102 of other Bibles.
///
/// Changing a value reshuffles every plan; bump the plan keys if you do.
#[rustfmt::skip]
pub const VERSES: [&[u8]; 66] = [
    // 1. Genesis
    &[31, 25, 24, 26, 32, 22, 24, 22, 29, 32, 32, 20, 18, 24, 21, 16, 27, 33, 38, 18, 34, 24, 20, 67, 34, 35, 46, 22, 35, 43, 55, 32, 20, 31, 29, 43, 36, 30, 23, 23, 57, 38, 34, 34, 28, 34, 31, 22, 33, 26],
    // 2. Exodus
    &[22, 25, 22, 31, 23, 30, 25, 32, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 26, 36, 31, 33, 18, 40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38],
    // 3. Leviticus
    &[17, 16, 17, 35, 19, 30, 38, 36, 24, 20, 47, 8, 59, 57, 33, 34, 16, 30, 37, 27, 24, 33, 44, 23, 55, 46, 34],
    // 4. Numbers
    &[54, 34, 51, 49, 31, 27, 89, 26, 23, 36, 35, 16, 33, 45, 41, 50, 13, 32, 22, 29, 35, 41, 30, 25, 18, 65, 23, 31, 40, 16, 54, 42, 56, 29, 34, 13],
    // 5. Deuteronomy
    &[46, 37, 29, 49, 33, 25, 26, 20, 29, 22, 32, 32, 18, 29, 23, 22, 20, 22, 21, 20, 23, 30, 25, 22, 19, 19, 26, 68, 29, 20, 30, 52, 29, 12],
    // 6. Joshua
    &[18, 24, 17, 24, 15, 27, 26, 35, 27, 43, 23, 24, 33, 15, 63, 10, 18, 28, 51, 9, 45, 34, 16, 33],
    // 7. Judges
    &[36, 23, 31, 24, 31, 40, 25, 35, 57, 18, 40, 15, 25, 20, 20, 31, 13, 31, 30, 48, 25],
    // 8. Ruth
    &[22, 23, 18, 22],
    // 9. 1 Samuel
    &[28, 36, 21, 22, 12, 21, 17, 22, 27, 27, 15, 25, 23, 52, 35, 23, 58, 30, 24, 42, 15, 23, 29, 22, 44, 25, 12, 25, 11, 31, 13],
    // 10. 2 Samuel
    &[27, 32, 39, 12, 25, 23, 29, 18, 13, 19, 27, 31, 39, 33, 37, 23, 29, 33, 43, 26, 22, 51, 39, 25],
    // 11. 1 Kings
    &[53, 46, 28, 34, 18, 38, 51, 66, 28, 29, 43, 33, 34, 31, 34, 34, 24, 46, 21, 43, 29, 53],
    // 12. 2 Kings
    &[18, 25, 27, 44, 27, 33, 20, 29, 37, 36, 21, 21, 25, 29, 38, 20, 41, 37, 37, 21, 26, 20, 37, 20, 30],
    // 13. 1 Chronicles
    &[54, 55, 24, 43, 26, 81, 40, 40, 44, 14, 47, 40, 14, 17, 29, 43, 27, 17, 19, 8, 30, 19, 32, 31, 31, 32, 34, 21, 30],
    // 14. 2 Chronicles
    &[17, 18, 17, 22, 14, 42, 22, 18, 31, 19, 23, 16, 22, 15, 19, 14, 19, 34, 11, 37, 20, 12, 21, 27, 28, 23, 9, 27, 36, 27, 21, 33, 25, 33, 27, 23],
    // 15. Ezra
    &[11, 70, 13, 24, 17, 22, 28, 36, 15, 44],
    // 16. Nehemiah
    &[11, 20, 32, 23, 19, 19, 73, 18, 38, 39, 36, 47, 31],
    // 17. Esther
    &[22, 23, 15, 17, 14, 14, 10, 17, 32, 3],
    // 18. Job
    &[22, 13, 26, 21, 27, 30, 21, 22, 35, 22, 20, 25, 28, 22, 35, 22, 16, 21, 29, 29, 34, 30, 17, 25, 6, 14, 23, 28, 25, 31, 40, 22, 33, 37, 16, 33, 24, 41, 30, 24, 34, 17],
    // 19. Psalms
    &[6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12, 14, 9, 11, 12, 24, 11, 22, 22, 28, 12, 40, 22, 13, 17, 13, 11, 5, 26, 17, 11, 9, 14, 20, 23, 19, 9, 6, 7, 23, 13, 11, 11, 17, 12, 8, 12, 11, 10, 13, 20, 7, 35, 36, 5, 24, 20, 28, 23, 10, 12, 20, 72, 13, 19, 16, 8, 18, 12, 13, 17, 7, 18, 52, 17, 16, 15, 5, 23, 11, 13, 12, 9, 9, 5, 8, 28, 22, 35, 45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3, 18, 3, 3, 21, 26, 9, 8, 24, 13, 10, 7, 12, 15, 21, 10, 20, 14, 9, 6],
    // 20. Proverbs
    &[33, 22, 35, 27, 23, 35, 27, 36, 18, 32, 31, 28, 25, 35, 33, 33, 28, 24, 29, 30, 31, 29, 35, 34, 28, 28, 27, 28, 27, 33, 31],
    // 21. Ecclesiastes
    &[18, 26, 22, 16, 20, 12, 29, 17, 18, 20, 10, 14],
    // 22. Song of Solomon
    &[17, 17, 11, 16, 16, 13, 13, 14],
    // 23. Isaiah
    &[31, 22, 26, 6, 30, 13, 25, 22, 21, 34, 16, 6, 22, 32, 9, 14, 14, 7, 25, 6, 17, 25, 18, 23, 12, 21, 13, 29, 24, 33, 9, 20, 24, 17, 10, 22, 38, 22, 8, 31, 29, 25, 28, 28, 25, 13, 15, 22, 26, 11, 23, 15, 12, 17, 13, 12, 21, 14, 21, 22, 11, 12, 19, 12, 25, 24],
    // 24. Jeremiah
    &[19, 37, 25, 31, 31, 30, 34, 22, 26, 25, 23, 17, 27, 22, 21, 21, 27, 23, 15, 18, 14, 30, 40, 10, 38, 24, 22, 17, 32, 24, 40, 44, 26, 22, 19, 32, 21, 28, 18, 16, 18, 22, 13, 30, 5, 28, 7, 47, 39, 46, 64, 34],
    // 25. Lamentations
    &[22, 22, 66, 22, 22],
    // 26. Ezekiel
    &[28, 10, 27, 17, 17, 14, 27, 18, 11, 22, 25, 28, 23, 23, 8, 63, 24, 32, 14, 49, 32, 31, 49, 27, 17, 21, 36, 26, 21, 26, 18, 32, 33, 31, 15, 38, 28, 23, 29, 49, 26, 20, 27, 31, 25, 24, 23, 35],
    // 27. Daniel
    &[21, 49, 30, 37, 31, 28, 28, 27, 27, 21, 45, 13],
    // 28. Hosea
    &[11, 23, 5, 19, 15, 11, 16, 14, 17, 15, 12, 14, 16, 9],
    // 29. Joel
    &[20, 32, 21],
    // 30. Amos
    &[15, 16, 15, 13, 27, 14, 17, 14, 15],
    // 31. Obadiah
    &[21],
    // 32. Jonah
    &[17, 10, 10, 11],
    // 33. Micah
    &[16, 13, 12, 13, 15, 16, 20],
    // 34. Nahum
    &[15, 13, 19],
    // 35. Habakkuk
    &[17, 20, 19],
    // 36. Zephaniah
    &[18, 15, 20],
    // 37. Haggai
    &[15, 23],
    // 38. Zechariah
    &[21, 13, 10, 14, 11, 15, 14, 23, 17, 12, 17, 14, 9, 21],
    // 39. Malachi
    &[14, 17, 18, 6],
    // 40. Matthew
    &[25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39, 51, 46, 75, 66, 20],
    // 41. Mark
    &[45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 8],
    // 42. Luke
    &[80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56, 53],
    // 43. John
    &[51, 25, 36, 54, 47, 71, 52, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],
    // 44. Acts
    &[26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35, 27, 27, 32, 44, 31],
    // 45. Romans
    &[32, 29, 31, 25, 21, 23, 25, 39, 33, 21, 36, 21, 14, 23, 33, 27],
    // 46. 1 Corinthians
    &[31, 16, 23, 21, 13, 20, 40, 13, 27, 33, 34, 31, 13, 40, 58, 24],
    // 47. 2 Corinthians
    &[24, 17, 18, 18, 21, 18, 16, 24, 15, 18, 33, 21, 14],
    // 48. Galatians
    &[24, 21, 29, 31, 26, 18],
    // 49. Ephesians
    &[23, 22, 21, 32, 33, 24],
    // 50. Philippians
    &[30, 30, 21, 23],
    // 51. Colossians
    &[29, 23, 25, 18],
    // 52. 1 Thessalonians
    &[10, 20, 13, 18, 28],
    // 53. 2 Thessalonians
    &[12, 17, 18],
    // 54. 1 Timothy
    &[20, 15, 16, 16, 25, 21],
    // 55. 2 Timothy
    &[18, 26, 17, 22],
    // 56. Titus
    &[16, 15, 15],
    // 57. Philemon
    &[25],
    // 58. Hebrews
    &[14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25],
    // 59. James
    &[27, 26, 18, 17, 20],
    // 60. 1 Peter
    &[25, 25, 22, 19, 14],
    // 61. 2 Peter
    &[21, 22, 18],
    // 62. 1 John
    &[10, 29, 24, 21, 21],
    // 63. 2 John
    &[13],
    // 64. 3 John
    &[14],
    // 65. Jude
    &[25],
    // 66. Revelation
    &[20, 29, 22, 11, 14, 17, 17, 13, 21, 11, 19, 17, 18, 20, 8, 21, 18, 24, 21, 15, 27, 21],
];

/// The built-in plans: key, first book, last book, days.
const PLANS: [(&str, usize, usize, usize); 3] = [
    ("bible-365-v1", 1, 66, 365),
    ("greek-90-v1", 40, 66, 90),
    ("psalms-30-v1", 19, 19, 30),
];

/// Split `verses` (one entry per chapter) into exactly `days` contiguous,
/// non-empty ranges of indices, keeping the largest range sum as small as
/// possible and, within that limit, the range sums as even as possible.
/// Panics unless `1 <= days <= verses.len()`.
pub fn split(verses: &[u32], days: usize) -> Vec<Range<usize>> {
    assert!(
        (1..=verses.len()).contains(&days),
        "cannot split {} chapters into {days} days",
        verses.len()
    );
    // Ranges greedy packing needs when no range may exceed `max`.
    let ranges_needed = |max: u32| {
        let (mut n, mut sum) = (1, 0);
        for &v in verses {
            if sum + v > max {
                n += 1;
                sum = 0;
            }
            sum += v;
        }
        n
    };
    // m = smallest max such that greedy packing needs <= days ranges.
    let (mut lo, mut hi) = (
        verses.iter().copied().max().unwrap_or(0),
        verses.iter().sum::<u32>(),
    );
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if ranges_needed(mid) <= days {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    let m = u64::from(lo);

    // Among the splits whose largest range is m, take the one with the smallest
    // sum of squared range sums, so the reading is spread evenly over the whole
    // plan instead of front-loaded. DP over (ranges, chapters): cost[j][i] is
    // the best cost of cutting the first i chapters into j ranges. A range never
    // exceeds m, so only the few starts within m verses of i are tried. Ties go
    // to the earliest start, so the result depends on the input alone.
    let n = verses.len();
    let prefix: Vec<u64> = std::iter::once(0)
        .chain(verses.iter().scan(0u64, |s, &v| {
            *s += u64::from(v);
            Some(*s)
        }))
        .collect();
    const NONE: u64 = u64::MAX;
    let mut cost = vec![vec![NONE; n + 1]; days + 1];
    let mut from = vec![vec![0usize; n + 1]; days + 1];
    cost[0][0] = 0;
    for j in 1..=days {
        // Range j ends at i; j - 1 ranges before it and days - j after it.
        for i in j..=n - (days - j) {
            let mut k = i - 1;
            let mut best = (NONE, 0);
            loop {
                let s = prefix[i] - prefix[k];
                if s > m {
                    break;
                }
                if cost[j - 1][k] != NONE {
                    let c = cost[j - 1][k] + s * s;
                    if c <= best.0 {
                        best = (c, k);
                    }
                }
                if k < j {
                    break;
                }
                k -= 1;
            }
            cost[j][i] = best.0;
            from[j][i] = best.1;
        }
    }
    assert!(cost[days][n] != NONE, "no split within the minimal maximum");

    let mut out = Vec::with_capacity(days);
    let mut end = n;
    for j in (1..=days).rev() {
        let start = from[j][end];
        out.push(start..end);
        end = start;
    }
    out.reverse();
    out
}

/// Every built-in plan in a fixed order, computed once.
pub fn catalog() -> &'static [PlanSchedule] {
    static CATALOG: OnceLock<Vec<PlanSchedule>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        PLANS
            .iter()
            .map(|&(key, first, last, days)| build(key, first, last, days))
            .collect()
    })
}

pub fn schedule(key: &str) -> Option<&'static PlanSchedule> {
    catalog().iter().find(|p| p.key == key)
}

fn build(key: &'static str, first: usize, last: usize, days: usize) -> PlanSchedule {
    // (book, chapter) of every chapter in the plan, with its verse count.
    let chapters: Vec<(i64, i64)> = (first..=last)
        .flat_map(|book| (1..=VERSES[book - 1].len()).map(move |ch| (book as i64, ch as i64)))
        .collect();
    let verses: Vec<u32> = (first..=last)
        .flat_map(|book| VERSES[book - 1].iter().map(|&v| u32::from(v)))
        .collect();
    let days = split(&verses, days)
        .into_iter()
        .enumerate()
        .map(|(i, range)| {
            let (start_book, start_chapter) = chapters[range.start];
            let (end_book, end_chapter) = chapters[range.end - 1];
            DaySpan {
                day: i as i64 + 1,
                start_book,
                start_chapter,
                end_book,
                end_chapter,
            }
        })
        .collect();
    PlanSchedule { key, days }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sum(verses: &[u32], range: &std::ops::Range<usize>) -> u32 {
        verses[range.clone()].iter().sum()
    }

    fn largest(verses: &[u32], ranges: &[std::ops::Range<usize>]) -> u32 {
        ranges.iter().map(|r| sum(verses, r)).max().unwrap()
    }

    /// Smallest possible largest day over every way to cut `verses` into `days` parts.
    fn brute_force(verses: &[u32], days: usize) -> u32 {
        if days == 1 {
            return verses.iter().sum();
        }
        (1..=verses.len() - (days - 1))
            .map(|cut| {
                let head: u32 = verses[..cut].iter().sum();
                head.max(brute_force(&verses[cut..], days - 1))
            })
            .min()
            .unwrap()
    }

    #[test]
    fn verse_table_totals() {
        assert_eq!(VERSES.len(), 66);
        let chapters: usize = VERSES.iter().map(|b| b.len()).sum();
        assert_eq!(chapters, 1189);
        let verses: u32 = VERSES
            .iter()
            .flat_map(|b| b.iter())
            .map(|&v| v as u32)
            .sum();
        assert_eq!(verses, 31_089); // NWT, see VERSES
        assert_eq!(VERSES[0].len(), 50); // Genesis
        assert_eq!(VERSES[18].len(), 150); // Psalms
        assert_eq!(VERSES[38].len(), 4); // Malachi
        assert_eq!(VERSES[65].len(), 22); // Revelation
        assert_eq!(VERSES[18][118], 176); // Psalm 119
        assert_eq!(VERSES[40][15], 8); // Mark 16
        assert_eq!(VERSES[42][6], 52); // John 7
    }

    #[test]
    fn split_balances() {
        assert_eq!(split(&[5, 5, 5, 5], 2), vec![0..2, 2..4]);
        let v = [10, 1, 1, 1];
        let ranges = split(&v, 2);
        assert_eq!(ranges.len(), 2);
        assert_eq!(largest(&v, &ranges), 10);
        assert_eq!(split(&[1, 1, 1], 3), vec![0..1, 1..2, 2..3]);
    }

    #[test]
    fn split_is_optimal_on_small_inputs() {
        let mut seed: u64 = 0x5eed;
        let mut next = move |n: u64| {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (seed >> 33) % n
        };
        for _ in 0..200 {
            let len = 1 + next(12) as usize;
            let verses: Vec<u32> = (0..len).map(|_| 1 + next(50) as u32).collect();
            let days = 1 + next(len as u64) as usize;
            let ranges = split(&verses, days);
            assert_eq!(ranges.len(), days, "{verses:?} in {days}");
            assert_eq!(ranges[0].start, 0);
            assert_eq!(ranges[days - 1].end, len);
            for w in ranges.windows(2) {
                assert_eq!(w[0].end, w[1].start);
            }
            assert!(ranges.iter().all(|r| !r.is_empty()));
            assert_eq!(
                largest(&verses, &ranges),
                brute_force(&verses, days),
                "{verses:?} in {days}: {ranges:?}"
            );
        }
    }

    #[test]
    fn catalog_shapes() {
        let keys: Vec<_> = catalog().iter().map(|p| p.key).collect();
        assert_eq!(keys, ["bible-365-v1", "greek-90-v1", "psalms-30-v1"]);
        // (key, days, first book, last book)
        for (key, days, first, last) in [
            ("bible-365-v1", 365, 1, 66),
            ("greek-90-v1", 90, 40, 66),
            ("psalms-30-v1", 30, 19, 19),
        ] {
            let plan = schedule(key).unwrap();
            assert_eq!(plan.days.len(), days, "{key}");
            for (i, d) in plan.days.iter().enumerate() {
                assert_eq!(d.day, i as i64 + 1, "{key}");
            }
            let head = plan.days[0];
            assert_eq!((head.start_book, head.start_chapter), (first, 1), "{key}");
            let tail = plan.days[days - 1];
            let last_chapter = VERSES[last as usize - 1].len() as i64;
            assert_eq!((tail.end_book, tail.end_chapter), (last, last_chapter));

            // Walk every chapter of the plan in order; each day must pick up
            // exactly where the previous one stopped.
            let mut expected = (first, 1);
            for d in &plan.days {
                assert_eq!(
                    (d.start_book, d.start_chapter),
                    expected,
                    "{key} day {}",
                    d.day
                );
                assert!((d.start_book, d.start_chapter) <= (d.end_book, d.end_chapter));
                let (b, c) = (d.end_book, d.end_chapter);
                assert!(c >= 1 && c <= VERSES[b as usize - 1].len() as i64);
                expected = if c == VERSES[b as usize - 1].len() as i64 {
                    (b + 1, 1)
                } else {
                    (b, c + 1)
                };
            }
            assert_eq!(expected, (last + 1, 1), "{key}");
        }
        assert!(schedule("nope").is_none());
    }

    /// Verse total of one scheduled day.
    fn day_verses(d: &DaySpan) -> u32 {
        let mut total = 0;
        for book in d.start_book..=d.end_book {
            let chapters = VERSES[book as usize - 1];
            let from = if book == d.start_book {
                d.start_chapter
            } else {
                1
            };
            let to = if book == d.end_book {
                d.end_chapter
            } else {
                chapters.len() as i64
            };
            total += (from..=to)
                .map(|c| u32::from(chapters[c as usize - 1]))
                .sum::<u32>();
        }
        total
    }

    /// The reading is spread over the whole plan, not front-loaded: the first
    /// and second half (by day) are within 10% of each other.
    #[test]
    fn catalog_halves_are_balanced() {
        for (key, days) in [
            ("bible-365-v1", 365),
            ("greek-90-v1", 90),
            ("psalms-30-v1", 30),
        ] {
            let plan = schedule(key).unwrap();
            assert_eq!(plan.days.len(), days, "{key}");
            let totals: Vec<u32> = plan.days.iter().map(day_verses).collect();
            let first: u32 = totals[..days / 2].iter().sum();
            let second: u32 = totals[days / 2..].iter().sum();
            let (lo, hi) = (first.min(second), first.max(second));
            assert!(
                (hi - lo) * 10 <= hi,
                "{key}: first half {first}, second half {second}"
            );
        }
    }

    /// Values from the first green run; a change here reshuffles running plans.
    #[test]
    fn catalog_is_stable() {
        let span = |d, sb, sc, eb, ec| DaySpan {
            day: d,
            start_book: sb,
            start_chapter: sc,
            end_book: eb,
            end_chapter: ec,
        };
        let bible = schedule("bible-365-v1").unwrap();
        assert_eq!(bible.days[0], span(1, 1, 1, 1, 3));
        let greek = schedule("greek-90-v1").unwrap();
        assert_eq!(greek.days[89], span(90, 66, 19, 66, 22));
        let psalms = schedule("psalms-30-v1").unwrap();
        assert_eq!(psalms.days[12], span(13, 19, 67, 19, 69));
        let ps119 = psalms
            .days
            .iter()
            .find(|d| d.start_chapter <= 119 && 119 <= d.end_chapter)
            .unwrap();
        assert_eq!(*ps119, span(26, 19, 119, 19, 119));
    }
}
