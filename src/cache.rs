//! Size and removal of the cache directory (catalog, covers, partial downloads).
//! Everything in it can be fetched again; downloaded publications and user
//! data live elsewhere and are never touched here.
//!
//! Only the files Pergament itself creates (matched by name, also inside its
//! own folders) are measured and removed, so a cache directory pointed at a
//! shared folder never loses foreign files.

use std::fs;
use std::io;
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

/// What a top-level cache entry holds, if Pergament created it.
enum Layout {
    /// A file of ours.
    File,
    /// A directory in which only the files whose names pass the check are
    /// ours; anything else found in it is left alone.
    Dir(fn(&str) -> bool),
}

/// What a top-level cache entry is, or `None` if Pergament did not create it.
/// Keep in sync with the writers: `catalog.rs` (catalog files), `api.rs`
/// (`catalog-images`, `cms-images`), `languages.rs`, `mediator.rs`, the
/// download commands (`downloads`) and older versions (`view`).
fn kind_of(name: &str) -> Option<(Kind, Layout)> {
    let catalog = name.strip_suffix(".part").unwrap_or(name);
    if name == "catalog-images" || name == "cms-images" {
        Some((Kind::Covers, Layout::Dir(is_image)))
    } else if (catalog.starts_with("catalog-") && catalog.ends_with(".db"))
        || (catalog.starts_with("catalog-") && catalog.ends_with(".db.gz"))
        || (name.starts_with(".catalog-") && name.ends_with(".tmp"))
    {
        Some((Kind::Catalog, Layout::File))
    } else {
        match name {
            "languages.json" => Some((Kind::Other, Layout::File)),
            "downloads" => Some((Kind::Other, Layout::Dir(is_publication_part))),
            "mediator" => Some((Kind::Other, Layout::Dir(is_category))),
            "view" => Some((Kind::Other, Layout::Dir(is_page))),
            _ => None,
        }
    }
}

/// A cached cover or media image (`net` downloads it via `<name>.part`).
fn is_image(name: &str) -> bool {
    let name = name.strip_suffix(".part").unwrap_or(name);
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
    matches!(
        ext.as_deref(),
        Some("jpg" | "jpeg" | "png" | "webp" | "gif")
    )
}

/// An unfinished publication download. Finished files are imported and
/// removed right away, so a complete `.jwpub` here is not assumed to be ours.
fn is_publication_part(name: &str) -> bool {
    name.ends_with(".jwpub.part")
}

/// A media category response, `{lang}_{key}_{0|1}.json` (see `mediator.rs`).
fn is_category(name: &str) -> bool {
    let name = name.strip_suffix(".part").unwrap_or(name);
    name.strip_suffix("_0.json")
        .or_else(|| name.strip_suffix("_1.json"))
        .and_then(|rest| rest.split_once('_'))
        .is_some_and(|(lang, key)| {
            crate::mediator::valid_key(lang) && crate::mediator::valid_key(key)
        })
}

