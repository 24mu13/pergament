//! Automatic backup settings and state, stored next to `userData.db`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use pergament::Result;
use pergament::autobackup::{self, ROLLING_DIR};
use pergament::userdata::UserData;
use serde::{Deserialize, Serialize};

const SETTINGS_FILE: &str = "auto.json";
const STATE_FILE: &str = "auto-state.json";
/// Smallest gap between two scheduled rolling backups.
const DAY_SECS: u64 = 24 * 60 * 60;
const KEEP_MIN: usize = 1;
const KEEP_MAX: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Rolling {
    pub enabled: bool,
    pub keep: usize,
}

impl Default for Rolling {
    fn default() -> Self {
        Self {
            enabled: true,
            keep: 10,
        }
    }
}

/// Placeholder for folder sync; not used yet.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncSettings {
    pub folder: Option<PathBuf>,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AutoSettings {
    pub rolling: Rolling,
    pub sync: SyncSettings,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AutoState {
    /// Fingerprint of the data in the newest rolling backup.
    pub rolling_fingerprint: Option<String>,
    /// UNIX seconds of the newest rolling backup.
    pub rolling_at: Option<u64>,
}

/// Clamp a requested number of kept backups to the allowed range.
pub fn clamp_keep(keep: usize) -> usize {
    keep.clamp(KEEP_MIN, KEEP_MAX)
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Read a JSON file; a missing file gives the default, a broken one is logged.
fn read_or_default<T: Default + for<'de> Deserialize<'de>>(path: &Path) -> T {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
            eprintln!("ignoring broken {}: {e}", path.display());
            T::default()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => T::default(),
        Err(e) => {
            eprintln!("cannot read {}: {e}", path.display());
            T::default()
        }
    }
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    let text = serde_json::to_string_pretty(value).map_err(std::io::Error::other)?;
    // Write a sibling file and rename it, so a crash never leaves a truncated file.
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

pub struct Auto {
    root: PathBuf,
    pub settings: Mutex<AutoSettings>,
    pub state: Mutex<AutoState>,
    close_backup_claimed: AtomicBool,
}

impl Auto {
    pub fn load(root: &Path) -> Auto {
        Auto {
            root: root.to_owned(),
            settings: Mutex::new(read_or_default(&root.join(SETTINGS_FILE))),
            state: Mutex::new(read_or_default(&root.join(STATE_FILE))),
            close_backup_claimed: AtomicBool::new(false),
        }
    }

    /// True for the first caller only: the close backup runs once per process.
    pub fn claim_close_backup(&self) -> bool {
        !self.close_backup_claimed.swap(true, Ordering::SeqCst)
    }

    pub fn settings(&self) -> AutoSettings {
        self.settings.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Change the rolling settings (keep is clamped), save them and return all settings.
    pub fn set_rolling(&self, enabled: bool, keep: usize) -> std::io::Result<AutoSettings> {
        let mut settings = self
            .settings
            .lock()
            .map_err(|_| std::io::Error::other("settings lock poisoned"))?;
        settings.rolling = Rolling {
            enabled,
            keep: clamp_keep(keep),
        };
        write_json(&self.root.join(SETTINGS_FILE), &*settings)?;
        Ok(settings.clone())
    }

    pub fn rolling_dir(&self) -> PathBuf {
        self.root.join(ROLLING_DIR)
    }

    /// Rolling is on and the last rolling backup is a day old or missing.
    /// Whether the data changed is left to `write_rolling`.
    pub fn rolling_due(&self, now: u64) -> bool {
        if !self.settings().rolling.enabled {
            return false;
        }
        let last = self.state.lock().ok().and_then(|s| s.rolling_at);
        last.is_none_or(|at| now.saturating_sub(at) >= DAY_SECS)
    }

    /// Write a rolling backup unless rolling is off or nothing changed since the last one.
    /// The state is only updated when a file was written.
    pub fn write_rolling_now(&self, user: &UserData) -> Result<Option<PathBuf>> {
        let rolling = self.settings().rolling;
        if !rolling.enabled {
            return Ok(None);
        }
        let last = self
            .state
            .lock()
            .ok()
            .and_then(|s| s.rolling_fingerprint.clone());
        let Some(written) =
            autobackup::write_rolling(user, &self.rolling_dir(), rolling.keep, last.as_deref())?
        else {
            return Ok(None);
        };
        let state = AutoState {
            rolling_fingerprint: Some(written.fingerprint),
            rolling_at: Some(unix_now()),
        };
        if let Err(e) = write_json(&self.root.join(STATE_FILE), &state) {
            eprintln!("cannot save backup state: {e}");
        }
        if let Ok(mut s) = self.state.lock() {
            *s = state;
        }
        Ok(Some(written.path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn defaults_when_missing() {
        let dir = tmp();
        let a = Auto::load(dir.path());
        let s = a.settings();
        assert!(s.rolling.enabled);
        assert_eq!(s.rolling.keep, 10);
    }

    #[test]
    fn defaults_when_broken() {
        let dir = tmp();
        fs::write(dir.path().join(SETTINGS_FILE), "{").unwrap();
        assert_eq!(Auto::load(dir.path()).settings(), AutoSettings::default());
    }

    #[test]
    fn partial_file_fills_defaults() {
        let dir = tmp();
        fs::write(dir.path().join(SETTINGS_FILE), r#"{"rolling":{"keep":3}}"#).unwrap();
        let s = Auto::load(dir.path()).settings();
        assert!(s.rolling.enabled);
        assert_eq!(s.rolling.keep, 3);
        assert_eq!(s.sync, SyncSettings::default());
    }

    #[test]
    fn round_trip() {
        let dir = tmp();
        let a = Auto::load(dir.path());
        let saved = a.set_rolling(false, 7).unwrap();
        assert_eq!(Auto::load(dir.path()).settings(), saved);
        assert!(!saved.rolling.enabled);
        assert_eq!(saved.rolling.keep, 7);
    }

    #[test]
    fn rolling_due_cases() {
        let dir = tmp();
        let a = Auto::load(dir.path());
        let now = 10 * DAY_SECS;
        assert!(a.rolling_due(now));
        a.state.lock().unwrap().rolling_at = Some(now - 23 * 3600);
        assert!(!a.rolling_due(now));
        a.state.lock().unwrap().rolling_at = Some(now - 25 * 3600);
        assert!(a.rolling_due(now));
        a.set_rolling(false, 10).unwrap();
        assert!(!a.rolling_due(now));
    }

    #[test]
    fn set_rolling_clamps() {
        assert_eq!(clamp_keep(0), 1);
        assert_eq!(clamp_keep(1000), 100);
        assert_eq!(clamp_keep(10), 10);
        let dir = tmp();
        let a = Auto::load(dir.path());
        assert_eq!(a.set_rolling(true, 0).unwrap().rolling.keep, 1);
        assert_eq!(a.set_rolling(true, 1000).unwrap().rolling.keep, 100);
    }

    #[test]
    fn close_backup_is_claimed_once() {
        let dir = tmp();
        let a = Auto::load(dir.path());
        assert!(a.claim_close_backup());
        assert!(!a.claim_close_backup());
        assert!(Auto::load(dir.path()).claim_close_backup());
    }

    #[test]
    fn write_json_leaves_no_temp_file() {
        let dir = tmp();
        Auto::load(dir.path()).set_rolling(true, 5).unwrap();
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, vec![SETTINGS_FILE.to_owned()]);
    }

    #[test]
    fn write_rolling_now_records_state_only_when_written() {
        use pergament::userdata::DB_NAME;
        let dir = tmp();
        let ud = UserData::open(dir.path().join(DB_NAME)).unwrap();
        let a = Auto::load(dir.path());

        let path = a.write_rolling_now(&ud).unwrap().expect("first write");
        assert!(path.exists());
        let first = a.state.lock().unwrap().clone();
        assert!(first.rolling_fingerprint.is_some());
        assert!(first.rolling_at.is_some());

        // Unchanged data: nothing written, state untouched.
        let before = a.state.lock().unwrap().clone();
        assert!(a.write_rolling_now(&ud).unwrap().is_none());
        assert_eq!(*a.state.lock().unwrap(), before);

        // The state survives a restart.
        assert_eq!(*Auto::load(dir.path()).state.lock().unwrap(), first);

        // Rolling off: nothing written, state untouched.
        a.set_rolling(false, 10).unwrap();
        assert!(a.write_rolling_now(&ud).unwrap().is_none());
        assert_eq!(*a.state.lock().unwrap(), first);
    }
}
