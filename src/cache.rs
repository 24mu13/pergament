//! Size and removal of the cache directory (catalog, covers, partial downloads).
//! Everything in it can be fetched again; downloaded publications and user
//! data live elsewhere and are never touched here.

use std::fs;
use std::path::Path;

use crate::Result;

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

fn kind_of(name: &str) -> Kind {
    if (name.starts_with("catalog-") && name.ends_with(".db"))
        || (name.starts_with("catalog-") && name.ends_with(".db.gz"))
        || (name.starts_with(".catalog-") && name.ends_with(".tmp"))
    {
        Kind::Catalog
    } else if name == "catalog-images" || name == "cms-images" {
        Kind::Covers
    } else {
        Kind::Other
    }
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
        let bytes = size_of(&e.path(), &mut u.partial)?;
        match kind_of(&name) {
            Kind::Catalog => u.catalog += bytes,
            Kind::Covers => u.covers += bytes,
            Kind::Other => u.other += bytes,
        }
    }
    Ok(u)
}

/// Remove everything inside `dir`, keeping the directory itself.
pub fn clear(dir: &Path) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for e in fs::read_dir(dir)? {
        let path = e?.path();
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

    #[cfg(unix)]
    #[test]
    fn clear_does_not_follow_symlinks() {
        let outside = tempfile::tempdir().unwrap();
        write(outside.path(), "keep.txt", 5);
        let d = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("link")).unwrap();
        clear(d.path()).unwrap();
        assert!(outside.path().join("keep.txt").exists());
        assert!(!d.path().join("link").exists());
        assert_eq!(usage(d.path()).unwrap().total(), 0);
    }
}
