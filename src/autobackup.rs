//! Rolling backups: timestamped `.jwlibrary` files in one folder, newest kept.

use std::fs;
use std::path::{Path, PathBuf};

use crate::Result;
use crate::userdata::{DEVICE_NAME, UserData};

/// Folder name, inside the app data directory, for rolling backups.
pub const ROLLING_DIR: &str = "backups";

const PREFIX: &str = "Pergament-";
const SUFFIX: &str = ".jwlibrary";

/// A rolling backup that was just written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Written {
    pub path: PathBuf,
    pub fingerprint: String,
}

/// File name of the rolling backup made at `stamp` (`YYYY-MM-DD-HHMMSS`).
pub fn rolling_name(stamp: &str) -> String {
    format!("{PREFIX}{stamp}{SUFFIX}")
}

/// Whether `name` is exactly `Pergament-YYYY-MM-DD-HHMMSS.jwlibrary`.
pub fn is_rolling_name(name: &str) -> bool {
    let Some(stamp) = name
        .strip_prefix(PREFIX)
        .and_then(|rest| rest.strip_suffix(SUFFIX))
    else {
        return false;
    };
    // Dashes at 4, 7 and 10; digits everywhere else.
    stamp.len() == 17
        && stamp.bytes().enumerate().all(|(i, b)| match i {
            4 | 7 | 10 => b == b'-',
            _ => b.is_ascii_digit(),
        })
}

/// Write a backup of `ud` into `dir` unless its content still matches
/// `last`, then prune to the newest `keep` files. Two writes within one
/// second share a name, so the later one replaces the earlier.
pub fn write_rolling(
    ud: &UserData,
    dir: &Path,
    keep: usize,
    last: Option<&str>,
) -> Result<Option<Written>> {
    let fingerprint = ud.fingerprint()?;
    if last == Some(fingerprint.as_str()) {
        return Ok(None);
    }
    fs::create_dir_all(dir)?;
    let path = dir.join(rolling_name(&ud.local_stamp()?));
    ud.export_backup_as(&path, DEVICE_NAME)?;
    // The backup exists; a failed prune must not make the caller export again.
    if let Err(e) = prune(dir, keep) {
        eprintln!("cannot prune old rolling backups: {e}");
    }
    Ok(Some(Written { path, fingerprint }))
}

/// Delete the oldest rolling backups in `dir` beyond `keep` (at least 1) and
/// return them. Other files are never touched. The stamp is zero-padded, so
/// name order is age order.
pub fn prune(dir: &Path, keep: usize) -> Result<Vec<PathBuf>> {
    let keep = keep.max(1);
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str()
            && is_rolling_name(name)
        {
            names.push(name.to_owned());
        }
    }
    names.sort();
    let excess = names.len().saturating_sub(keep);
    let mut deleted = Vec::with_capacity(excess);
    for name in names.into_iter().take(excess) {
        let path = dir.join(name);
        fs::remove_file(&path)?;
        deleted.push(path);
    }
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::userdata::{BLOCK_VERSE, DB_NAME, Loc, Range};

    fn open(dir: &Path) -> UserData {
        UserData::open(dir.join(DB_NAME)).unwrap()
    }

    fn mark(ud: &mut UserData) {
        let loc = Loc {
            key_symbol: "nwtsty".into(),
            meps_language: 2,
            issue_tag: 0,
            document_id: None,
            book: Some(19),
            chapter: Some(23),
        };
        let range = Range {
            block_type: BLOCK_VERSE,
            identifier: 1,
            start: 0,
            end: 3,
        };
        ud.add_mark(&loc, None, 3, &[range]).unwrap();
    }

    #[test]
    fn skips_when_unchanged() {
        let tmp = tempfile::tempdir().unwrap();
        let ud = open(tmp.path());
        let dir = tmp.path().join(ROLLING_DIR);
        let first = write_rolling(&ud, &dir, 10, None).unwrap().unwrap();
        assert!(first.path.exists());
        assert!(
            write_rolling(&ud, &dir, 10, Some(&first.fingerprint))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn writes_after_change() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ud = open(tmp.path());
        let dir = tmp.path().join(ROLLING_DIR);
        let first = write_rolling(&ud, &dir, 10, None).unwrap().unwrap();
        mark(&mut ud);
        let second = write_rolling(&ud, &dir, 10, Some(&first.fingerprint))
            .unwrap()
            .unwrap();
        assert_ne!(second.fingerprint, first.fingerprint);

        let other = tempfile::tempdir().unwrap();
        let mut fresh = open(other.path());
        let summary = fresh.restore_backup(&second.path).unwrap();
        assert_eq!(summary.marks, 1);
    }

    #[test]
    fn prune_keeps_newest_and_ignores_others() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        for i in 0..12 {
            fs::write(
                dir.join(rolling_name(&format!("2026-10-{:02}-120000", i + 1))),
                b"x",
            )
            .unwrap();
        }
        for other in ["notes.txt", "Pergament-old.jwlibrary", "x.jwlibrary"] {
            fs::write(dir.join(other), b"x").unwrap();
        }
        let deleted = prune(dir, 10).unwrap();
        assert_eq!(
            deleted,
            vec![
                dir.join("Pergament-2026-10-01-120000.jwlibrary"),
                dir.join("Pergament-2026-10-02-120000.jwlibrary"),
            ]
        );
        let left = fs::read_dir(dir).unwrap().count();
        assert_eq!(left, 13);
        assert!(dir.join("notes.txt").exists());
        assert!(dir.join("Pergament-old.jwlibrary").exists());
        assert!(dir.join("x.jwlibrary").exists());
    }

    #[test]
    fn is_rolling_name_cases() {
        assert!(is_rolling_name("Pergament-2026-10-20-142501.jwlibrary"));
        assert!(!is_rolling_name("Pergament-2026-10-20.jwlibrary"));
        assert!(!is_rolling_name("Pergament-laptop-ab12.jwlibrary"));
        assert!(!is_rolling_name(
            "Pergament-2026-10-20-142501.jwlibrary.part"
        ));
    }
}