/// A page rendered to a file by the GTK reader of older versions.
fn is_page(name: &str) -> bool {
    name.ends_with(".html")
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

/// `Ok(None)` when `r` failed because the path is gone (a download finished
/// or was cancelled while we looked); any other error stays an error.
fn unless_gone<T>(r: io::Result<T>) -> io::Result<Option<T>> {
    match r {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Bytes of the files of ours at `path` (see [`Layout`]); symlinks count as
/// zero and are not followed. `.part` files are added to `partial` instead of
/// the returned size. Entries that vanish during the walk count as zero.
fn size_of(path: &Path, layout: &Layout, partial: &mut u64) -> Result<u64> {
    let Some(meta) = unless_gone(fs::symlink_metadata(path))? else {
        return Ok(0);
    };
    match layout {
        Layout::File if meta.is_file() => Ok(file_size(path, meta.len(), partial)),
        Layout::Dir(is_ours) if meta.is_dir() => dir_size(path, *is_ours, partial),
        _ => Ok(0),
    }
}

fn file_size(path: &Path, len: u64, partial: &mut u64) -> u64 {
    if path.extension().is_some_and(|e| e == "part") {
        *partial += len;
        0
    } else {
        len
    }
}

fn dir_size(dir: &Path, is_ours: fn(&str) -> bool, partial: &mut u64) -> Result<u64> {
    let Some(entries) = unless_gone(fs::read_dir(dir))? else {
        return Ok(0);
    };
    let mut n = 0;
    for e in entries {
        let Some(e) = unless_gone(e)? else { continue };
        let path = e.path();
        let Some(meta) = unless_gone(fs::symlink_metadata(&path))? else {
            continue;
        };
        if meta.is_dir() {
            n += dir_size(&path, is_ours, partial)?;
        } else if meta.is_file() && is_ours(&e.file_name().to_string_lossy()) {
            n += file_size(&path, meta.len(), partial);
        }
    }
    Ok(n)
}

/// Sizes of the cache in `dir`; zeros if it does not exist.
pub fn usage(dir: &Path) -> Result<Usage> {
    let mut u = Usage::default();
    if !dir.is_dir() {
        return Ok(u);
    }
    let Some(entries) = unless_gone(fs::read_dir(dir))? else {
        return Ok(u);
    };
    for e in entries {
        let Some(e) = unless_gone(e)? else { continue };
        let name = e.file_name().to_string_lossy().into_owned();
        let Some((kind, layout)) = kind_of(&name) else {
            continue;
        };
        let bytes = size_of(&e.path(), &layout, &mut u.partial)?;
        match kind {
            Kind::Catalog => u.catalog += bytes,
            Kind::Covers => u.covers += bytes,
            Kind::Other => u.other += bytes,
        }
    }
    Ok(u)
}

/// Remove the files of ours at `path` (see [`Layout`]). A directory is
/// removed too once that leaves it empty; one that still holds other
/// entries, or gained one meanwhile (a download writing into it), stays.
/// Symlinks are never followed or removed. A path that is already gone is fine.
fn remove(path: &Path, layout: &Layout) -> io::Result<()> {
    let Some(meta) = unless_gone(fs::symlink_metadata(path))? else {
        return Ok(());
    };
    match layout {
        Layout::File if meta.is_file() => unless_gone(fs::remove_file(path)).map(drop),
        Layout::Dir(is_ours) if meta.is_dir() => clear_dir(path, *is_ours).map(drop),
        _ => Ok(()),
    }
}

/// Remove the files below `dir` that `is_ours` accepts, then `dir` itself if
/// that emptied it. Returns whether `dir` is gone.
fn clear_dir(dir: &Path, is_ours: fn(&str) -> bool) -> io::Result<bool> {
    let Some(entries) = unless_gone(fs::read_dir(dir))? else {
        return Ok(true);
    };
    let mut removed = false;
    for e in entries {
        let Some(e) = unless_gone(e)? else { continue };
        let path = e.path();
        let Some(meta) = unless_gone(fs::symlink_metadata(&path))? else {
            continue;
        };
        if meta.is_dir() {
            removed |= clear_dir(&path, is_ours)?;
        } else if meta.is_file() && is_ours(&e.file_name().to_string_lossy()) {
            unless_gone(fs::remove_file(&path))?;
            removed = true;
        }
    }
    // Only a directory we emptied is removed: an empty one of someone else's stays.
    if !removed {
        return Ok(false);
    }
    match fs::remove_dir(dir) {
        Err(e) if e.kind() == io::ErrorKind::DirectoryNotEmpty => Ok(false),
        r => unless_gone(r).map(|_| true),
    }
}

/// Remove what Pergament stored inside `dir`, keeping the directory itself
/// and anything else in it. Callers check [`check_safe`] first.
pub fn clear(dir: &Path) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    let Some(entries) = unless_gone(fs::read_dir(dir))? else {
        return Ok(());
    };
    for e in entries {
        let Some(e) = unless_gone(e)? else { continue };
        if let Some((_, layout)) = kind_of(&e.file_name().to_string_lossy()) {
            remove(&e.path(), &layout)?;
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
        write(d.path(), "catalog-abc.db.gz.part", 20);
        write(d.path(), "downloads/w_E.jwpub.part", 7);
        write(d.path(), "languages.json", 2);
        write(d.path(), "mediator/E_x_1.json", 4);
        write(d.path(), "view/1.html", 3);
        let u = usage(d.path()).unwrap();
        assert_eq!(
            (u.catalog, u.covers, u.partial, u.other),
            (1100, 15, 27, 2 + 4 + 3)
        );
        assert_eq!(u.total(), 1100 + 15 + 27 + 9);
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
        write(d.path(), "downloads/a_E_0.jwpub.part", 10);
        write(d.path(), "mediator/E_VideoOnDemand_0.json", 10);
        write(d.path(), "cms-images/p/x.jpg", 10);
        clear(d.path()).unwrap();
        assert!(d.path().is_dir());
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 0);
        assert_eq!(usage(d.path()).unwrap().total(), 0);
    }

    #[test]
    fn vanished_paths_are_not_errors() {
        let d = tempfile::tempdir().unwrap();
        let gone = d.path().join("downloads/w_E.jwpub.part");
        let mut partial = 0;
        let file = Layout::File;
        let dir = Layout::Dir(is_category);
        assert_eq!(size_of(&gone, &file, &mut partial).unwrap(), 0);
        assert_eq!(partial, 0);
        remove(&gone, &file).unwrap();
        remove(&d.path().join("mediator"), &dir).unwrap();
        assert!(unless_gone(fs::read_dir(&gone)).unwrap().is_none());
        let denied = io::Error::from(io::ErrorKind::PermissionDenied);
        assert!(unless_gone::<()>(Err(denied)).is_err());
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

    #[test]
    fn clear_keeps_foreign_files_in_folders_with_our_names() {
        // A cache pointed at a shared folder that has its own `downloads`.
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "downloads/w_E_202401_0.jwpub.part", 10);
        write(d.path(), "downloads/w_E_202401.jwpub", 3);
        write(d.path(), "downloads/holiday/photo.jpg", 4);
        write(d.path(), "mediator/E_x_0.json", 10);
        write(d.path(), "mediator/settings.json", 5);
        write(d.path(), "view/index.css", 6);
        write(d.path(), "cms-images/p/a/x.jpg", 10);
        write(d.path(), "cms-images/p/readme.txt", 7);
        fs::create_dir_all(d.path().join("languages.json")).unwrap();
        write(d.path(), "languages.json/x.json", 8);
        let u = usage(d.path()).unwrap();
        assert_eq!(u.total(), 30, "only what clear removes is counted");
        clear(d.path()).unwrap();
        for kept in [
            "downloads/w_E_202401.jwpub",
            "downloads/holiday/photo.jpg",
            "mediator/settings.json",
            "view/index.css",
            "cms-images/p/readme.txt",
            "languages.json/x.json",
        ] {
            assert!(d.path().join(kept).is_file(), "{kept}");
        }
        assert!(!d.path().join("downloads/w_E_202401_0.jwpub.part").exists());
        assert!(!d.path().join("mediator/E_x_0.json").exists());
        // Emptied folders go, the ones still holding something stay.
        assert!(!d.path().join("cms-images/p/a").exists());
        assert!(d.path().join("cms-images/p").is_dir());
        assert_eq!(usage(d.path()).unwrap().total(), 0);
    }

    #[test]
    fn clear_keeps_an_empty_folder_it_did_not_empty() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("downloads")).unwrap();
        clear(d.path()).unwrap();
        assert!(d.path().join("downloads").is_dir());
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
        write(outside.path(), "E_x_0.json", 5);
        std::os::unix::fs::symlink(outside.path(), d.path().join("cms-images")).unwrap();
        write(d.path(), "downloads/w_E_0.jwpub.part", 5);
        std::os::unix::fs::symlink(outside.path(), d.path().join("downloads/link")).unwrap();
        assert_eq!(usage(d.path()).unwrap().total(), 5);
        clear(d.path()).unwrap();
        assert!(outside.path().join("keep.txt").exists());
        assert!(outside.path().join("E_x_0.json").exists());
        assert!(fs::symlink_metadata(d.path().join("downloads/link")).is_ok());
        assert_eq!(usage(d.path()).unwrap().total(), 0);
    }
}
