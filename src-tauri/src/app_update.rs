//! Updating the app itself from its GitHub releases: finding a newer signed
//! release for the way the app was installed.

use std::env;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The minisign key the release workflow signs updates with (base64, as Tauri writes it).
pub const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE5NTJCRjMwMzRCRjhDNjUKUldSbGpMODBNTDlTcWRKOW9tOEhpcHlkYmtJWjNFemtLajBUZXlyTWNub3BxNWloTjlaY2RNdUQK";

pub const RELEASES_URL: &str = "https://api.github.com/repos/v3rm1n0/pergament/releases/latest";

/// Where the release notes GitHub generates start; the install text in front is skipped.
const NOTES_MARKER: &str = "<!-- changes -->";

/// How the running app was installed, which decides whether it can replace itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallKind {
    /// Built by the flake; Nix manages the files.
    Nix,
    /// The AppImage file at this path.
    AppImage(PathBuf),
    /// The release zip's `install.sh`, with both binaries in this writable directory.
    Zip { bin_dir: PathBuf },
    /// Anything the app cannot update itself: packages, flatpak, macOS, a root-owned prefix.
    Manual,
}

pub fn install_kind(nix: bool, appimage: Option<&Path>, exe: &Path) -> InstallKind {
    if nix {
        return InstallKind::Nix;
    }
    if let Some(image) = appimage {
        return InstallKind::AppImage(image.to_owned());
    }
    let Some(bin_dir) = exe.parent() else {
        return InstallKind::Manual;
    };
    if exe.file_name().is_some_and(|n| n == "pergament-app")
        && bin_dir.join("pergament").is_file()
        && writable(bin_dir)
    {
        InstallKind::Zip {
            bin_dir: bin_dir.to_owned(),
        }
    } else {
        InstallKind::Manual
    }
}

/// Tried rather than read from the mode bits, which miss ACLs, read-only mounts and root.
fn writable(dir: &Path) -> bool {
    tempfile::NamedTempFile::new_in(dir).is_ok()
}

pub fn current_install_kind() -> InstallKind {
    let appimage = env::var_os("APPIMAGE").map(PathBuf::from);
    match env::current_exe() {
        Ok(exe) => install_kind(
            option_env!("PERGAMENT_UPDATER") == Some("nix"),
            appimage.as_deref(),
            &exe,
        ),
        Err(_) => InstallKind::Manual,
    }
}

/// `v1.2.3`, `1.2.3+build` or `1.2.3-rc1` as numbers; the suffix is ignored.
pub fn parse_version(s: &str) -> Option<(u64, u64, u64)> {
    let s = s.strip_prefix('v').unwrap_or(s);
    let core = s.split(['+', '-']).next()?;
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    let v = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(v)
}

