//! Size and removal of the cache directory (catalog, covers, partial downloads).
//! Everything in it can be fetched again; downloaded publications and user
//! data live elsewhere and are never touched here.
//!
//! Only the entries Pergament itself creates are measured and removed, so a
//! cache directory pointed at a shared folder never loses foreign files.

use std::fs;
use std::path::{Path, PathBuf};

use crate::{Error, Result};

/// Bytes by kind of cache content.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// The publication catalog (database, its download and temp file).
    pub catalog: u64,
    /// Cover images of the catalog and the media catalog.
    pub covers: u64,
    /// Unfinished downloads (`*.part`).
    pub partial: u64,
    /// Language list, media category lists, anything else.
    pub other: u64,
}

impl Usage {
    pub fn total(&self) -> u64 {
        self.catalog + self.covers + self.partial + self.other
    }
}

enum Kind {
    Catalog,
    Covers,
    Other,
}

/// What a top-level cache entry is, or `None` if Pergament did not create it.
/// Keep in sync with the writers: `catalog.rs` (catalog files), `api.rs`
/// (`catalog-images`, `cms-images`), `languages.rs`, `mediator.rs`, the
/// download commands (`downloads`) and older versions (`view`).
fn kind_of(name: &str) -> Option<Kind> {
    if name == "catalog-images" || name == "cms-images" {
        Some(Kind::Covers)
    } else if (name.starts_with("catalog-") && name.ends_with(".db"))
        || (name.starts_with("catalog-") && name.ends_with(".db.gz"))
        || (name.starts_with(".catalog-") && name.ends_with(".tmp"))
    {
        Some(Kind::Catalog)
    } else if matches!(name, "downloads" | "languages.json" | "mediator" | "view") {
        Some(Kind::Other)
    } else {
        None
    }
}

/// Fail unless `cache` can be emptied without touching the library at
/// `library_root` or a directory as broad as the home or a filesystem root.
pub fn check_safe(cache: &Path, library_root: &Path) -> Result<()> {
    check_safe_with_home(cache, library_root, dirs::home_dir().as_deref())
}

/// The real location of `p`. For a path that does not exist (yet), the
/// nearest existing ancestor is resolved and the rest appended.
fn resolved(p: &Path) -> PathBuf {
    let abs = std::path::absolute(p).unwrap_or_else(|_| p.to_owned());
    let mut base = abs.as_path();
    let mut rest = Vec::new();
    loop {
        if let Ok(real) = fs::canonicalize(base) {
            let mut out = real;
            for part in rest.iter().rev() {
                match part {
                    std::path::Component::ParentDir => {
                        out.pop();
                    }
                    std::path::Component::CurDir => {}
                    c => out.push(c),
                }
            }
            return out;
        }
        match (base.parent(), base.components().next_back()) {
            (Some(parent), Some(last)) => {
                rest.push(last);
                base = parent;
            }
            _ => return abs,
        }
    }
}

fn check_safe_with_home(cache: &Path, library_root: &Path, home: Option<&Path>) -> Result<()> {
    let refuse = |reason: &str| {
        Err(Error::UnsafeCache {
            path: cache.to_owned(),
            reason: reason.to_owned(),
        })
    };
    let c = resolved(cache);
    let root = resolved(library_root);
    if c == root {
        return refuse("it is the library folder");
    }
    if root.starts_with(&c) {
        return refuse("it contains the library folder");
    }
    if c.starts_with(&root) {
        return refuse("it is inside the library folder");
    }
    if c.parent().is_none() {
        return refuse("it is a filesystem root");
    }
    if home.is_some_and(|h| resolved(h) == c) {
        return refuse("it is the home folder");
    }
    Ok(())
}

/// Bytes below `path`; symlinks count as zero and are not followed.
/// `.part` files are added to `partial` instead of the returned size.
fn size_of(path: &Path, partial: &mut u64) -> Result<u64> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        return Ok(0);
    }
    if meta.is_file() {
        if path.extension().is_some_and(|e| e == "part") {
            *partial += meta.len();
            return Ok(0);
        }
        return Ok(meta.len());
    }
    let mut n = 0;
    for e in fs::read_dir(path)? {
        n += size_of(&e?.path(), partial)?;
    }
    Ok(n)
}

/// Sizes of the cache in `dir`; zeros if it does not exist.
pub fn usage(dir: &Path) -> Result<Usage> {
    let mut u = Usage::default();
    if !dir.is_dir() {
        return Ok(u);
    }
    for e in fs::read_dir(dir)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(kind) = kind_of(&name) else {
            continue;
        };
        let bytes = size_of(&e.path(), &mut u.partial)?;
        match kind {
            Kind::Catalog => u.catalog += bytes,
            Kind::Covers => u.covers += bytes,
            Kind::Other => u.other += bytes,
        }
    }
    Ok(u)
}

