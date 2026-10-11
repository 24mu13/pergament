//! Personal study data — highlights, notes, tags and bookmarks — stored in a
//! database with the layout of a JW Library `userData.db`, and `.jwlibrary`
//! backups of it. Table semantics are in docs/FORMAT.md ("User data").

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::ZipArchive;
use zip::write::SimpleFileOptions;

use crate::{Error, Result};

/// File name of the database, inside the library root and inside backups.
pub const DB_NAME: &str = "userData.db";
/// Schema version of a database created here (kept in `PRAGMA user_version`).
pub const SCHEMA_VERSION: i64 = 16;
/// Device name written into backups.
pub const DEVICE_NAME: &str = "Pergament";

const MANIFEST: &str = "manifest.json";
const THUMBNAIL: &str = "default_thumbnail.png";
const THUMBNAIL_PNG: &[u8] = include_bytes!("../assets/backup_thumbnail.png");
const MAX_MANIFEST: u64 = 64 * 1024;
const MAX_DATABASE: u64 = 1 << 30;
/// Tables a backup must contain to be accepted.
const REQUIRED_TABLES: [&str; 8] = [
    "Location",
    "UserMark",
    "BlockRange",
    "Note",
    "Tag",
    "TagMap",
    "Bookmark",
    "LastModified",
];

/// `BlockRange.BlockType` / `Note.BlockType`: a paragraph (`data-pid`).
pub const BLOCK_PARAGRAPH: i64 = 1;
/// A Bible verse (verse number).
pub const BLOCK_VERSE: i64 = 2;
/// `Tag.Type` of user tags (0 is the built-in favorites list).
const TAG_USER: i64 = 1;

/// The page a mark or note belongs to: a document of a publication, or a
/// chapter of a Bible.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Loc {
    pub key_symbol: String,
    pub meps_language: i64,
    /// 0 for undated publications.
    pub issue_tag: i64,
    /// MEPS document id (publications).
    pub document_id: Option<i64>,
    /// Book and chapter (Bibles).
    pub book: Option<i64>,
    pub chapter: Option<i64>,
}

/// Highlighted tokens `start..=end` of one paragraph or verse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Range {
    pub block_type: i64,
    pub identifier: i64,
    pub start: i64,
    pub end: i64,
}

/// A highlight. `color` is `UserMark.ColorIndex` (1-6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub guid: String,
    pub color: i64,
    pub ranges: Vec<Range>,
}

/// Where a note sits, for lists of notes across publications.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLocation {
    #[serde(flatten)]
    pub loc: Loc,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub guid: String,
    pub title: String,
    pub content: String,
    /// 0 (whole page), [`BLOCK_PARAGRAPH`] or [`BLOCK_VERSE`].
    pub block_type: i64,
    pub block_identifier: Option<i64>,
    /// The highlight the note is attached to, and its color.
    pub mark_guid: Option<String>,
    pub color: Option<i64>,
    pub tags: Vec<String>,
    pub last_modified: String,
    pub location: Option<NoteLocation>,
}

/// A note to create (no `guid`) or update.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub guid: Option<String>,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub block_type: i64,
    pub block_identifier: Option<i64>,
    pub mark_guid: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub id: i64,
    pub name: String,
    pub notes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub slot: i64,
    pub title: String,
    pub snippet: Option<String>,
    pub block_type: i64,
    pub block_identifier: Option<i64>,
    pub location: NoteLocation,
}

/// Counts shown after a backup was restored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub marks: i64,
    pub notes: i64,
    pub tags: i64,
    pub bookmarks: i64,
    /// Device the backup was made on.
    pub device: Option<String>,
}

/// Counts shown after a backup was merged into the current data.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    /// Rows only the backup had, now added.
    pub added: i64,
    /// Rows on both sides where the backup's version replaced the current one.
    pub updated: i64,
    /// Rows on both sides where the current version stayed.
    pub unchanged: i64,
    /// Backup rows left out because neither side was newer.
    pub conflicts: Vec<Conflict>,
    /// Device the backup was made on.
    pub device: Option<String>,
}

/// A backup row that differs from the current one when neither is newer.
/// The current row is kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    /// Table of the row, e.g. `UserMark`.
    pub table: String,
    /// GUID of the row, or its key in tables without one.
    pub guid: String,
    /// Where the row belongs, for the user.
    pub summary: String,
}

/// The parts of a backup's `manifest.json` that matter here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    creation_date: String,
    version: i64,
    name: String,
    #[serde(rename = "type")]
    kind: i64,
    user_data_backup: BackupInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupInfo {
    last_modified_date: String,
    hash: String,
    database_name: String,
    device_name: String,
    schema_version: i64,
}

pub struct UserData {
    conn: Connection,
    path: PathBuf,
}

impl std::fmt::Debug for UserData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UserData")
            .field("path", &self.path)
            .finish()
    }
}