pub fn is_newer(latest: &str, running: &str) -> bool {
    match (parse_version(latest), parse_version(running)) {
        (Some(l), Some(r)) => l > r,
        _ => false,
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Release {
    pub tag_name: String,
    pub body: Option<String>,
    pub html_url: String,
    pub assets: Vec<Asset>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Asset {
    pub name: String,
    pub browser_download_url: String,
}

pub fn release_notes(body: &str) -> &str {
    body.split_once(NOTES_MARKER)
        .map_or(body, |(_, notes)| notes)
        .trim()
}

/// The download for `kind` and its signature, if the release has both.
pub fn assets_for<'r>(
    release: &'r Release,
    kind: &InstallKind,
    arch: &str,
) -> Option<(&'r Asset, &'r Asset)> {
    let version = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name);
    let name = match kind {
        InstallKind::Zip { .. } => format!("pergament-{version}-linux-{arch}.zip"),
        InstallKind::AppImage(_) => format!("Pergament-{version}-linux-{arch}.AppImage"),
        InstallKind::Nix | InstallKind::Manual => return None,
    };
    let find = |n: &str| release.assets.iter().find(|a| a.name == n);
    Some((find(&name)?, find(&format!("{name}.sig"))?))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    pub version: String,
    pub notes: String,
    /// The release page, for installs the app cannot update itself.
    pub url: String,
    pub installable: bool,
}

pub fn available(
    release: &Release,
    running: &str,
    kind: &InstallKind,
    arch: &str,
) -> Option<Available> {
    if !is_newer(&release.tag_name, running) {
        return None;
    }
    Some(Available {
        version: release
            .tag_name
            .strip_prefix('v')
            .unwrap_or(&release.tag_name)
            .to_owned(),
        notes: release_notes(release.body.as_deref().unwrap_or_default()).to_owned(),
        url: release.html_url.clone(),
        installable: assets_for(release, kind, arch).is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    fn asset(name: &str) -> Asset {
        Asset {
            name: name.to_owned(),
            browser_download_url: format!(
                "https://github.com/v3rm1n0/pergament/releases/download/v1.7.0/{name}"
            ),
        }
    }

    fn release(names: &[&str]) -> Release {
        Release {
            tag_name: "v1.7.0".to_owned(),
            body: Some("install text\n<!-- changes -->\n## What's Changed".to_owned()),
            html_url: "https://github.com/v3rm1n0/pergament/releases/tag/v1.7.0".to_owned(),
            assets: names.iter().map(|n| asset(n)).collect(),
        }
    }

    const ALL: &[&str] = &[
        "pergament-1.7.0-linux-x86_64.zip",
        "pergament-1.7.0-linux-x86_64.zip.sig",
        "Pergament-1.7.0-linux-x86_64.AppImage",
        "Pergament-1.7.0-linux-x86_64.AppImage.sig",
    ];

    fn zip_kind() -> InstallKind {
        InstallKind::Zip {
            bin_dir: PathBuf::from("/home/u/.local/bin"),
        }
    }

    #[test]
    fn compares_versions_ignoring_build_metadata() {
        assert!(is_newer("v1.7.0", "1.6.0+0ad029f"));
        assert!(!is_newer("v1.6.0", "1.6.0+0ad029f"));
        assert!(!is_newer("v1.5.9", "1.6.0"));
        assert!(is_newer("v1.10.0", "1.9.3"));
        assert!(!is_newer("nightly", "1.6.0"));
        assert_eq!(parse_version("v1.2.3-rc1"), Some((1, 2, 3)));
    }

    #[test]
    fn notes_start_after_the_marker() {
        assert_eq!(
            release_notes("install text\n<!-- changes -->\n## What's Changed\n* x"),
            "## What's Changed\n* x"
        );
        assert_eq!(release_notes("  ## Old release  "), "## Old release");
    }

    #[test]
    fn detects_install_kind() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");
        fs::create_dir(&bin).unwrap();
        let exe = bin.join("pergament-app");
        fs::write(&exe, "app").unwrap();
        // Without the command line tool next to it, it is not the zip install.
        assert!(matches!(
            install_kind(false, None, &exe),
            InstallKind::Manual
        ));
        fs::write(bin.join("pergament"), "cli").unwrap();
        assert!(
            matches!(install_kind(false, None, &exe), InstallKind::Zip { bin_dir } if bin_dir == bin)
        );
        assert!(matches!(install_kind(true, None, &exe), InstallKind::Nix));
        let image = dir.path().join("Pergament.AppImage");
        assert!(
            matches!(install_kind(false, Some(&image), &exe), InstallKind::AppImage(p) if p == image)
        );
        let other = dir.path().join("app");
        assert!(matches!(
            install_kind(false, None, &other),
            InstallKind::Manual
        ));
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o555)).unwrap();
        let kind = install_kind(false, None, &exe);
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(kind, InstallKind::Manual));
    }

    #[test]
    fn picks_signed_assets_for_the_kind() {
        let r = release(ALL);
        let (file, sig) = assets_for(&r, &zip_kind(), "x86_64").unwrap();
        assert_eq!(file.name, "pergament-1.7.0-linux-x86_64.zip");
        assert_eq!(sig.name, "pergament-1.7.0-linux-x86_64.zip.sig");
        let image = InstallKind::AppImage(PathBuf::from("/x.AppImage"));
        let (file, sig) = assets_for(&r, &image, "x86_64").unwrap();
        assert_eq!(file.name, "Pergament-1.7.0-linux-x86_64.AppImage");
        assert_eq!(sig.name, "Pergament-1.7.0-linux-x86_64.AppImage.sig");
        assert!(assets_for(&r, &InstallKind::Manual, "x86_64").is_none());
        assert!(assets_for(&r, &InstallKind::Nix, "x86_64").is_none());
        assert!(assets_for(&r, &zip_kind(), "aarch64").is_none());
        let unsigned = release(&ALL[..1]);
        assert!(assets_for(&unsigned, &zip_kind(), "x86_64").is_none());
    }

    #[test]
    fn offers_only_newer_releases() {
        let r = release(ALL);
        let a = available(&r, "1.6.0+abc", &zip_kind(), "x86_64").unwrap();
        assert_eq!(a.version, "1.7.0");
        assert_eq!(a.notes, "## What's Changed");
        assert_eq!(a.url, r.html_url);
        assert!(a.installable);
        let unsigned = release(&ALL[..1]);
        assert!(
            !available(&unsigned, "1.6.0", &zip_kind(), "x86_64")
                .unwrap()
                .installable
        );
        assert!(available(&r, "1.7.0", &zip_kind(), "x86_64").is_none());
    }
}