/// Remove what Pergament stored inside `dir`, keeping the directory itself
/// and anything else in it. Callers check [`check_safe`] first.
pub fn clear(dir: &Path) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for e in fs::read_dir(dir)? {
        let e = e?;
        if kind_of(&e.file_name().to_string_lossy()).is_none() {
            continue;
        }
        let path = e.path();
        let meta = fs::symlink_metadata(&path)?;
        if meta.is_dir() && !meta.file_type().is_symlink() {
            fs::remove_dir_all(&path)?;
        } else {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(dir: &Path, rel: &str, bytes: usize) {
        let p = dir.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, vec![0u8; bytes]).unwrap();
    }

    #[test]
    fn sizes_each_kind() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "catalog-abc.db", 1000);
        write(d.path(), "catalog-abc.db.gz", 100);
        write(d.path(), "catalog-images/ab/c.jpg", 10);
        write(d.path(), "cms-images/p/x.jpg", 5);
        write(d.path(), "downloads/w_E.jwpub.part", 7);
        write(d.path(), "downloads/other.jwpub", 3);
        write(d.path(), "languages.json", 2);
        write(d.path(), "mediator/E/x.json", 4);
        let u = usage(d.path()).unwrap();
        assert_eq!(
            (u.catalog, u.covers, u.partial, u.other),
            (1100, 15, 7, 2 + 4 + 3)
        );
        assert_eq!(u.total(), 1100 + 15 + 7 + 9);
    }

    #[test]
    fn missing_dir_is_empty() {
        let d = tempfile::tempdir().unwrap();
        let u = usage(&d.path().join("nope")).unwrap();
        assert_eq!(u.total(), 0);
        clear(&d.path().join("nope")).unwrap();
    }

    #[test]
    fn clear_removes_contents_but_keeps_the_directory() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "catalog-abc.db", 10);
        write(d.path(), "downloads/a.part", 10);
        write(d.path(), "cms-images/p/x.jpg", 10);
        clear(d.path()).unwrap();
        assert!(d.path().is_dir());
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 0);
        assert_eq!(usage(d.path()).unwrap().total(), 0);
    }

    #[test]
    fn clear_leaves_unknown_entries_alone() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "catalog-abc.db", 10);
        write(d.path(), "view/x.html", 10);
        write(d.path(), "keep.txt", 3);
        write(d.path(), "Documents/thesis.odt", 4);
        write(d.path(), "catalog-notes.txt", 5);
        let u = usage(d.path()).unwrap();
        assert_eq!(u.total(), 20, "only what clear removes is counted");
        clear(d.path()).unwrap();
        assert!(d.path().join("keep.txt").is_file());
        assert!(d.path().join("Documents/thesis.odt").is_file());
        assert!(d.path().join("catalog-notes.txt").is_file());
        assert!(!d.path().join("catalog-abc.db").exists());
        assert!(!d.path().join("view").exists());
        assert_eq!(usage(d.path()).unwrap().total(), 0);
    }

    fn safe(cache: &Path, root: &Path, home: Option<&Path>) -> bool {
        check_safe_with_home(cache, root, home).is_ok()
    }

    #[test]
    fn refuses_a_cache_that_is_the_library() {
        let d = tempfile::tempdir().unwrap();
        assert!(!safe(d.path(), d.path(), None));
        // Also through a different spelling of the same directory.
        let dotted = d.path().join(".");
        assert!(!safe(&dotted, d.path(), None));
    }

    #[test]
    fn refuses_a_cache_that_contains_the_library() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("data/pergament");
        fs::create_dir_all(&root).unwrap();
        assert!(!safe(d.path(), &root, None));
    }

    #[test]
    fn refuses_a_cache_inside_the_library() {
        let d = tempfile::tempdir().unwrap();
        let cache = d.path().join("cache");
        fs::create_dir_all(&cache).unwrap();
        assert!(!safe(&cache, d.path(), None));
        // Even if the cache does not exist yet.
        assert!(!safe(&d.path().join("later"), d.path(), None));
    }

    #[test]
    fn allows_unrelated_directories() {
        let d = tempfile::tempdir().unwrap();
        let cache = d.path().join("cache/pergament");
        let root = d.path().join("data/pergament");
        fs::create_dir_all(&cache).unwrap();
        fs::create_dir_all(&root).unwrap();
        assert!(safe(&cache, &root, Some(d.path())));
        // A sibling whose name starts like the library is still unrelated.
        let sibling = d.path().join("data/pergament-cache");
        fs::create_dir_all(&sibling).unwrap();
        assert!(safe(&sibling, &root, Some(d.path())));
    }

    #[test]
    fn allows_a_cache_that_does_not_exist_yet() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("data");
        fs::create_dir_all(&root).unwrap();
        assert!(safe(&d.path().join("nope/pergament"), &root, None));
    }

    #[test]
    fn refuses_the_home_directory() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        assert!(!safe(home.path(), root.path(), Some(home.path())));
        assert!(safe(
            &home.path().join(".cache/pergament"),
            root.path(),
            Some(home.path())
        ));
    }

    #[test]
    fn refuses_a_filesystem_root() {
        let root = tempfile::tempdir().unwrap();
        assert!(!safe(Path::new("/"), root.path(), None));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_to_the_library() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("data");
        fs::create_dir_all(&root).unwrap();
        let link = d.path().join("link");
        std::os::unix::fs::symlink(&root, &link).unwrap();
        assert!(!safe(&link, &root, None));
    }

    #[cfg(unix)]
    #[test]
    fn clear_does_not_follow_symlinks() {
        let outside = tempfile::tempdir().unwrap();
        write(outside.path(), "keep.txt", 5);
        let d = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("mediator")).unwrap();
        clear(d.path()).unwrap();
        assert!(outside.path().join("keep.txt").exists());
        assert!(fs::symlink_metadata(d.path().join("mediator")).is_err());
        assert_eq!(usage(d.path()).unwrap().total(), 0);
    }
}