impl UserData {
    /// Open the database at `path`, creating an empty one if it is missing.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_owned();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        conn.execute_batch(
            "PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;",
        )?;
        let has_schema: bool = conn.query_row(
            "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'UserMark'",
            [],
            |r| r.get(0),
        )?;
        if !has_schema {
            conn.execute_batch(SCHEMA)?;
            conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(Self { conn, path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn summary(&self) -> Result<Summary> {
        let count = |sql: &str| -> Result<i64> { Ok(self.conn.query_row(sql, [], |r| r.get(0))?) };
        Ok(Summary {
            marks: count("SELECT count(*) FROM UserMark")?,
            notes: count("SELECT count(*) FROM Note")?,
            tags: count(&format!("SELECT count(*) FROM Tag WHERE Type = {TAG_USER}"))?,
            bookmarks: count("SELECT count(*) FROM Bookmark")?,
            device: None,
        })
    }

    /// Location rows of a page (there can be several for the same page).
    fn location_ids(&self, loc: &Loc) -> Result<Vec<i64>> {
        let mut stmt = self.conn.prepare(
            "SELECT LocationId FROM Location
             WHERE Type = 0 AND Track IS NULL AND KeySymbol = ?1 AND MepsLanguage = ?2
               AND IssueTagNumber = ?3 AND IFNULL(DocumentId, 0) = IFNULL(?4, 0)
               AND IFNULL(BookNumber, 0) = IFNULL(?5, 0)
               AND IFNULL(ChapterNumber, 0) = IFNULL(?6, 0)
             ORDER BY LocationId",
        )?;
        let rows = stmt.query_map(
            params![
                loc.key_symbol,
                loc.meps_language,
                loc.issue_tag,
                loc.document_id,
                loc.book,
                loc.chapter
            ],
            |r| r.get(0),
        )?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn location_id(tx: &Transaction<'_>, loc: &Loc, title: Option<&str>) -> Result<i64> {
        let found: Option<i64> = tx
            .query_row(
                "SELECT LocationId FROM Location
                 WHERE Type = 0 AND Track IS NULL AND KeySymbol = ?1 AND MepsLanguage = ?2
                   AND IssueTagNumber = ?3 AND IFNULL(DocumentId, 0) = IFNULL(?4, 0)
                   AND IFNULL(BookNumber, 0) = IFNULL(?5, 0)
                   AND IFNULL(ChapterNumber, 0) = IFNULL(?6, 0)
                 ORDER BY LocationId LIMIT 1",
                params![
                    loc.key_symbol,
                    loc.meps_language,
                    loc.issue_tag,
                    loc.document_id,
                    loc.book,
                    loc.chapter
                ],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = found {
            if title.is_some() {
                tx.execute(
                    "UPDATE Location SET Title = ?1 WHERE LocationId = ?2 AND Title IS NULL",
                    params![title, id],
                )?;
            }
            return Ok(id);
        }
        tx.execute(
            "INSERT INTO Location (BookNumber, ChapterNumber, DocumentId, IssueTagNumber,
                                   KeySymbol, MepsLanguage, Type, Title)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
            params![
                loc.book,
                loc.chapter,
                loc.document_id,
                loc.issue_tag,
                loc.key_symbol,
                loc.meps_language,
                title
            ],
        )?;
        Ok(tx.last_insert_rowid())
    }

    /// Location rows holding the answers of a page. JW Library leaves the
    /// language of these empty, so an empty language matches too.
    fn answer_location_ids(conn: &Connection, loc: &Loc) -> Result<Vec<i64>> {
        let mut stmt = conn.prepare(
            "SELECT LocationId FROM Location
             WHERE Type = 0 AND Track IS NULL AND KeySymbol = ?1
               AND (MepsLanguage IS NULL OR MepsLanguage = ?2)
               AND IssueTagNumber = ?3 AND IFNULL(DocumentId, 0) = IFNULL(?4, 0)
               AND IFNULL(BookNumber, 0) = IFNULL(?5, 0)
               AND IFNULL(ChapterNumber, 0) = IFNULL(?6, 0)
             ORDER BY LocationId",
        )?;
        let rows = stmt.query_map(
            params![
                loc.key_symbol,
                loc.meps_language,
                loc.issue_tag,
                loc.document_id,
                loc.book,
                loc.chapter
            ],
            |r| r.get(0),
        )?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Texts typed into the answer fields of a page, by field id (`TextTag`).
    pub fn answers(&self, loc: &Loc) -> Result<BTreeMap<String, String>> {
        let mut out = BTreeMap::new();
        for location in Self::answer_location_ids(&self.conn, loc)? {
            let mut stmt = self
                .conn
                .prepare("SELECT TextTag, Value FROM InputField WHERE LocationId = ?1")?;
            let rows = stmt.query_map([location], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (tag, value) = row?;
                out.entry(tag).or_insert(value);
            }
        }
        Ok(out)
    }

    /// Store the text of an answer field; an empty text removes it.
    pub fn save_answer(
        &mut self,
        loc: &Loc,
        title: Option<&str>,
        tag: &str,
        value: &str,
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        let locations = Self::answer_location_ids(&tx, loc)?;
        if value.is_empty() {
            for location in locations {
                tx.execute(
                    "DELETE FROM InputField WHERE LocationId = ?1 AND TextTag = ?2",
                    params![location, tag],
                )?;
            }
        } else {
            let location = match locations.first() {
                Some(id) => *id,
                None => Self::location_id(&tx, loc, title)?,
            };
            tx.execute(
                "INSERT INTO InputField (LocationId, TextTag, Value) VALUES (?1, ?2, ?3)
                 ON CONFLICT (LocationId, TextTag) DO UPDATE SET Value = excluded.Value",
                params![location, tag, value],
            )?;
        }
        touch(&tx)?;
        Ok(tx.commit()?)
    }

    /// Highlights on a page.
    pub fn marks(&self, loc: &Loc) -> Result<Vec<Mark>> {
        let mut out: Vec<Mark> = Vec::new();
        for location in self.location_ids(loc)? {
            let mut stmt = self.conn.prepare(
                "SELECT m.UserMarkGuid, m.ColorIndex, r.BlockType, r.Identifier,
                        IFNULL(r.StartToken, 0), IFNULL(r.EndToken, 0)
                 FROM UserMark m JOIN BlockRange r ON r.UserMarkId = m.UserMarkId
                 WHERE m.LocationId = ?1 ORDER BY m.UserMarkId, r.BlockRangeId",
            )?;
            let rows = stmt.query_map([location], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    Range {
                        block_type: r.get(2)?,
                        identifier: r.get(3)?,
                        start: r.get(4)?,
                        end: r.get(5)?,
                    },
                ))
            })?;
            for row in rows {
                let (guid, color, range) = row?;
                match out.last_mut() {
                    Some(m) if m.guid == guid => m.ranges.push(range),
                    _ => out.push(Mark {
                        guid,
                        color,
                        ranges: vec![range],
                    }),
                }
            }
        }
        Ok(out)
    }

    /// Highlight `ranges` on a page in `color`. Overlapped parts of existing
    /// highlights are cut away, so a token has at most one color.
    pub fn add_mark(
        &mut self,
        loc: &Loc,
        title: Option<&str>,
        color: i64,
        ranges: &[Range],
    ) -> Result<String> {
        let tx = self.conn.transaction()?;
        let location = Self::location_id(&tx, loc, title)?;
        for r in ranges {
            cut_ranges(&tx, location, r)?;
        }
        let guid = new_guid(&tx)?;
        tx.execute(
            "INSERT INTO UserMark (ColorIndex, LocationId, StyleIndex, UserMarkGuid, Version)
             VALUES (?1, ?2, 0, ?3, 1)",
            params![color, location, guid],
        )?;
        let mark = tx.last_insert_rowid();
        for r in ranges {
            tx.execute(
                "INSERT INTO BlockRange (BlockType, Identifier, StartToken, EndToken, UserMarkId)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![r.block_type, r.identifier, r.start, r.end, mark],
            )?;
        }
        touch(&tx)?;
        tx.commit()?;
        Ok(guid)
    }

    pub fn set_mark_color(&mut self, guid: &str, color: i64) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE UserMark SET ColorIndex = ?1 WHERE UserMarkGuid = ?2",
            params![color, guid],
        )?;
        touch(&tx)?;
        Ok(tx.commit()?)
    }

    /// Remove a highlight. Notes attached to it stay, without the highlight.
    pub fn delete_mark(&mut self, guid: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        let id: Option<i64> = tx
            .query_row(
                "SELECT UserMarkId FROM UserMark WHERE UserMarkGuid = ?1",
                [guid],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = id {
            delete_mark_row(&tx, id)?;
        }
        touch(&tx)?;
        Ok(tx.commit()?)
    }

    const NOTE_SELECT: &str = "SELECT n.NoteId, n.Guid, IFNULL(n.Title, ''), IFNULL(n.Content, ''),
            n.BlockType, n.BlockIdentifier, m.UserMarkGuid, m.ColorIndex, n.LastModified,
            l.KeySymbol, l.MepsLanguage, l.IssueTagNumber, l.DocumentId, l.BookNumber,
            l.ChapterNumber, l.Title
         FROM Note n
         LEFT JOIN UserMark m ON m.UserMarkId = n.UserMarkId
         LEFT JOIN Location l ON l.LocationId = n.LocationId";

    fn notes_where(&self, condition: &str, values: &[&dyn rusqlite::ToSql]) -> Result<Vec<Note>> {
        let mut stmt = self.conn.prepare(&format!(
            "{} {condition} ORDER BY n.LastModified DESC, n.NoteId DESC",
            Self::NOTE_SELECT
        ))?;
        let rows = stmt.query_map(values, |r| {
            let key_symbol: Option<String> = r.get(9)?;
            let meps_language: Option<i64> = r.get(10)?;
            let location = match (key_symbol, meps_language) {
                (Some(key_symbol), Some(meps_language)) => Some(NoteLocation {
                    loc: Loc {
                        key_symbol,
                        meps_language,
                        issue_tag: r.get(11)?,
                        document_id: r.get(12)?,
                        book: r.get(13)?,
                        chapter: r.get(14)?,
                    },
                    title: r.get(15)?,
                }),
                _ => None,
            };
            Ok((
                r.get::<_, i64>(0)?,
                Note {
                    guid: r.get(1)?,
                    title: r.get(2)?,
                    content: r.get(3)?,
                    block_type: r.get(4)?,
                    block_identifier: r.get(5)?,
                    mark_guid: r.get(6)?,
                    color: r.get(7)?,
                    tags: Vec::new(),
                    last_modified: r.get(8)?,
                    location,
                },
            ))
        })?;
        let mut notes = Vec::new();
        for row in rows {
            let (id, mut note) = row?;
            note.tags = self.note_tags(id)?;
            notes.push(note);
        }
        Ok(notes)
    }

    fn note_tags(&self, note: i64) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.Name FROM TagMap m JOIN Tag t ON t.TagId = m.TagId
             WHERE m.NoteId = ?1 ORDER BY t.Name",
        )?;
        let rows = stmt.query_map([note], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Notes on a page.
    pub fn notes(&self, loc: &Loc) -> Result<Vec<Note>> {
        let mut out = Vec::new();
        for location in self.location_ids(loc)? {
            out.extend(self.notes_where("WHERE n.LocationId = ?1", &[&location])?);
        }
        Ok(out)
    }

    /// All notes, newest first, optionally only those with tag `tag`.
    pub fn all_notes(&self, tag: Option<i64>) -> Result<Vec<Note>> {
        match tag {
            Some(tag) => self.notes_where(
                "WHERE n.NoteId IN (SELECT NoteId FROM TagMap WHERE TagId = ?1)",
                &[&tag],
            ),
            None => self.notes_where("", &[]),
        }
    }

    /// Create or update a note; returns its guid. `loc` is needed to create.
    pub fn save_note(
        &mut self,
        loc: Option<&Loc>,
        title: Option<&str>,
        note: &NoteInput,
    ) -> Result<String> {
        let tx = self.conn.transaction()?;
        let existing: Option<(i64, String)> = match &note.guid {
            Some(guid) => tx
                .query_row(
                    "SELECT NoteId, Guid FROM Note WHERE Guid = ?1",
                    [guid],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?,
            None => None,
        };
        let (id, guid) = match existing {
            Some((id, guid)) => {
                tx.execute(
                    "UPDATE Note SET Title = ?1, Content = ?2,
                            LastModified = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                     WHERE NoteId = ?3",
                    params![note.title, note.content, id],
                )?;
                (id, guid)
            }
            None => {
                let loc = loc.ok_or_else(|| Error::NotFound("page for the new note".into()))?;
                let location = Self::location_id(&tx, loc, title)?;
                let mark: Option<i64> = match &note.mark_guid {
                    Some(g) => tx
                        .query_row(
                            "SELECT UserMarkId FROM UserMark WHERE UserMarkGuid = ?1",
                            [g],
                            |r| r.get(0),
                        )
                        .optional()?,
                    None => None,
                };
                let (block_type, block) = match note.block_identifier {
                    Some(b)
                        if note.block_type == BLOCK_PARAGRAPH || note.block_type == BLOCK_VERSE =>
                    {
                        (note.block_type, Some(b))
                    }
                    _ => (0, None),
                };
                let guid = new_guid(&tx)?;
                tx.execute(
                    "INSERT INTO Note (Guid, UserMarkId, LocationId, Title, Content,
                                       BlockType, BlockIdentifier)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        guid,
                        mark,
                        location,
                        note.title,
                        note.content,
                        block_type,
                        block
                    ],
                )?;
                (tx.last_insert_rowid(), guid)
            }
        };
        set_note_tags(&tx, id, &note.tags)?;
        touch(&tx)?;
        tx.commit()?;
        Ok(guid)
    }

    pub fn delete_note(&mut self, guid: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM TagMap WHERE NoteId IN (SELECT NoteId FROM Note WHERE Guid = ?1)",
            [guid],
        )?;
        tx.execute("DELETE FROM Note WHERE Guid = ?1", [guid])?;
        touch(&tx)?;
        Ok(tx.commit()?)
    }

    /// User tags with the number of notes carrying them.
    pub fn tags(&self) -> Result<Vec<TagInfo>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.TagId, t.Name, count(m.NoteId) FROM Tag t
             LEFT JOIN TagMap m ON m.TagId = t.TagId
             WHERE t.Type = ?1 GROUP BY t.TagId ORDER BY t.Name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([TAG_USER], |r| {
            Ok(TagInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                notes: r.get(2)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn bookmarks(&self) -> Result<Vec<Bookmark>> {
        let mut stmt = self.conn.prepare(
            "SELECT b.Slot, b.Title, b.Snippet, b.BlockType, b.BlockIdentifier,
                    l.KeySymbol, IFNULL(l.MepsLanguage, 0), l.IssueTagNumber, l.DocumentId,
                    l.BookNumber, l.ChapterNumber, l.Title
             FROM Bookmark b JOIN Location l ON l.LocationId = b.LocationId
             WHERE l.KeySymbol IS NOT NULL ORDER BY b.Slot",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Bookmark {
                slot: r.get(0)?,
                title: r.get(1)?,
                snippet: r.get(2)?,
                block_type: r.get(3)?,
                block_identifier: r.get(4)?,
                location: NoteLocation {
                    loc: Loc {
                        key_symbol: r.get(5)?,
                        meps_language: r.get(6)?,
                        issue_tag: r.get(7)?,
                        document_id: r.get(8)?,
                        book: r.get(9)?,
                        chapter: r.get(10)?,
                    },
                    title: r.get(11)?,
                },
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Write a `.jwlibrary` backup of the current data to `dest`.
    pub fn export_backup(&self, dest: &Path) -> Result<()> {
        let dir = tempfile::tempdir()?;
        let copy = dir.path().join(DB_NAME);
        self.conn
            .execute("VACUUM INTO ?1", [copy.to_string_lossy().as_ref()])?;
        let hash = hex::encode(Sha256::digest(fs::read(&copy)?));
        let last_modified: String = self
            .conn
            .query_row("SELECT LastModified FROM LastModified", [], |r| r.get(0))
            .optional()?
            .unwrap_or_default();
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let now: String = self.conn.query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%S+0000', 'now')",
            [],
            |r| r.get(0),
        )?;
        let name = dest
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "backup.jwlibrary".into());
        let manifest = BackupManifest {
            creation_date: now,
            version: 1,
            name,
            kind: 0,
            user_data_backup: BackupInfo {
                last_modified_date: last_modified,
                hash,
                database_name: DB_NAME.into(),
                device_name: DEVICE_NAME.into(),
                schema_version: if version > 0 { version } else { SCHEMA_VERSION },
            },
        };

        let partial = dest.with_extension("jwlibrary.part");
        {
            let mut zip = zip::ZipWriter::new(File::create(&partial)?);
            let options = SimpleFileOptions::default();
            zip.start_file(MANIFEST, options)?;
            zip.write_all(&serde_json::to_vec(&manifest)?)?;
            zip.start_file(DB_NAME, options)?;
            io::copy(&mut File::open(&copy)?, &mut zip)?;
            zip.start_file(THUMBNAIL, options)?;
            zip.write_all(THUMBNAIL_PNG)?;
            zip.finish()?;
        }
        fs::rename(&partial, dest)?;
        Ok(())
    }

    /// Replace all data with the backup at `src`. The previous database is
    /// kept next to it as `userData.db.before-restore`.
    pub fn restore_backup(&mut self, src: &Path) -> Result<Summary> {
        let dir = self
            .path
            .parent()
            .map(Path::to_owned)
            .unwrap_or_else(|| PathBuf::from("."));
        let incoming = tempfile::Builder::new()
            .prefix(".restore-")
            .tempfile_in(&dir)?;
        let manifest = unpack_backup(src, incoming.path())?;
        check_database(incoming.path())?;
        {
            let conn = Connection::open(incoming.path())?;
            if conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? == 0 {
                conn.pragma_update(
                    None,
                    "user_version",
                    manifest.user_data_backup.schema_version,
                )?;
            }
        }

        let previous = self.path.with_extension("db.before-restore");
        // Swap files while no connection is open on the old one.
        let placeholder = Connection::open_in_memory()?;
        drop(std::mem::replace(&mut self.conn, placeholder));
        if self.path.exists() {
            fs::rename(&self.path, &previous)?;
        }
        let (_, temp_path) = incoming.keep().map_err(|e| Error::Io(e.error))?;
        fs::rename(&temp_path, &self.path)?;
        *self = Self::open(&self.path)?;
        let mut summary = self.summary()?;
        summary.device = Some(manifest.user_data_backup.device_name);
        Ok(summary)
    }

    /// Merge the backup at `src` into the current data: rows of both sides
    /// are kept, and a row on both sides resolves by recency (docs/FORMAT.md,
    /// "Merging"). The previous database is kept next to it as
    /// `userData.db.before-restore`. On error the data is left unchanged.
    pub fn merge_backup(&mut self, src: &Path) -> Result<MergeReport> {
        let dir = self
            .path
            .parent()
            .map(Path::to_owned)
            .unwrap_or_else(|| PathBuf::from("."));
        let incoming = tempfile::Builder::new()
            .prefix(".merge-")
            .tempfile_in(&dir)?;
        let manifest = unpack_backup(src, incoming.path())?;
        check_database(incoming.path())?;
        self.write_safety_copy()?;
        self.conn.execute(
            "ATTACH DATABASE ?1 AS inc",
            [incoming.path().to_string_lossy().as_ref()],
        )?;
        let result = self.merge_attached(manifest.user_data_backup.device_name);
        let detach = self.conn.execute("DETACH DATABASE inc", []);
        let report = result?;
        detach?;
        Ok(report)
    }

    /// Copy the database to `userData.db.before-restore`, replacing an older copy.
    fn write_safety_copy(&self) -> Result<()> {
        let copy = self.path.with_extension("db.before-restore");
        match fs::remove_file(&copy) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
        self.conn
            .execute("VACUUM INTO ?1", [copy.to_string_lossy().as_ref()])?;
        Ok(())
    }

    /// Merge the database attached as `inc` in one transaction.
    fn merge_attached(&mut self, device: String) -> Result<MergeReport> {
        let tx = self.conn.transaction()?;
        let incoming_newer = incoming_is_newer(&tx)?;
        let mut report = MergeReport {
            device: Some(device),
            ..Default::default()
        };
        let locations = merge_locations(&tx)?;
        let _marks = merge_marks(&tx, &locations, incoming_newer, &mut report)?;
        merge_input_fields(&tx, &locations, incoming_newer, &mut report)?;
        if report.added + report.updated > 0 {
            touch(&tx)?;
        }
        tx.commit()?;
        Ok(report)
    }
}

/// Whether the attached database `inc` was changed after the current one,
/// by the database-wide `LastModified`; `None` when equal or unknown.
fn incoming_is_newer(tx: &Transaction<'_>) -> Result<Option<bool>> {
    let diff: Option<f64> = tx.query_row(
        "SELECT julianday((SELECT LastModified FROM inc.LastModified))
              - julianday((SELECT LastModified FROM main.LastModified))",
        [],
        |r| r.get(0),
    )?;
    Ok(match diff {
        Some(d) if d > 0.0 => Some(true),
        Some(d) if d < 0.0 => Some(false),
        _ => None,
    })
}

fn has_table(tx: &Transaction<'_>, schema: &str, table: &str) -> Result<bool> {
    Ok(tx.query_row(
        &format!(
            "SELECT count(*) > 0 FROM {schema}.sqlite_master WHERE type = 'table' AND name = ?1"
        ),
        [table],
        |r| r.get(0),
    )?)
}

fn has_column(tx: &Transaction<'_>, schema: &str, table: &str, column: &str) -> Result<bool> {
    Ok(tx.query_row(
        "SELECT count(*) > 0 FROM pragma_table_info(?1, ?2) WHERE name = ?3",
        params![table, schema, column],
        |r| r.get(0),
    )?)
}

/// Map every incoming `Location` to the local one with the same key, adding
/// the missing ones. Returns incoming `LocationId` → local `LocationId`.
fn merge_locations(tx: &Transaction<'_>) -> Result<HashMap<i64, i64>> {
    let mut extra = Vec::new();
    for column in ["Title", "Specialty", "Edition"] {
        if has_column(tx, "inc", "Location", column)? && has_column(tx, "main", "Location", column)?
        {
            extra.push(column);
        }
    }
    let extra: String = extra.iter().map(|c| format!(", {c}")).collect();
    let ids: Vec<i64> = {
        let mut stmt = tx.prepare("SELECT LocationId FROM inc.Location ORDER BY LocationId")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let mut map = HashMap::with_capacity(ids.len());
    for id in ids {
        let same_key = |condition: &str| -> Result<Option<i64>> {
            Ok(tx
                .query_row(
                    &format!(
                        "SELECT m.LocationId FROM main.Location m, inc.Location i
                         WHERE i.LocationId = ?1 AND {condition}
                         ORDER BY m.LocationId LIMIT 1"
                    ),
                    [id],
                    |r| r.get(0),
                )
                .optional()?)
        };
        // NULL matches NULL; failing that, a row with the same UNIQUE key
        // (which only binds when none of its columns is NULL) is the same page.
        let found = match same_key(
            "m.BookNumber IS i.BookNumber AND m.ChapterNumber IS i.ChapterNumber
             AND m.DocumentId IS i.DocumentId AND m.Track IS i.Track
             AND m.IssueTagNumber IS i.IssueTagNumber AND m.KeySymbol IS i.KeySymbol
             AND m.MepsLanguage IS i.MepsLanguage AND m.Type IS i.Type",
        )? {
            Some(found) => Some(found),
            None => same_key(
                "m.BookNumber = i.BookNumber AND m.ChapterNumber = i.ChapterNumber
                 AND m.KeySymbol = i.KeySymbol AND m.MepsLanguage = i.MepsLanguage
                 AND m.Type = i.Type",
            )?,
        };
        let local = match found {
            Some(local) => {
                if extra.contains("Title") {
                    tx.execute(
                        "UPDATE main.Location
                         SET Title = (SELECT Title FROM inc.Location WHERE LocationId = ?2)
                         WHERE LocationId = ?1 AND Title IS NULL",
                        [local, id],
                    )?;
                }
                local
            }
            None => {
                tx.execute(
                    &format!(
                        "INSERT INTO main.Location (BookNumber, ChapterNumber, DocumentId, Track,
                             IssueTagNumber, KeySymbol, MepsLanguage, Type{extra})
                         SELECT BookNumber, ChapterNumber, DocumentId, Track,
                             IssueTagNumber, KeySymbol, MepsLanguage, Type{extra}
                         FROM inc.Location WHERE LocationId = ?1"
                    ),
                    [id],
                )?;
                tx.last_insert_rowid()
            }
        };
        map.insert(id, local);
    }
    Ok(map)
}

/// A `BlockRange` row: block type, identifier, start and end token.
type RangeRow = (i64, i64, Option<i64>, Option<i64>);

fn range_of(row: &RangeRow) -> Range {
    Range {
        block_type: row.0,
        identifier: row.1,
        start: row.2.unwrap_or(0),
        end: row.3.unwrap_or(0),
    }
}

/// The ranges of a mark in `schema` (`main` or `inc`), sorted.
fn mark_ranges(tx: &Transaction<'_>, schema: &str, mark: i64) -> Result<Vec<RangeRow>> {
    let mut stmt = tx.prepare(&format!(
        "SELECT BlockType, Identifier, StartToken, EndToken FROM {schema}.BlockRange
         WHERE UserMarkId = ?1"
    ))?;
    let rows = stmt.query_map([mark], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    let mut ranges: Vec<RangeRow> = rows.collect::<rusqlite::Result<_>>()?;
    ranges.sort_unstable();
    Ok(ranges)
}

/// Whether a local highlight on `location` covers a token of `ranges`.
fn overlaps_local(tx: &Transaction<'_>, location: i64, ranges: &[RangeRow]) -> Result<bool> {
    for row in ranges {
        let r = range_of(row);
        let hit: bool = tx.query_row(
            "SELECT count(*) > 0 FROM main.BlockRange b
             JOIN main.UserMark m ON m.UserMarkId = b.UserMarkId
             WHERE m.LocationId = ?1 AND b.BlockType = ?2 AND b.Identifier = ?3
               AND IFNULL(b.StartToken, 0) <= ?5 AND IFNULL(b.EndToken, 0) >= ?4",
            params![location, r.block_type, r.identifier, r.start, r.end],
            |r| r.get(0),
        )?;
        if hit {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Give `mark` the `ranges`, cutting them out of other highlights first.
fn put_ranges(tx: &Transaction<'_>, mark: i64, location: i64, ranges: &[RangeRow]) -> Result<()> {
    tx.execute("DELETE FROM main.BlockRange WHERE UserMarkId = ?1", [mark])?;
    for row in ranges {
        cut_ranges(tx, location, &range_of(row))?;
    }
    for (block_type, identifier, start, end) in ranges {
        tx.execute(
            "INSERT INTO main.BlockRange (BlockType, Identifier, StartToken, EndToken, UserMarkId)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![block_type, identifier, start, end, mark],
        )?;
    }
    Ok(())
}

/// How a location is shown in a conflict: its title, or its key.
fn location_label(tx: &Transaction<'_>, location: i64) -> Result<String> {
    Ok(tx.query_row(
        "SELECT COALESCE(Title, IFNULL(KeySymbol, '') || ' '
                || COALESCE(BookNumber || ':' || ChapterNumber, DocumentId, ''))
         FROM main.Location WHERE LocationId = ?1",
        [location],
        |r| r.get(0),
    )?)
}

fn conflict(table: &str, guid: &str, summary: String) -> Conflict {
    Conflict {
        table: table.into(),
        guid: guid.into(),
        summary,
    }
}

/// An incoming `UserMark` row.
struct IncomingMark {
    id: i64,
    guid: String,
    color: i64,
    location: i64,
    style: i64,
    version: i64,
}

/// Merge `inc.UserMark` with its ranges, matched by `UserMarkGuid`. Returns
/// guid → local `UserMarkId` of every incoming mark present after the merge,
/// for rows that refer to marks.
fn merge_marks(
    tx: &Transaction<'_>,
    locations: &HashMap<i64, i64>,
    incoming_newer: Option<bool>,
    report: &mut MergeReport,
) -> Result<HashMap<String, i64>> {
    let incoming: Vec<IncomingMark> = {
        let mut stmt = tx.prepare(
            "SELECT UserMarkId, UserMarkGuid, ColorIndex, LocationId, StyleIndex, Version
             FROM inc.UserMark ORDER BY UserMarkId",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(IncomingMark {
                id: r.get(0)?,
                guid: r.get(1)?,
                color: r.get(2)?,
                location: r.get(3)?,
                style: r.get(4)?,
                version: r.get(5)?,
            })
        })?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let mut map = HashMap::with_capacity(incoming.len());
    for mark in incoming {
        // A mark on a missing location is broken in the backup.
        let Some(&location) = locations.get(&mark.location) else {
            continue;
        };
        let ranges = mark_ranges(tx, "inc", mark.id)?;
        let local: Option<(i64, i64, i64)> = tx
            .query_row(
                "SELECT UserMarkId, ColorIndex, LocationId FROM main.UserMark
                 WHERE UserMarkGuid = ?1",
                [&mark.guid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        match local {
            None => {
                // A token has one color: an overlap goes to the newer side.
                if incoming_newer != Some(true) && overlaps_local(tx, location, &ranges)? {
                    let summary = location_label(tx, location)?;
                    report
                        .conflicts
                        .push(conflict("UserMark", &mark.guid, summary));
                    continue;
                }
                tx.execute(
                    "INSERT INTO main.UserMark (ColorIndex, LocationId, StyleIndex, UserMarkGuid,
                                                Version)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![mark.color, location, mark.style, mark.guid, mark.version],
                )?;
                let id = tx.last_insert_rowid();
                put_ranges(tx, id, location, &ranges)?;
                map.insert(mark.guid, id);
                report.added += 1;
            }
            Some((id, color, local_location)) => {
                map.insert(mark.guid.clone(), id);
                let same = color == mark.color
                    && local_location == location
                    && mark_ranges(tx, "main", id)? == ranges;
                match incoming_newer {
                    _ if same => report.unchanged += 1,
                    Some(true) => {
                        tx.execute(
                            "UPDATE main.UserMark SET ColorIndex = ?1, LocationId = ?2,
                                                      StyleIndex = ?3
                             WHERE UserMarkId = ?4",
                            params![mark.color, location, mark.style, id],
                        )?;
                        put_ranges(tx, id, location, &ranges)?;
                        report.updated += 1;
                    }
                    Some(false) => report.unchanged += 1,
                    None => {
                        let summary = location_label(tx, local_location)?;
                        report
                            .conflicts
                            .push(conflict("UserMark", &mark.guid, summary));
                    }
                }
            }
        }
    }
    // Cutting overlaps can remove a whole local mark that was mapped earlier.
    let mut gone = Vec::new();
    for (guid, id) in &map {
        let exists: bool = tx.query_row(
            "SELECT count(*) > 0 FROM main.UserMark WHERE UserMarkId = ?1",
            [id],
            |r| r.get(0),
        )?;
        if !exists {
            gone.push(guid.clone());
        }
    }
    for guid in gone {
        map.remove(&guid);
    }
    Ok(map)
}

/// Merge `inc.InputField`, matched by (location, `TextTag`).
fn merge_input_fields(
    tx: &Transaction<'_>,
    locations: &HashMap<i64, i64>,
    incoming_newer: Option<bool>,
    report: &mut MergeReport,
) -> Result<()> {
    // Not every backup has answer fields.
    if !has_table(tx, "inc", "InputField")? || !has_table(tx, "main", "InputField")? {
        return Ok(());
    }
    let incoming: Vec<(i64, String, String)> = {
        let mut stmt = tx.prepare(
            "SELECT LocationId, TextTag, Value FROM inc.InputField ORDER BY LocationId, TextTag",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (location, tag, value) in incoming {
        let Some(&location) = locations.get(&location) else {
            continue;
        };
        let local: Option<String> = tx
            .query_row(
                "SELECT Value FROM main.InputField WHERE LocationId = ?1 AND TextTag = ?2",
                params![location, tag],
                |r| r.get(0),
            )
            .optional()?;
        match (local, incoming_newer) {
            (None, _) => {
                tx.execute(
                    "INSERT INTO main.InputField (LocationId, TextTag, Value) VALUES (?1, ?2, ?3)",
                    params![location, tag, value],
                )?;
                report.added += 1;
            }
            (Some(local), _) if local == value => report.unchanged += 1,
            (Some(_), Some(true)) => {
                tx.execute(
                    "UPDATE main.InputField SET Value = ?3 WHERE LocationId = ?1 AND TextTag = ?2",
                    params![location, tag, value],
                )?;
                report.updated += 1;
            }
            (Some(_), Some(false)) => report.unchanged += 1,
            (Some(_), None) => {
                let summary = location_label(tx, location)?;
                report.conflicts.push(conflict("InputField", &tag, summary));
            }
        }
    }
    Ok(())
}

/// Copy the database out of a backup into `dest` and return the manifest.
fn unpack_backup(src: &Path, dest: &Path) -> Result<BackupManifest> {
    let mut zip = ZipArchive::new(File::open(src)?)?;
    let manifest: BackupManifest = {
        let entry = zip
            .by_name(MANIFEST)
            .map_err(|_| Error::MissingEntry(MANIFEST.into()))?;
        let mut buf = Vec::new();
        entry.take(MAX_MANIFEST + 1).read_to_end(&mut buf)?;
        if buf.len() as u64 > MAX_MANIFEST {
            return Err(Error::TooLarge(MANIFEST.into()));
        }
        serde_json::from_slice(&buf)?
    };
    let name = &manifest.user_data_backup.database_name;
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return Err(Error::UnsafePath(name.clone()));
    }
    let entry = zip
        .by_name(name)
        .map_err(|_| Error::MissingEntry(name.clone()))?;
    let mut out = File::create(dest)?;
    let n = io::copy(&mut entry.take(MAX_DATABASE + 1), &mut out)?;
    if n > MAX_DATABASE {
        return Err(Error::TooLarge(format!("{name} > {MAX_DATABASE} bytes")));
    }
    out.sync_all()?;
    Ok(manifest)
}

/// Accept only an intact SQLite database with the user data tables.
fn check_database(path: &Path) -> Result<()> {
    let invalid = |reason: String| Error::InvalidDatabase {
        path: path.to_owned(),
        reason,
    };
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    conn.execute_batch("PRAGMA trusted_schema = OFF; PRAGMA cell_size_check = ON;")?;
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(invalid(format!("integrity check: {check}")));
    }
    for table in REQUIRED_TABLES {
        let found: bool = conn.query_row(
            "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |r| r.get(0),
        )?;
        if !found {
            return Err(invalid(format!("missing table {table}")));
        }
    }
    Ok(())
}

/// Random uppercase UUID (version 4), like the ones JW Library writes.
fn new_guid(conn: &Connection) -> Result<String> {
    let mut bytes: Vec<u8> = conn.query_row("SELECT randomblob(16)", [], |r| r.get(0))?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let h = hex::encode_upper(bytes);
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &h[..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..]
    ))
}

fn touch(tx: &Transaction<'_>) -> Result<()> {
    tx.execute(
        "UPDATE LastModified SET LastModified = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        [],
    )?;
    Ok(())
}

fn delete_mark_row(tx: &Transaction<'_>, id: i64) -> Result<()> {
    tx.execute(
        "UPDATE Note SET UserMarkId = NULL WHERE UserMarkId = ?1",
        [id],
    )?;
    tx.execute("DELETE FROM BlockRange WHERE UserMarkId = ?1", [id])?;
    tx.execute("DELETE FROM UserMark WHERE UserMarkId = ?1", [id])?;
    Ok(())
}

/// Remove the tokens of `new` from existing highlights on the same block.
fn cut_ranges(tx: &Transaction<'_>, location: i64, new: &Range) -> Result<()> {
    let existing: Vec<(i64, i64, i64, i64)> = {
        let mut stmt = tx.prepare(
            "SELECT r.BlockRangeId, r.UserMarkId, IFNULL(r.StartToken, 0), IFNULL(r.EndToken, 0)
             FROM BlockRange r JOIN UserMark m ON m.UserMarkId = r.UserMarkId
             WHERE m.LocationId = ?1 AND r.BlockType = ?2 AND r.Identifier = ?3
               AND IFNULL(r.StartToken, 0) <= ?5 AND IFNULL(r.EndToken, 0) >= ?4",
        )?;
        let rows = stmt.query_map(
            params![location, new.block_type, new.identifier, new.start, new.end],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (range, mark, start, end) in existing {
        let left = (start < new.start).then_some((start, new.start - 1));
        let right = (end > new.end).then_some((new.end + 1, end));
        match (left, right) {
            (None, None) => {
                tx.execute("DELETE FROM BlockRange WHERE BlockRangeId = ?1", [range])?;
            }
            (Some((s, e)), None) | (None, Some((s, e))) => {
                tx.execute(
                    "UPDATE BlockRange SET StartToken = ?1, EndToken = ?2 WHERE BlockRangeId = ?3",
                    params![s, e, range],
                )?;
            }
            (Some((ls, le)), Some((rs, re))) => {
                tx.execute(
                    "UPDATE BlockRange SET StartToken = ?1, EndToken = ?2 WHERE BlockRangeId = ?3",
                    params![ls, le, range],
                )?;
                tx.execute(
                    "INSERT INTO BlockRange (BlockType, Identifier, StartToken, EndToken, UserMarkId)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![new.block_type, new.identifier, rs, re, mark],
                )?;
            }
        }
        let left_over: i64 = tx.query_row(
            "SELECT count(*) FROM BlockRange WHERE UserMarkId = ?1",
            [mark],
            |r| r.get(0),
        )?;
        if left_over == 0 {
            delete_mark_row(tx, mark)?;
        }
    }
    Ok(())
}

fn set_note_tags(tx: &Transaction<'_>, note: i64, tags: &[String]) -> Result<()> {
    tx.execute("DELETE FROM TagMap WHERE NoteId = ?1", [note])?;
    for name in tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        tx.execute(
            "INSERT OR IGNORE INTO Tag (Type, Name) VALUES (?1, ?2)",
            params![TAG_USER, name],
        )?;
        let tag: i64 = tx.query_row(
            "SELECT TagId FROM Tag WHERE Type = ?1 AND Name = ?2",
            params![TAG_USER, name],
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO TagMap (NoteId, TagId, Position)
             VALUES (?1, ?2, (SELECT IFNULL(max(Position), -1) + 1 FROM TagMap WHERE TagId = ?2))",
            params![note, tag],
        )?;
    }
    Ok(())
}

/// Tables of a new database, laid out like JW Library's schema version 16
/// (docs/FORMAT.md) so backups made here can be restored there.
const SCHEMA: &str = "
CREATE TABLE IndependentMedia(
    IndependentMediaId INTEGER NOT NULL PRIMARY KEY,
    OriginalFilename TEXT NOT NULL,
    FilePath TEXT NOT NULL UNIQUE,
    MimeType TEXT NOT NULL,
    Hash TEXT NOT NULL);
CREATE TABLE LastModified(LastModified TEXT NOT NULL);
INSERT INTO LastModified VALUES (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
CREATE TABLE Location(
    LocationId INTEGER NOT NULL PRIMARY KEY,
    BookNumber INTEGER,
    ChapterNumber INTEGER,
    DocumentId INTEGER,
    Track INTEGER,
    IssueTagNumber INTEGER NOT NULL DEFAULT 0,
    KeySymbol TEXT,
    MepsLanguage INTEGER,
    Type INTEGER NOT NULL,
    Title TEXT,
    Specialty TEXT,
    Edition TEXT,
    UNIQUE(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type));
CREATE TABLE UserMark(
    UserMarkId INTEGER NOT NULL PRIMARY KEY,
    ColorIndex INTEGER NOT NULL,
    LocationId INTEGER NOT NULL REFERENCES Location(LocationId),
    StyleIndex INTEGER NOT NULL,
    UserMarkGuid TEXT NOT NULL UNIQUE,
    Version INTEGER NOT NULL);
CREATE TABLE BlockRange(
    BlockRangeId INTEGER NOT NULL PRIMARY KEY,
    BlockType INTEGER NOT NULL CHECK (BlockType BETWEEN 1 AND 2),
    Identifier INTEGER NOT NULL,
    StartToken INTEGER,
    EndToken INTEGER,
    UserMarkId INTEGER NOT NULL REFERENCES UserMark(UserMarkId));
CREATE TABLE Bookmark(
    BookmarkId INTEGER NOT NULL PRIMARY KEY,
    LocationId INTEGER NOT NULL REFERENCES Location(LocationId),
    PublicationLocationId INTEGER NOT NULL REFERENCES Location(LocationId),
    Slot INTEGER NOT NULL,
    Title TEXT NOT NULL,
    Snippet TEXT,
    BlockType INTEGER NOT NULL DEFAULT 0,
    BlockIdentifier INTEGER,
    UNIQUE(PublicationLocationId, Slot));
CREATE TABLE InputField(
    LocationId INTEGER NOT NULL REFERENCES Location(LocationId),
    TextTag TEXT NOT NULL,
    Value TEXT NOT NULL,
    PRIMARY KEY(LocationId, TextTag));
CREATE TABLE Note(
    NoteId INTEGER NOT NULL PRIMARY KEY,
    Guid TEXT NOT NULL UNIQUE,
    UserMarkId INTEGER REFERENCES UserMark(UserMarkId),
    LocationId INTEGER REFERENCES Location(LocationId),
    Title TEXT,
    Content TEXT,
    LastModified TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    Created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    BlockType INTEGER NOT NULL DEFAULT 0,
    BlockIdentifier INTEGER);
CREATE TABLE PlaylistItemAccuracy(
    PlaylistItemAccuracyId INTEGER NOT NULL PRIMARY KEY,
    Description TEXT NOT NULL UNIQUE);
INSERT INTO PlaylistItemAccuracy VALUES (1, 'Accurate'), (2, 'NeedsUserVerification');
CREATE TABLE PlaylistItem(
    PlaylistItemId INTEGER NOT NULL PRIMARY KEY,
    Label TEXT NOT NULL,
    StartTrimOffsetTicks INTEGER,
    EndTrimOffsetTicks INTEGER,
    Accuracy INTEGER NOT NULL REFERENCES PlaylistItemAccuracy(PlaylistItemAccuracyId),
    EndAction INTEGER NOT NULL,
    ThumbnailFilePath TEXT REFERENCES IndependentMedia(FilePath));
CREATE TABLE PlaylistItemIndependentMediaMap(
    PlaylistItemId INTEGER NOT NULL REFERENCES PlaylistItem(PlaylistItemId),
    IndependentMediaId INTEGER NOT NULL REFERENCES IndependentMedia(IndependentMediaId),
    DurationTicks INTEGER NOT NULL,
    PRIMARY KEY(PlaylistItemId, IndependentMediaId)) WITHOUT ROWID;
CREATE TABLE PlaylistItemLocationMap(
    PlaylistItemId INTEGER NOT NULL REFERENCES PlaylistItem(PlaylistItemId),
    LocationId INTEGER NOT NULL REFERENCES Location(LocationId),
    MajorMultimediaType INTEGER NOT NULL,
    BaseDurationTicks INTEGER,
    PRIMARY KEY(PlaylistItemId, LocationId)) WITHOUT ROWID;
CREATE TABLE PlaylistItemMarker(
    PlaylistItemMarkerId INTEGER NOT NULL PRIMARY KEY,
    PlaylistItemId INTEGER NOT NULL REFERENCES PlaylistItem(PlaylistItemId),
    Label TEXT NOT NULL,
    StartTimeTicks INTEGER NOT NULL,
    DurationTicks INTEGER NOT NULL,
    EndTransitionDurationTicks INTEGER NOT NULL,
    UNIQUE(PlaylistItemId, StartTimeTicks));
CREATE TABLE PlaylistItemMarkerBibleVerseMap(
    PlaylistItemMarkerId INTEGER NOT NULL REFERENCES PlaylistItemMarker(PlaylistItemMarkerId),
    VerseId INTEGER NOT NULL,
    PRIMARY KEY(PlaylistItemMarkerId, VerseId)) WITHOUT ROWID;
CREATE TABLE PlaylistItemMarkerParagraphMap(
    PlaylistItemMarkerId INTEGER NOT NULL REFERENCES PlaylistItemMarker(PlaylistItemMarkerId),
    MepsDocumentId INTEGER NOT NULL,
    ParagraphIndex INTEGER NOT NULL,
    MarkerIndexWithinParagraph INTEGER NOT NULL,
    PRIMARY KEY(PlaylistItemMarkerId, MepsDocumentId, ParagraphIndex, MarkerIndexWithinParagraph))
    WITHOUT ROWID;
CREATE TABLE Tag(
    TagId INTEGER NOT NULL PRIMARY KEY,
    Type INTEGER NOT NULL,
    Name TEXT NOT NULL,
    UNIQUE(Type, Name));
CREATE TABLE TagMap(
    TagMapId INTEGER NOT NULL PRIMARY KEY,
    PlaylistItemId INTEGER REFERENCES PlaylistItem(PlaylistItemId),
    LocationId INTEGER REFERENCES Location(LocationId),
    NoteId INTEGER REFERENCES Note(NoteId),
    TagId INTEGER NOT NULL REFERENCES Tag(TagId),
    Position INTEGER NOT NULL,
    UNIQUE(TagId, Position),
    UNIQUE(TagId, NoteId),
    UNIQUE(TagId, LocationId),
    UNIQUE(TagId, PlaylistItemId));
CREATE INDEX IX_BlockRange_UserMarkId ON BlockRange(UserMarkId);
CREATE INDEX IX_UserMark_LocationId ON UserMark(LocationId);
CREATE INDEX IX_Note_LocationId_BlockIdentifier ON Note(LocationId, BlockIdentifier);
CREATE INDEX IX_TagMap_NoteId_TagId_Position ON TagMap(NoteId, TagId, Position);
CREATE INDEX IX_Location_MepsLanguage_DocumentId ON Location(MepsLanguage, DocumentId);
";

#[cfg(test)]
mod tests {
    use super::*;

    fn bible(chapter: i64) -> Loc {
        Loc {
            key_symbol: "nwtsty".into(),
            meps_language: 2,
            issue_tag: 0,
            document_id: None,
            book: Some(19),
            chapter: Some(chapter),
        }
    }

    fn verse(v: i64, start: i64, end: i64) -> Range {
        Range {
            block_type: BLOCK_VERSE,
            identifier: v,
            start,
            end,
        }
    }

    #[test]
    fn marks_round_trip_and_split() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ud = UserData::open(tmp.path().join(DB_NAME)).unwrap();
        let a = ud
            .add_mark(&bible(23), Some("Psalm 23"), 3, &[verse(4, 0, 31)])
            .unwrap();
        assert_eq!(a.len(), 36);
        assert_eq!(&a[14..15], "4");
        // A new color in the middle splits the old highlight.
        let b = ud
            .add_mark(&bible(23), None, 1, &[verse(4, 10, 12)])
            .unwrap();
        let marks = ud.marks(&bible(23)).unwrap();
        assert_eq!(marks.len(), 2);
        assert_eq!(marks[0].ranges, vec![verse(4, 0, 9), verse(4, 13, 31)]);
        assert_eq!(marks[1].guid, b);
        assert!(ud.marks(&bible(24)).unwrap().is_empty());
        // Covering it completely removes the old one.
        ud.add_mark(&bible(23), None, 2, &[verse(4, 0, 40)])
            .unwrap();
        let marks = ud.marks(&bible(23)).unwrap();
        assert_eq!(marks.len(), 1);
        assert_eq!(marks[0].color, 2);
        ud.set_mark_color(&marks[0].guid, 5).unwrap();
        assert_eq!(ud.marks(&bible(23)).unwrap()[0].color, 5);
        ud.delete_mark(&marks[0].guid).unwrap();
        assert!(ud.marks(&bible(23)).unwrap().is_empty());
    }

    #[test]
    fn answers_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ud = UserData::open(tmp.path().join(DB_NAME)).unwrap();
        let loc = Loc {
            key_symbol: "w".into(),
            meps_language: 2,
            issue_tag: 20260800,
            document_id: Some(2026520),
            book: None,
            chapter: None,
        };
        assert!(ud.answers(&loc).unwrap().is_empty());
        ud.save_answer(&loc, Some("Title"), "tt91", "first")
            .unwrap();
        ud.save_answer(&loc, None, "tt91", "second").unwrap();
        ud.save_answer(&loc, None, "tt95", "other").unwrap();
        let answers = ud.answers(&loc).unwrap();
        assert_eq!(answers["tt91"], "second");
        assert_eq!(answers.len(), 2);
        ud.save_answer(&loc, None, "tt95", "").unwrap();
        assert_eq!(ud.answers(&loc).unwrap().len(), 1);
    }

    #[test]
    fn answers_of_a_location_without_language() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ud = UserData::open(tmp.path().join(DB_NAME)).unwrap();
        // JW Library stores answer fields on locations without a language.
        ud.conn
            .execute_batch(
                "INSERT INTO Location (LocationId, DocumentId, IssueTagNumber, KeySymbol, Type)
                 VALUES (387, 2026520, 20260800, 'w', 0);
                 INSERT INTO InputField VALUES (387, 'tt91', 'from backup');",
            )
            .unwrap();
        let loc = Loc {
            key_symbol: "w".into(),
            meps_language: 2,
            issue_tag: 20260800,
            document_id: Some(2026520),
            book: None,
            chapter: None,
        };
        assert_eq!(ud.answers(&loc).unwrap()["tt91"], "from backup");
        ud.save_answer(&loc, None, "tt91", "edited").unwrap();
        assert_eq!(ud.answers(&loc).unwrap()["tt91"], "edited");
        let rows: i64 = ud
            .conn
            .query_row("SELECT COUNT(*) FROM Location", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }
    #[test]
    fn notes_and_tags() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ud = UserData::open(tmp.path().join(DB_NAME)).unwrap();
        let mark = ud.add_mark(&bible(23), None, 3, &[verse(1, 0, 3)]).unwrap();
        let guid = ud
            .save_note(
                Some(&bible(23)),
                Some("Psalm 23"),
                &NoteInput {
                    title: "Shepherd".into(),
                    content: "Text".into(),
                    block_type: BLOCK_VERSE,
                    block_identifier: Some(1),
                    mark_guid: Some(mark.clone()),
                    tags: vec!["Comfort".into(), " ".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        let notes = ud.notes(&bible(23)).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].mark_guid.as_deref(), Some(mark.as_str()));
        assert_eq!(notes[0].color, Some(3));
        assert_eq!(notes[0].tags, ["Comfort"]);
        assert_eq!(
            notes[0].location.as_ref().unwrap().title.as_deref(),
            Some("Psalm 23")
        );

        ud.save_note(
            None,
            None,
            &NoteInput {
                guid: Some(guid.clone()),
                title: "Shepherd".into(),
                content: "Changed".into(),
                tags: vec!["Prayer".into()],
                ..Default::default()
            },
        )
        .unwrap();
        let tags = ud.tags().unwrap();
        assert_eq!(
            tags.iter()
                .map(|t| (t.name.as_str(), t.notes))
                .collect::<Vec<_>>(),
            [("Comfort", 0), ("Prayer", 1)]
        );
        let prayer = tags[1].id;
        assert_eq!(ud.all_notes(Some(prayer)).unwrap()[0].content, "Changed");
        assert_eq!(ud.all_notes(Some(tags[0].id)).unwrap().len(), 0);

        // Deleting the highlight keeps the note.
        ud.delete_mark(&mark).unwrap();
        assert_eq!(ud.notes(&bible(23)).unwrap()[0].mark_guid, None);
        ud.delete_note(&guid).unwrap();
        assert!(ud.all_notes(None).unwrap().is_empty());
    }

    #[test]
    fn backup_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ud = UserData::open(tmp.path().join("a").join(DB_NAME)).unwrap();
        ud.add_mark(&bible(23), None, 6, &[verse(1, 0, 3)]).unwrap();
        let backup = tmp.path().join("b.jwlibrary");
        ud.export_backup(&backup).unwrap();

        let mut zip = ZipArchive::new(File::open(&backup).unwrap()).unwrap();
        let manifest: BackupManifest =
            serde_json::from_reader(zip.by_name(MANIFEST).unwrap()).unwrap();
        assert_eq!(manifest.user_data_backup.database_name, DB_NAME);
        assert_eq!(manifest.user_data_backup.schema_version, SCHEMA_VERSION);
        let mut db = Vec::new();
        zip.by_name(DB_NAME).unwrap().read_to_end(&mut db).unwrap();
        assert_eq!(
            manifest.user_data_backup.hash,
            hex::encode(Sha256::digest(&db))
        );
        assert!(zip.by_name(THUMBNAIL).is_ok());

        let mut other = UserData::open(tmp.path().join("c").join(DB_NAME)).unwrap();
        other
            .add_mark(&bible(1), None, 1, &[verse(1, 0, 0)])
            .unwrap();
        let summary = other.restore_backup(&backup).unwrap();
        assert_eq!(summary.marks, 1);
        assert_eq!(summary.device.as_deref(), Some(DEVICE_NAME));
        assert_eq!(other.marks(&bible(23)).unwrap()[0].color, 6);
        assert!(other.marks(&bible(1)).unwrap().is_empty());
        assert!(
            tmp.path()
                .join("c")
                .join("userData.db.before-restore")
                .is_file()
        );
    }

    #[test]
    fn rejects_bad_backups() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ud = UserData::open(tmp.path().join(DB_NAME)).unwrap();
        ud.add_mark(&bible(23), None, 6, &[verse(1, 0, 3)]).unwrap();
        let write = |name: &str, manifest: &str, db: &[u8]| {
            let path = tmp.path().join(name);
            let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
            zip.start_file(MANIFEST, SimpleFileOptions::default())
                .unwrap();
            zip.write_all(manifest.as_bytes()).unwrap();
            zip.start_file("userData.db", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(db).unwrap();
            zip.finish().unwrap();
            path
        };
        let manifest = |db: &str| {
            format!(
                r#"{{"creationDate":"x","version":1,"name":"x","type":0,"userDataBackup":
                   {{"lastModifiedDate":"x","hash":"x","databaseName":"{db}","deviceName":"x","schemaVersion":16}}}}"#
            )
        };
        for (name, m, db) in [
            ("garbage", manifest("userData.db"), b"not sqlite".as_slice()),
            ("traversal", manifest("../userData.db"), b"".as_slice()),
            ("missing", manifest("other.db"), b"".as_slice()),
            ("nomanifest", "{}".to_owned(), b"".as_slice()),
        ] {
            let path = write(name, &m, db);
            assert!(ud.restore_backup(&path).is_err(), "{name}");
        }
        // A failed restore leaves the data alone.
        assert_eq!(ud.summary().unwrap().marks, 1);
    }

    fn backup_of(ud: &UserData, dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        ud.export_backup(&p).unwrap();
        p
    }

    fn set_db_time(ud: &UserData, ts: &str) {
        ud.conn
            .execute("UPDATE LastModified SET LastModified = ?1", [ts])
            .unwrap();
    }

    fn db_time(ud: &UserData) -> String {
        ud.conn
            .query_row("SELECT LastModified FROM LastModified", [], |r| r.get(0))
            .unwrap()
    }

    fn count(ud: &UserData, table: &str) -> i64 {
        ud.conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    fn watchtower() -> Loc {
        Loc {
            key_symbol: "w".into(),
            meps_language: 2,
            issue_tag: 20260800,
            document_id: Some(2026520),
            book: None,
            chapter: None,
        }
    }

    #[test]
    fn merge_keeps_disjoint_marks_from_both_sides() {
        let tmp = tempfile::tempdir().unwrap();
        let mut local = UserData::open(tmp.path().join("l").join(DB_NAME)).unwrap();
        let mut remote = UserData::open(tmp.path().join("r").join(DB_NAME)).unwrap();
        local
            .add_mark(&bible(1), None, 1, &[verse(1, 0, 3)])
            .unwrap();
        remote
            .add_mark(&bible(2), None, 2, &[verse(5, 0, 3)])
            .unwrap();
        let b = backup_of(&remote, tmp.path(), "r.jwlibrary");
        let r = local.merge_backup(&b).unwrap();
        assert_eq!((r.added, r.updated, r.unchanged), (1, 0, 0));
        assert!(r.conflicts.is_empty());
        assert_eq!(r.device.as_deref(), Some(DEVICE_NAME));
        assert_eq!(local.marks(&bible(1)).unwrap().len(), 1);
        assert_eq!(local.marks(&bible(2)).unwrap()[0].color, 2);
        assert_eq!(local.marks(&bible(2)).unwrap()[0].ranges, [verse(5, 0, 3)]);
        assert!(local.path().with_extension("db.before-restore").is_file());
    }

    #[test]
    fn merge_replaces_an_older_safety_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let mut local = UserData::open(tmp.path().join("l").join(DB_NAME)).unwrap();
        let remote = UserData::open(tmp.path().join("r").join(DB_NAME)).unwrap();
        let safety = local.path().with_extension("db.before-restore");
        fs::write(&safety, b"old copy").unwrap();
        local
            .merge_backup(&backup_of(&remote, tmp.path(), "r.jwlibrary"))
            .unwrap();
        let copy = UserData::open(&safety).unwrap();
        assert_eq!(count(&copy, "UserMark"), 0);
    }

    #[test]
    fn merge_same_location_with_different_ids_makes_no_duplicate_location() {
        let tmp = tempfile::tempdir().unwrap();
        let mut local = UserData::open(tmp.path().join("l").join(DB_NAME)).unwrap();
        let mut remote = UserData::open(tmp.path().join("r").join(DB_NAME)).unwrap();
        local
            .add_mark(&bible(9), None, 1, &[verse(1, 0, 3)])
            .unwrap(); // LocationId 1
        remote
            .add_mark(&bible(1), None, 1, &[verse(1, 0, 3)])
            .unwrap(); // LocationId 1 = other place
        remote
            .add_mark(&bible(9), None, 3, &[verse(7, 0, 3)])
            .unwrap(); // chapter 9 is id 2 here
        let b = backup_of(&remote, tmp.path(), "r.jwlibrary");
        local.merge_backup(&b).unwrap();
        assert_eq!(count(&local, "Location"), 2);
        assert_eq!(local.marks(&bible(9)).unwrap().len(), 2);
        assert_eq!(local.marks(&bible(1)).unwrap().len(), 1);
    }

    #[test]
    fn merge_location_without_language_stays_apart() {
        let tmp = tempfile::tempdir().unwrap();
        let mut local = UserData::open(tmp.path().join("l").join(DB_NAME)).unwrap();
        let remote = UserData::open(tmp.path().join("r").join(DB_NAME)).unwrap();
        local
            .save_answer(&watchtower(), None, "tt1", "local")
            .unwrap();
        // JW Library writes answer locations without a language: NULL must
        // not match 2, and NULL must match NULL.
        remote
            .conn
            .execute_batch(
                "INSERT INTO Location (LocationId, DocumentId, IssueTagNumber, KeySymbol, Type)
                 VALUES (7, 2026520, 20260800, 'w', 0);
                 INSERT INTO InputField VALUES (7, 'tt2', 'remote');",
            )
            .unwrap();
        let b = backup_of(&remote, tmp.path(), "r.jwlibrary");
        let r = local.merge_backup(&b).unwrap();
        assert_eq!(r.added, 1);
        assert_eq!(count(&local, "Location"), 2);
        let again = local.merge_backup(&b).unwrap();
        assert_eq!((again.added, again.unchanged), (0, 1));
        assert_eq!(count(&local, "Location"), 2);
        let answers = local.answers(&watchtower()).unwrap();
        assert_eq!(answers["tt1"], "local");
        assert_eq!(answers["tt2"], "remote");
    }

    #[test]
    fn merge_same_guid_newer_database_wins_marks() {
        let tmp = tempfile::tempdir().unwrap();
        let mut local = UserData::open(tmp.path().join("l").join(DB_NAME)).unwrap();
        let guid = local
            .add_mark(&bible(1), None, 1, &[verse(1, 0, 3)])
            .unwrap();
        let remote_path = tmp.path().join("r").join(DB_NAME);
        let mut remote = UserData::open(&remote_path).unwrap();
        // The remote starts as a copy of local, then recolors the mark.
        remote
            .restore_backup(&backup_of(&local, tmp.path(), "seed.jwlibrary"))
            .unwrap();
        remote.set_mark_color(&guid, 5).unwrap();
        set_db_time(&remote, "2030-01-01T00:00:00Z");
        set_db_time(&local, "2020-01-01T00:00:00Z");
        let r = local
            .merge_backup(&backup_of(&remote, tmp.path(), "r.jwlibrary"))
            .unwrap();
        assert_eq!((r.added, r.updated), (0, 1));
        assert_eq!(local.marks(&bible(1)).unwrap()[0].color, 5);
        // Reverse the clocks: the local color stays.
        set_db_time(&local, "2040-01-01T00:00:00Z");
        local.set_mark_color(&guid, 2).unwrap();
        set_db_time(&local, "2040-01-01T00:00:00Z");
        let r = local
            .merge_backup(&backup_of(&remote, tmp.path(), "r2.jwlibrary"))
            .unwrap();
        assert_eq!(r.updated, 0);
        assert_eq!(r.unchanged, 1);
        assert_eq!(local.marks(&bible(1)).unwrap()[0].color, 2);
    }

    #[test]
    fn merge_same_guid_newer_database_replaces_ranges() {
        let tmp = tempfile::tempdir().unwrap();
        let mut local = UserData::open(tmp.path().join("l").join(DB_NAME)).unwrap();
        let guid = local
            .add_mark(&bible(1), None, 1, &[verse(1, 0, 3)])
            .unwrap();
        let mut remote = UserData::open(tmp.path().join("r").join(DB_NAME)).unwrap();
        remote
            .restore_backup(&backup_of(&local, tmp.path(), "seed.jwlibrary"))
            .unwrap();
        remote
            .conn
            .execute_batch(
                "UPDATE BlockRange SET EndToken = 8;
                 INSERT INTO BlockRange (BlockType, Identifier, StartToken, EndToken, UserMarkId)
                 VALUES (2, 2, 0, 4, 1);",
            )
            .unwrap();
        set_db_time(&remote, "2030-01-01T00:00:00+00:00");
        set_db_time(&local, "2029-12-31T23:59:59Z");
        let r = local
            .merge_backup(&backup_of(&remote, tmp.path(), "r.jwlibrary"))
            .unwrap();
        assert_eq!(r.updated, 1);
        let marks = local.marks(&bible(1)).unwrap();
        assert_eq!(marks.len(), 1);
        assert_eq!(marks[0].guid, guid);
        assert_eq!(marks[0].ranges, [verse(1, 0, 8), verse(2, 0, 4)]);
        assert_eq!(count(&local, "BlockRange"), 2);
    }

    #[test]
    fn merge_equal_clock_different_color_is_a_conflict_and_keeps_local() {
        let tmp = tempfile::tempdir().unwrap();
        let mut local = UserData::open(tmp.path().join("l").join(DB_NAME)).unwrap();
        let guid = local
            .add_mark(&bible(1), Some("Genesis 1"), 1, &[verse(1, 0, 3)])
            .unwrap();
        let mut remote = UserData::open(tmp.path().join("r").join(DB_NAME)).unwrap();
        remote
            .restore_backup(&backup_of(&local, tmp.path(), "seed.jwlibrary"))
            .unwrap();
        remote.set_mark_color(&guid, 5).unwrap();
        local.set_mark_color(&guid, 2).unwrap();
        // The same instant, written two ways.
        set_db_time(&remote, "2030-01-01T00:00:00Z");
        set_db_time(&local, "2030-01-01T00:00:00+00:00");
        let r = local
            .merge_backup(&backup_of(&remote, tmp.path(), "r.jwlibrary"))
            .unwrap();
        assert_eq!((r.added, r.updated, r.unchanged), (0, 0, 0));
        assert_eq!(r.conflicts.len(), 1);
        assert_eq!(r.conflicts[0].table, "UserMark");
        assert_eq!(r.conflicts[0].guid, guid);
        assert_eq!(r.conflicts[0].summary, "Genesis 1");
        assert_eq!(local.marks(&bible(1)).unwrap()[0].color, 2);
        // Nothing changed, so the local clock stays.
        assert_eq!(db_time(&local), "2030-01-01T00:00:00+00:00");
    }

    #[test]
    fn merge_overlapping_highlights_follow_the_newer_database() {
        for remote_newer in [true, false] {
            let tmp = tempfile::tempdir().unwrap();
            let mut local = UserData::open(tmp.path().join("l").join(DB_NAME)).unwrap();
            let mut remote = UserData::open(tmp.path().join("r").join(DB_NAME)).unwrap();
            let local_guid = local
                .add_mark(&bible(1), None, 1, &[verse(1, 0, 9)])
                .unwrap();
            let remote_guid = remote
                .add_mark(&bible(1), None, 2, &[verse(1, 5, 12)])
                .unwrap();
            let (old, new) = ("2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z");
            set_db_time(&local, if remote_newer { old } else { new });
            set_db_time(&remote, if remote_newer { new } else { old });
            let r = local
                .merge_backup(&backup_of(&remote, tmp.path(), "r.jwlibrary"))
                .unwrap();
            let marks = local.marks(&bible(1)).unwrap();
            if remote_newer {
                assert_eq!(r.added, 1);
                assert!(r.conflicts.is_empty());
                assert_eq!(marks.len(), 2);
                assert_eq!(
                    (marks[0].guid.as_str(), marks[0].color),
                    (local_guid.as_str(), 1)
                );
                assert_eq!(marks[0].ranges, [verse(1, 0, 4)]);
                assert_eq!(
                    (marks[1].guid.as_str(), marks[1].color),
                    (remote_guid.as_str(), 2)
                );
                assert_eq!(marks[1].ranges, [verse(1, 5, 12)]);
            } else {
                assert_eq!(r.added, 0);
                assert_eq!(r.conflicts.len(), 1);
                assert_eq!(r.conflicts[0].table, "UserMark");
                assert_eq!(r.conflicts[0].guid, remote_guid);
                assert_eq!(marks.len(), 1);
                assert_eq!(marks[0].guid, local_guid);
                assert_eq!(marks[0].ranges, [verse(1, 0, 9)]);
            }
        }
    }

    #[test]
    fn merge_input_fields_follow_the_newer_database() {
        let (old, new) = ("2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z");
        for (local_time, remote_time, expected) in [
            (old, new, "remote"),
            (new, old, "local"),
            (new, new, "local"),
        ] {
            let tmp = tempfile::tempdir().unwrap();
            let mut local = UserData::open(tmp.path().join("l").join(DB_NAME)).unwrap();
            let mut remote = UserData::open(tmp.path().join("r").join(DB_NAME)).unwrap();
            local
                .save_answer(&watchtower(), None, "tt1", "local")
                .unwrap();
            remote
                .save_answer(&watchtower(), None, "tt1", "remote")
                .unwrap();
            remote
                .save_answer(&watchtower(), None, "tt2", "new")
                .unwrap();
            set_db_time(&local, local_time);
            set_db_time(&remote, remote_time);
            let r = local
                .merge_backup(&backup_of(&remote, tmp.path(), "r.jwlibrary"))
                .unwrap();
            let answers = local.answers(&watchtower()).unwrap();
            assert_eq!(answers["tt1"], expected);
            assert_eq!(answers["tt2"], "new");
            assert_eq!(r.added, 1);
            assert_eq!(r.updated, i64::from(expected == "remote"));
            if local_time == remote_time {
                assert_eq!(r.conflicts.len(), 1);
                assert_eq!(r.conflicts[0].table, "InputField");
                assert_eq!(r.conflicts[0].guid, "tt1");
            } else {
                assert!(r.conflicts.is_empty());
            }
            assert_eq!(count(&local, "Location"), 1);
        }
    }

    #[test]
    fn merge_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let mut local = UserData::open(tmp.path().join("l").join(DB_NAME)).unwrap();
        let mut remote = UserData::open(tmp.path().join("r").join(DB_NAME)).unwrap();
        local
            .add_mark(&bible(1), None, 1, &[verse(1, 0, 3)])
            .unwrap();
        local
            .save_answer(&watchtower(), None, "tt1", "local")
            .unwrap();
        remote
            .add_mark(&bible(1), None, 3, &[verse(5, 0, 3)])
            .unwrap();
        remote
            .add_mark(&bible(2), None, 4, &[verse(1, 2, 6), verse(2, 0, 1)])
            .unwrap();
        remote
            .save_answer(&watchtower(), None, "tt2", "remote")
            .unwrap();
        let b = backup_of(&remote, tmp.path(), "r.jwlibrary");
        let counts = |ud: &UserData| {
            ["UserMark", "BlockRange", "Location", "InputField"].map(|t| count(ud, t))
        };
        let first = local.merge_backup(&b).unwrap();
        assert_eq!((first.added, first.updated, first.unchanged), (3, 0, 0));
        let after_first = counts(&local);
        assert_eq!(after_first, [3, 4, 3, 2]);
        set_db_time(&local, "2020-01-01T00:00:00Z");
        let second = local.merge_backup(&b).unwrap();
        assert_eq!((second.added, second.updated, second.unchanged), (0, 0, 3));
        assert!(second.conflicts.is_empty());
        assert_eq!(counts(&local), after_first);
        // A merge that changes nothing leaves the clock alone.
        assert_eq!(db_time(&local), "2020-01-01T00:00:00Z");
    }

    #[test]
    fn merge_rejects_a_bad_backup_and_changes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let mut local = UserData::open(tmp.path().join("l").join(DB_NAME)).unwrap();
        local
            .add_mark(&bible(1), None, 4, &[verse(1, 0, 3)])
            .unwrap();
        let counts = |ud: &UserData| ["UserMark", "BlockRange", "Location"].map(|t| count(ud, t));
        let before = counts(&local);
        let safety = local.path().with_extension("db.before-restore");
        let attached = |ud: &UserData| -> Vec<String> {
            let mut stmt = ud
                .conn
                .prepare("SELECT name FROM pragma_database_list")
                .unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };

        // Not a zip at all.
        let garbage = tmp.path().join("x.jwlibrary");
        fs::write(&garbage, b"not a backup").unwrap();
        assert!(local.merge_backup(&garbage).is_err());

        // A database without the Note table.
        let db = tmp.path().join("nonote.db");
        {
            let conn = Connection::open(&db).unwrap();
            conn.execute_batch(SCHEMA).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = OFF; DROP TABLE Note;")
                .unwrap();
        }
        let nonote = tmp.path().join("nonote.jwlibrary");
        {
            let mut zip = zip::ZipWriter::new(File::create(&nonote).unwrap());
            zip.start_file(MANIFEST, SimpleFileOptions::default())
                .unwrap();
            zip.write_all(
                br#"{"creationDate":"x","version":1,"name":"x","type":0,"userDataBackup":
                    {"lastModifiedDate":"x","hash":"x","databaseName":"userData.db",
                     "deviceName":"x","schemaVersion":16}}"#,
            )
            .unwrap();
            zip.start_file(DB_NAME, SimpleFileOptions::default())
                .unwrap();
            zip.write_all(&fs::read(&db).unwrap()).unwrap();
            zip.finish().unwrap();
        }
        assert!(local.merge_backup(&nonote).is_err());
        // Both were refused before anything was touched.
        assert!(!safety.exists());

        // A backup that fails halfway: the locations are merged before the
        // marks, whose table lacks a column.
        let mut remote = UserData::open(tmp.path().join("r").join(DB_NAME)).unwrap();
        remote
            .add_mark(&bible(2), None, 2, &[verse(1, 0, 3)])
            .unwrap();
        remote
            .conn
            .execute_batch("ALTER TABLE UserMark DROP COLUMN Version")
            .unwrap();
        let broken = backup_of(&remote, tmp.path(), "broken.jwlibrary");
        let err = local.merge_backup(&broken).unwrap_err();
        assert!(err.to_string().contains("Version"), "{err}");
        // It got past the checks, so the new Location was rolled back.
        assert!(safety.exists());

        assert_eq!(counts(&local), before);
        assert_eq!(local.marks(&bible(1)).unwrap()[0].color, 4);
        let mut fk = local.conn.prepare("PRAGMA foreign_key_check").unwrap();
        assert!(fk.query([]).unwrap().next().unwrap().is_none());
        drop(fk);
        assert_eq!(attached(&local), ["main"]);
        let leftovers = fs::read_dir(tmp.path().join("l"))
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".merge-")
            })
            .count();
        assert_eq!(leftovers, 0);
        // The data still works after the failed merges.
        local
            .add_mark(&bible(3), None, 1, &[verse(1, 0, 3)])
            .unwrap();
    }
}
