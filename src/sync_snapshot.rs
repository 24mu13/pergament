//! Snapshots of the user data for folder sync: every synced row under a key
//! that does not depend on database ids, with a hash of what the user sees
//! of it. Comparing the snapshots of a base, an incoming and the local
//! database tells which rows were added, changed or deleted on each side.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::Result;
use crate::userdata::{ANSWER_SIBLINGS, TAG_USER, UserData, check_database, unpack_backup};

/// A `Location` row by its content, normalized like the merge matches
/// locations: a missing issue, document, book or chapter counts as 0, the
/// other columns are compared as they are (NULL equals NULL).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct LocKey {
    pub kind: i64,
    pub key_symbol: Option<String>,
    pub meps_language: Option<i64>,
    pub issue_tag: i64,
    pub document_id: i64,
    pub book: i64,
    pub chapter: i64,
    pub track: Option<i64>,
}

/// What a `TagMap` row tags.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum TagTarget {
    /// A note, by its `Guid`.
    Note(String),
    /// A location (a favorite).
    Location(LocKey),
}

/// The id-independent key of a synced row.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum RowKey {
    /// `UserMark` with its ranges, by `UserMarkGuid`.
    Mark(String),
    /// `Note`, by `Guid`.
    Note(String),
    /// User `Tag`, by `Type` and `Name`.
    Tag(i64, String),
    /// `Bookmark`, by publication location and `Slot`.
    Bookmark(LocKey, i64),
    /// `InputField`, by page and `TextTag`.
    InputField(LocKey, String),
    /// `TagMap`, by the tag's `Type` and `Name` and what it tags.
    TagMap(i64, String, TagTarget),
}

/// Every synced row of a database: key → content hash.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "Vec<(RowKey, String)>", into = "Vec<(RowKey, String)>")]
pub struct Snapshot(pub BTreeMap<RowKey, String>);

impl From<Vec<(RowKey, String)>> for Snapshot {
    fn from(rows: Vec<(RowKey, String)>) -> Self {
        Self(rows.into_iter().collect())
    }
}

impl From<Snapshot> for Vec<(RowKey, String)> {
    fn from(snapshot: Snapshot) -> Self {
        snapshot.0.into_iter().collect()
    }
}

impl Snapshot {
    pub(crate) fn of(rows: &Rows) -> Self {
        Self(
            rows.iter()
                .map(|(key, (hash, _))| (key.clone(), hash.clone()))
                .collect(),
        )
    }
}

impl UserData {
    /// The snapshot of the current data.
    pub fn snapshot(&self) -> Result<Snapshot> {
        Ok(Snapshot::of(&rows_of(self.conn())?))
    }
}

/// The snapshot of the data in the backup at `path`.
pub fn snapshot_of_backup(path: &Path) -> Result<Snapshot> {
    let unpacked = tempfile::Builder::new().prefix(".snapshot-").tempfile()?;
    unpack_backup(path, unpacked.path())?;
    check_database(unpacked.path())?;
    Ok(Snapshot::of(&rows_of_file(unpacked.path())?))
}

/// The database row a key was read from, by its ids in that database.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum RowRef {
    Mark(i64),
    Note(i64),
    Tag(i64),
    Bookmark(i64),
    /// `LocationId` and `TextTag`.
    InputField(i64, String),
    TagMap(i64),
}

/// Every synced row of a database: key → content hash and the row it was
/// read from (the first one, should two rows share a key).
pub(crate) type Rows = BTreeMap<RowKey, (String, RowRef)>;

/// The rows of the database file at `path`, opened read-only.
pub(crate) fn rows_of_file(path: &Path) -> Result<Rows> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    conn.execute_batch("PRAGMA trusted_schema = OFF;")?;
    rows_of(&conn)
}

/// Hex SHA-256 of `content` as JSON.
fn hash(content: &impl Serialize) -> Result<String> {
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(content)?)))
}

fn has_table(conn: &Connection, table: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |r| r.get(0),
    )?)
}

/// Rows are read in id order and the first row of a key wins, should two
/// rows normalize to the same key.
pub(crate) fn rows_of(conn: &Connection) -> Result<Rows> {
    let mut rows = Rows::new();
    let mut put = |key: RowKey, content: String, row: RowRef| {
        rows.entry(key).or_insert((content, row));
    };

    let locations: HashMap<i64, LocKey> = {
        let mut stmt = conn.prepare(
            "SELECT LocationId, Type, KeySymbol, MepsLanguage, IFNULL(IssueTagNumber, 0),
                    IFNULL(DocumentId, 0), IFNULL(BookNumber, 0), IFNULL(ChapterNumber, 0), Track
             FROM Location",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get(0)?,
                LocKey {
                    kind: r.get(1)?,
                    key_symbol: r.get(2)?,
                    meps_language: r.get(3)?,
                    issue_tag: r.get(4)?,
                    document_id: r.get(5)?,
                    book: r.get(6)?,
                    chapter: r.get(7)?,
                    track: r.get(8)?,
                },
            ))
        })?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let loc = |id: Option<i64>| id.and_then(|id| locations.get(&id).cloned());

    // Marks: color, style, ranges (sorted) and location.
    type RangeRow = (i64, i64, Option<i64>, Option<i64>);
    let mut ranges: HashMap<i64, Vec<RangeRow>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT UserMarkId, BlockType, Identifier, StartToken, EndToken FROM BlockRange",
        )?;
        let mut q = stmt.query([])?;
        while let Some(r) = q.next()? {
            ranges
                .entry(r.get(0)?)
                .or_default()
                .push((r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?));
        }
    }
    {
        let mut stmt = conn.prepare(
            "SELECT UserMarkId, UserMarkGuid, ColorIndex, StyleIndex, LocationId
             FROM UserMark ORDER BY UserMarkId",
        )?;
        let mut q = stmt.query([])?;
        while let Some(r) = q.next()? {
            let id: i64 = r.get(0)?;
            let Some(location) = loc(r.get(4)?) else {
                continue;
            };
            let mut marked = ranges.remove(&id).unwrap_or_default();
            marked.sort_unstable();
            let color: i64 = r.get(2)?;
            let style: i64 = r.get(3)?;
            put(
                RowKey::Mark(r.get(1)?),
                hash(&(color, style, marked, location))?,
                RowRef::Mark(id),
            );
        }
    }

    // Notes: title, content, place in the text, highlight and location.
    {
        let mut stmt = conn.prepare(
            "SELECT n.Guid, n.Title, n.Content, n.BlockType, n.BlockIdentifier, u.UserMarkGuid,
                    n.LocationId, n.NoteId
             FROM Note n LEFT JOIN UserMark u ON u.UserMarkId = n.UserMarkId
             ORDER BY n.NoteId",
        )?;
        let mut q = stmt.query([])?;
        while let Some(r) = q.next()? {
            let title: Option<String> = r.get(1)?;
            let content: Option<String> = r.get(2)?;
            let block_type: i64 = r.get(3)?;
            let block: Option<i64> = r.get(4)?;
            let mark: Option<String> = r.get(5)?;
            let content = (title, content, block_type, block, mark, loc(r.get(6)?));
            put(
                RowKey::Note(r.get(0)?),
                hash(&content)?,
                RowRef::Note(r.get(7)?),
            );
        }
    }

    // User tags: nothing but the key.
    {
        let mut stmt =
            conn.prepare("SELECT Name, TagId FROM Tag WHERE Type = ?1 ORDER BY TagId")?;
        let mut q = stmt.query([TAG_USER])?;
        while let Some(r) = q.next()? {
            let name: String = r.get(0)?;
            put(
                RowKey::Tag(TAG_USER, name.clone()),
                hash(&(TAG_USER, name))?,
                RowRef::Tag(r.get(1)?),
            );
        }
    }

    // Tag maps of notes and locations (playlist items are not merged): the
    // rank among the tag's notes and locations by `Position`, so a gap in
    // the numbering changes nothing.
    {
        let mut stmt = conn.prepare(
            "SELECT m.TagId, t.Type, t.Name, n.Guid, m.LocationId, m.TagMapId
             FROM TagMap m JOIN Tag t ON t.TagId = m.TagId
             LEFT JOIN Note n ON n.NoteId = m.NoteId
             WHERE m.PlaylistItemId IS NULL AND (m.NoteId IS NOT NULL OR m.LocationId IS NOT NULL)
             ORDER BY m.TagId, m.Position, m.TagMapId",
        )?;
        let mut q = stmt.query([])?;
        let mut current: Option<i64> = None;
        let mut rank: i64 = 0;
        while let Some(r) = q.next()? {
            let tag: i64 = r.get(0)?;
            if current != Some(tag) {
                current = Some(tag);
                rank = 0;
            }
            let note: Option<String> = r.get(3)?;
            let target = match note {
                Some(guid) => Some(TagTarget::Note(guid)),
                None => loc(r.get(4)?).map(TagTarget::Location),
            };
            // A note map whose note is gone points nowhere.
            let Some(target) = target else {
                continue;
            };
            put(
                RowKey::TagMap(r.get(1)?, r.get(2)?, target),
                hash(&rank)?,
                RowRef::TagMap(r.get(5)?),
            );
            rank += 1;
        }
    }

    // Bookmarks: title, snippet and where they point.
    {
        let mut stmt = conn.prepare(
            "SELECT PublicationLocationId, Slot, Title, Snippet, LocationId, BlockType,
                    BlockIdentifier, BookmarkId
             FROM Bookmark ORDER BY BookmarkId",
        )?;
        let mut q = stmt.query([])?;
        while let Some(r) = q.next()? {
            let (Some(publication), Some(target)) = (loc(r.get(0)?), loc(r.get(4)?)) else {
                continue;
            };
            let title: String = r.get(2)?;
            let snippet: Option<String> = r.get(3)?;
            let block_type: i64 = r.get(5)?;
            let block: Option<i64> = r.get(6)?;
            put(
                RowKey::Bookmark(publication, r.get(1)?),
                hash(&(title, snippet, target, block_type, block))?,
                RowRef::Bookmark(r.get(7)?),
            );
        }
    }

    // Answers: the value of the field the editor shows. A field the page
    // also has on an earlier location is hidden, as in the merge. The key
    // is the page without its language: JW Library keeps answers on a
    // location without one, Pergament on one with it, and both are the same
    // page to the editor. Should a database hold a field of the page in two
    // languages, both collapse into one key and the first location wins.
    if has_table(conn, "InputField")? {
        let mut stmt = conn.prepare(&format!(
            "SELECT f.LocationId, f.TextTag, f.Value FROM InputField f
             WHERE NOT EXISTS (
                 SELECT 1 FROM InputField g
                 JOIN Location m ON m.LocationId = g.LocationId
                 JOIN Location l ON l.LocationId = f.LocationId
                 WHERE g.TextTag = f.TextTag AND g.LocationId < f.LocationId
                   AND {ANSWER_SIBLINGS})
             ORDER BY f.LocationId, f.TextTag"
        ))?;
        let mut q = stmt.query([])?;
        while let Some(r) = q.next()? {
            let location: i64 = r.get(0)?;
            let Some(mut page) = loc(Some(location)) else {
                continue;
            };
            page.meps_language = None;
            let tag: String = r.get(1)?;
            let value: String = r.get(2)?;
            put(
                RowKey::InputField(page, tag.clone()),
                hash(&value)?,
                RowRef::InputField(location, tag),
            );
        }
    }

    Ok(rows)
}

/// The result of [`UserData::sync_merge`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncMerge {
    /// What the merge did. Conflicts include rows edited on one side and
    /// deleted on the other.
    pub report: crate::userdata::MergeReport,
    /// Local rows deleted because the other device deleted them.
    pub deleted: i64,
    /// The snapshot of the merged file: the base for the next merge of
    /// that device's file.
    pub snapshot: Snapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncOutcome {
    Merged(SyncMerge),
    /// Nothing was written. `deletions` of the `total` local synced rows
    /// (all kinds summed) would have been deleted.
    NeedsConfirmation {
        deletions: i64,
        total: i64,
    },
}

/// What a sync merge does with rows the other device deleted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteGuard {
    /// Delete them, unless in some kind of row (highlights and notes,
    /// answers, bookmarks, tags with their tag maps) that would delete more
    /// than half of the local rows of that kind and more than 5; then stop
    /// with [`SyncOutcome::NeedsConfirmation`].
    Check,
    /// Delete them however many they are ("Apply deletions").
    Apply,
    /// Delete nothing ("Keep my data").
    Skip,
}

/// Which side's version of a row a sync merge keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Side {
    /// The incoming row: added when missing here, replacing the local one.
    Incoming,
    /// The local row: an incoming row missing here is not added (deleted
    /// here), one present here is left alone.
    Local,
    /// Changed, or new, differently on both sides. A note's own
    /// `LastModified` decides; a row without a clock of its own, or a note
    /// changed at the same time, goes to the
    /// side with the greater content hash (`incoming_wins_tie`). Both
    /// computers compare the same two hashes, so they keep the same version.
    Recency { incoming_wins_tie: bool },
}

/// What the sync merge does with an incoming row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Plan {
    pub side: Side,
    /// Report the row as a conflict, whichever side wins.
    pub report: bool,
}

/// Every key of the base, incoming and local snapshots, sorted by what the
/// sync merge does with it (docs/FORMAT.md, "Sync").
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Classified {
    /// Incoming rows with a decision. A key missing here is merged by the
    /// manual merge's rules.
    pub plans: BTreeMap<RowKey, Plan>,
    /// Local rows to delete: deleted there, unchanged here.
    pub delete: BTreeSet<RowKey>,
    /// Local rows deleted there but changed here, kept as conflicts.
    pub kept: BTreeSet<RowKey>,
}

/// The kinds of rows the mass-delete guard counts apart: highlights and
/// notes, answers, bookmarks, and tags with their tag maps.
const GUARD_KINDS: usize = 4;

fn guard_kind(key: &RowKey) -> usize {
    match key {
        RowKey::Mark(_) | RowKey::Note(_) => 0,
        RowKey::InputField(..) => 1,
        RowKey::Bookmark(..) => 2,
        RowKey::Tag(..) | RowKey::TagMap(..) => 3,
    }
}

fn count_kinds<'a>(keys: impl Iterator<Item = &'a RowKey>) -> [i64; GUARD_KINDS] {
    let mut counts = [0; GUARD_KINDS];
    for key in keys {
        counts[guard_kind(key)] += 1;
    }
    counts
}

impl Classified {
    /// Whether the deletions need the user's confirmation: in some kind of
    /// row they are more than half of the local rows and more than 5. When
    /// they do, returns the deletions and local rows summed over all kinds.
    pub fn needs_confirmation(&self, local: &Rows) -> Option<(i64, i64)> {
        let deletions = count_kinds(self.delete.iter());
        let total = count_kinds(local.keys());
        let mass = (0..GUARD_KINDS).any(|k| deletions[k] * 2 > total[k] && deletions[k] > 5);
        mass.then(|| (deletions.iter().sum(), total.iter().sum()))
    }
}

/// Whether two hashes of `key` are the same content. The hash of a tag map
/// is its rank in the tag, and the order of a tag's notes is not merged: a
/// tag map is the same as long as it is there.
fn same(key: &RowKey, a: &str, b: &str) -> bool {
    matches!(key, RowKey::TagMap(..)) || a == b
}

/// The rows a tag map belongs to: its user tag and its note.
fn parents(key: &RowKey) -> Vec<RowKey> {
    let RowKey::TagMap(kind, name, target) = key else {
        return Vec::new();
    };
    let mut parents = Vec::new();
    // Only user tags are synced rows of their own.
    if *kind == TAG_USER {
        parents.push(RowKey::Tag(*kind, name.clone()));
    }
    if let TagTarget::Note(guid) = target {
        parents.push(RowKey::Note(guid.clone()));
    }
    parents
}

/// Classify every key of `base` (B), `incoming` (I) and `local` (L) by the
/// table in docs/FORMAT.md, "Sync".
pub(crate) fn classify(base: &Snapshot, incoming: &Snapshot, local: &Snapshot) -> Classified {
    let (b_rows, i_rows, l_rows) = (&base.0, &incoming.0, &local.0);
    let mut c = Classified::default();
    let keys: BTreeSet<&RowKey> = b_rows
        .keys()
        .chain(i_rows.keys())
        .chain(l_rows.keys())
        .collect();
    let plan = |side, report| Some(Plan { side, report });
    for key in keys.iter().copied() {
        let same = |a: &String, b: &String| same(key, a, b);
        let decided = match (b_rows.get(key), i_rows.get(key), l_rows.get(key)) {
            // New there: add.
            (None, Some(_), None) => plan(Side::Incoming, false),
            // New on both sides: nothing to do when equal; otherwise
            // settled like a row changed differently on both sides.
            (None, Some(i), Some(l)) if same(i, l) => plan(Side::Local, false),
            (None, Some(i), Some(l)) => plan(
                Side::Recency {
                    incoming_wins_tie: i > l,
                },
                true,
            ),
            // Deleted there: delete, unless changed here (edit wins).
            (Some(b), None, Some(l)) => {
                if same(b, l) {
                    c.delete.insert(key.clone());
                } else {
                    c.kept.insert(key.clone());
                }
                None
            }
            // Deleted here: stays deleted, unless changed there (edit wins).
            (Some(b), Some(i), None) if same(b, i) => plan(Side::Local, false),
            (Some(_), Some(_), None) => plan(Side::Incoming, true),
            // Unchanged there, or changed the same way: keep the local row.
            (Some(b), Some(i), Some(l)) if same(b, i) || same(i, l) => plan(Side::Local, false),
            // Changed only there.
            (Some(b), Some(_), Some(l)) if same(b, l) => plan(Side::Incoming, false),
            // Changed differently on both sides.
            (Some(_), Some(i), Some(l)) => plan(
                Side::Recency {
                    incoming_wins_tie: i > l,
                },
                true,
            ),
            // New here, or deleted on both sides.
            (_, None, _) => None,
        };
        if let Some(decided) = decided {
            c.plans.insert(key.clone(), decided);
        }
    }

    // A note's tags and a tag's notes are rows of their own, but they
    // belong to the note or tag: adding one is an edit of the note or tag,
    // which wins over deleting it.
    let mut maps: HashMap<RowKey, Vec<&RowKey>> = HashMap::new();
    for key in keys.iter().copied() {
        for parent in parents(key) {
            maps.entry(parent).or_default().push(key);
        }
    }
    let maps_of = |parent: &RowKey| maps.get(parent).map(Vec::as_slice).unwrap_or_default();
    // Deleted there, but tagged here: keep, conflict.
    let tagged_here: Vec<RowKey> = c
        .delete
        .iter()
        .filter(|p| {
            maps_of(p)
                .iter()
                .any(|m| !b_rows.contains_key(*m) && l_rows.contains_key(*m))
        })
        .cloned()
        .collect();
    for parent in tagged_here {
        c.delete.remove(&parent);
        c.kept.insert(parent);
    }
    // Deleted here, but tagged there: add back, conflict.
    for (parent, decided) in c.plans.iter_mut() {
        let deleted_here = decided.side == Side::Local && !l_rows.contains_key(parent);
        if deleted_here
            && maps_of(parent)
                .iter()
                .any(|m| !b_rows.contains_key(*m) && i_rows.contains_key(*m))
        {
            *decided = Plan {
                side: Side::Incoming,
                report: true,
            };
        }
    }
    // A note or tag that is kept keeps its tag maps, though they are gone
    // there with it.
    let orphaned: Vec<RowKey> = c
        .delete
        .iter()
        .filter(|map| {
            parents(map)
                .iter()
                .any(|p| !i_rows.contains_key(p) && !c.delete.contains(p))
        })
        .cloned()
        .collect();
    for map in orphaned {
        c.delete.remove(&map);
    }
    // A note or tag that is added comes with its tag maps, though they were
    // deleted here with it.
    let added: Vec<RowKey> = c
        .plans
        .iter()
        .filter(|(k, p)| p.side == Side::Incoming && !l_rows.contains_key(*k))
        .map(|(k, _)| k.clone())
        .collect();
    for parent in &added {
        for map in maps_of(parent) {
            if let Some(decided) = c.plans.get_mut(*map)
                && !l_rows.contains_key(*map)
            {
                decided.side = Side::Incoming;
            }
        }
    }
    c
}

/// The decisions of a sync merge, looked up by the rows the merge reads.
pub(crate) struct Resolver {
    /// Incoming row → its key, for the row each key was read from.
    incoming: HashMap<RowRef, RowKey>,
    /// Local row → its key, likewise.
    local: HashMap<RowRef, RowKey>,
    /// Local rows by key.
    local_rows: Rows,
    pub classified: Classified,
}

impl Resolver {
    pub fn new(incoming: &Rows, local: Rows, classified: Classified) -> Self {
        let refs = |rows: &Rows| -> HashMap<RowRef, RowKey> {
            rows.iter()
                .map(|(key, (_, row))| (row.clone(), key.clone()))
                .collect()
        };
        Self {
            incoming: refs(incoming),
            local: refs(&local),
            local_rows: local,
            classified,
        }
    }

    /// The plan for incoming row `row`, matched by the merge to local row
    /// `local` (`None`: none here). Only rows the snapshots were read from
    /// have one: a second row with the same key (an invisible twin), or a
    /// local match that is not the row the local snapshot holds for the key,
    /// gets `None` and the manual merge's rules.
    pub fn plan(&self, row: &RowRef, local: Option<&RowRef>) -> Option<Plan> {
        let key = self.incoming.get(row)?;
        let same_local = match local {
            Some(local) => self.local.get(local) == Some(key),
            None => !self.local_rows.contains_key(key),
        };
        if !same_local {
            return None;
        }
        self.classified.plans.get(key).copied()
    }

    /// The local row a key was read from.
    pub fn local_row(&self, key: &RowKey) -> Option<&RowRef> {
        self.local_rows.get(key).map(|(_, row)| row)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::userdata::{BLOCK_VERSE, DB_NAME, Loc, NoteInput, Range};
    use rusqlite::params;

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

    fn verse(v: i64, start: i64, end: i64) -> Range {
        Range {
            block_type: BLOCK_VERSE,
            identifier: v,
            start,
            end,
        }
    }

    /// A `LocationId` for `nwtsty` (book 19), added when missing.
    fn location(ud: &UserData, chapter: Option<i64>, kind: i64) -> i64 {
        let conn = ud.conn();
        let book = chapter.map(|_| 19);
        let found = conn.query_row(
            "SELECT LocationId FROM Location WHERE BookNumber IS ?1 AND ChapterNumber IS ?2
               AND KeySymbol = 'nwtsty' AND MepsLanguage = 2 AND Type = ?3",
            params![book, chapter, kind],
            |r| r.get(0),
        );
        found.unwrap_or_else(|_| {
            conn.execute(
                "INSERT INTO Location (BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type)
                 VALUES (?1, ?2, 'nwtsty', 2, ?3)",
                params![book, chapter, kind],
            )
            .unwrap();
            conn.last_insert_rowid()
        })
    }

    /// Data with a row of every synced kind: marks, notes with tags,
    /// a bookmark, an answer and a favorite. Returns the guids of a mark, a
    /// note first in tag `study` and one last in it.
    fn fill(ud: &mut UserData) -> (String, String, String) {
        // A deleted mark and note leave the ids of this side sparse.
        let gone = ud.add_mark(&bible(2), None, 3, &[verse(1, 0, 1)]).unwrap();
        ud.delete_mark(&gone).unwrap();
        let mark = ud
            .add_mark(&bible(1), None, 1, &[verse(1, 0, 4), verse(2, 0, 2)])
            .unwrap();
        ud.add_mark(&watchtower(), None, 2, &[verse(3, 1, 2)])
            .unwrap();
        let psalm = ud
            .save_note(
                Some(&bible(1)),
                None,
                &NoteInput {
                    title: "Psalm".into(),
                    content: "Happy is the man".into(),
                    block_type: BLOCK_VERSE,
                    block_identifier: Some(1),
                    mark_guid: Some(mark.clone()),
                    tags: vec!["joy".into(), "study".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        let page_note = ud
            .save_note(
                Some(&watchtower()),
                None,
                &NoteInput {
                    title: "Page".into(),
                    content: "On the whole page".into(),
                    tags: vec!["study".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        ud.save_answer(&watchtower(), None, "tt12", "An answer")
            .unwrap();
        let publication = location(ud, None, 1);
        let page = location(ud, Some(1), 0);
        let conn = ud.conn();
        conn.execute(
            "INSERT INTO Bookmark (LocationId, PublicationLocationId, Slot, Title, Snippet, BlockType)
             VALUES (?1, ?2, 0, 'Psalm 1', 'Happy', 0)",
            params![page, publication],
        )
        .unwrap();
        conn.execute("INSERT INTO Tag (Type, Name) VALUES (0, 'Favorite')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO TagMap (LocationId, TagId, Position)
             VALUES (?1, (SELECT TagId FROM Tag WHERE Type = 0), 0)",
            [publication],
        )
        .unwrap();
        (mark, psalm, page_note)
    }

    fn changed(a: &Snapshot, b: &Snapshot) -> Vec<RowKey> {
        let mut keys: Vec<RowKey> =
            a.0.iter()
                .filter(|(k, v)| b.0.get(*k) != Some(*v))
                .map(|(k, _)| k.clone())
                .collect();
        keys.extend(b.0.keys().filter(|k| !a.0.contains_key(*k)).cloned());
        keys.sort();
        keys
    }

    #[test]
    fn snapshot_equal_across_id_remap() {
        let tmp = tempfile::tempdir().unwrap();
        let mut a = UserData::open(tmp.path().join("a").join(DB_NAME)).unwrap();
        let mut b = UserData::open(tmp.path().join("b").join(DB_NAME)).unwrap();
        fill(&mut a);
        // Locations only B has shift its ids.
        for chapter in 50..55 {
            location(&b, Some(chapter), 0);
        }
        let backup = tmp.path().join("a.jwlibrary");
        a.export_backup(&backup).unwrap();
        b.merge_backup(&backup).unwrap();
        let w_id = |ud: &UserData| -> i64 {
            ud.conn()
                .query_row(
                    "SELECT LocationId FROM Location WHERE KeySymbol = 'w'",
                    [],
                    |r| r.get(0),
                )
                .unwrap()
        };
        assert_ne!(w_id(&a), w_id(&b), "test setup: ids must differ");

        let snap = a.snapshot().unwrap();
        // One row of each kind is there.
        let kinds = |pred: fn(&RowKey) -> bool| snap.0.keys().filter(|k| pred(k)).count();
        assert_eq!(kinds(|k| matches!(k, RowKey::Mark(_))), 2);
        assert_eq!(kinds(|k| matches!(k, RowKey::Note(_))), 2);
        assert_eq!(kinds(|k| matches!(k, RowKey::Tag(..))), 2);
        assert_eq!(kinds(|k| matches!(k, RowKey::Bookmark(..))), 1);
        assert_eq!(kinds(|k| matches!(k, RowKey::InputField(..))), 1);
        assert_eq!(kinds(|k| matches!(k, RowKey::TagMap(..))), 4);
        assert_eq!(snap, b.snapshot().unwrap());
    }

    #[test]
    fn snapshot_detects_content_change() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ud = UserData::open(tmp.path().join(DB_NAME)).unwrap();
        let (mark, psalm, page) = fill(&mut ud);
        let before = ud.snapshot().unwrap();

        ud.set_mark_color(&mark, 5).unwrap();
        let recolored = ud.snapshot().unwrap();
        assert_eq!(changed(&before, &recolored), vec![RowKey::Mark(mark)]);

        let edit = |ud: &mut UserData, guid: &str, title: &str, content: &str, tags: &[&str]| {
            ud.save_note(
                None,
                None,
                &NoteInput {
                    guid: Some(guid.into()),
                    title: title.into(),
                    content: content.into(),
                    tags: tags.iter().map(|t| t.to_string()).collect(),
                    ..Default::default()
                },
            )
            .unwrap();
        };
        edit(&mut ud, &page, "Page", "Edited", &["study"]);
        let edited = ud.snapshot().unwrap();
        assert_eq!(
            changed(&recolored, &edited),
            vec![RowKey::Note(page.clone())]
        );

        // The note first in `study`, which another note shares: its tag
        // rows keep their place.
        let before = edited;
        edit(
            &mut ud,
            &psalm,
            "Psalm",
            "Happy is the woman",
            &["joy", "study"],
        );
        let edited = ud.snapshot().unwrap();
        assert_eq!(changed(&before, &edited), vec![RowKey::Note(psalm.clone())]);

        ud.save_answer(&watchtower(), None, "tt12", "Another answer")
            .unwrap();
        let answered = ud.snapshot().unwrap();
        let changed_keys = changed(&edited, &answered);
        assert_eq!(changed_keys.len(), 1);
        assert!(matches!(&changed_keys[0], RowKey::InputField(_, tag) if tag == "tt12"));
    }

    #[test]
    fn snapshot_ignores_the_last_modified_time() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ud = UserData::open(tmp.path().join(DB_NAME)).unwrap();
        fill(&mut ud);
        let before = ud.snapshot().unwrap();
        ud.conn()
            .execute_batch(
                "UPDATE Note SET LastModified = '2020-01-01T00:00:00Z';
                 UPDATE LastModified SET LastModified = '2020-01-01T00:00:00Z';",
            )
            .unwrap();
        assert_eq!(before, ud.snapshot().unwrap());
    }

    #[test]
    fn snapshot_keys_answers_by_page_without_language() {
        let tmp = tempfile::tempdir().unwrap();
        // A, like JW Library: the answer's location has no language.
        let a = UserData::open(tmp.path().join("a").join(DB_NAME)).unwrap();
        a.conn()
            .execute_batch(
                "INSERT INTO Location (DocumentId, IssueTagNumber, KeySymbol, MepsLanguage, Type)
                 VALUES (2026520, 20260800, 'w', NULL, 0);
                 INSERT INTO InputField (LocationId, TextTag, Value)
                 VALUES (last_insert_rowid(), 'tt12', 'An answer');",
            )
            .unwrap();
        // B, like Pergament: with a language, at a later LocationId.
        let mut b = UserData::open(tmp.path().join("b").join(DB_NAME)).unwrap();
        for chapter in 50..53 {
            location(&b, Some(chapter), 0);
        }
        b.save_answer(&watchtower(), None, "tt12", "An answer")
            .unwrap();

        let (a, b) = (a.snapshot().unwrap(), b.snapshot().unwrap());
        assert_eq!(a, b);
        let key = a.0.keys().next().unwrap();
        assert!(
            matches!(key, RowKey::InputField(page, tag) if page.meps_language.is_none() && tag == "tt12")
        );
    }

    #[test]
    fn snapshot_of_backup_matches_live() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ud = UserData::open(tmp.path().join(DB_NAME)).unwrap();
        fill(&mut ud);
        let backup = tmp.path().join("a.jwlibrary");
        ud.export_backup(&backup).unwrap();
        let snap = snapshot_of_backup(&backup).unwrap();
        assert!(!snap.0.is_empty());
        assert_eq!(snap, ud.snapshot().unwrap());
    }

    #[test]
    fn snapshot_of_a_bad_backup_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let bad = tmp.path().join("bad.jwlibrary");
        std::fs::write(&bad, b"not a zip").unwrap();
        assert!(snapshot_of_backup(&bad).is_err());
    }

    #[test]
    fn snapshot_round_trips_json() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ud = UserData::open(tmp.path().join(DB_NAME)).unwrap();
        fill(&mut ud);
        let snap = ud.snapshot().unwrap();
        let json = serde_json::to_string(&snap).unwrap();
        let back: Snapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snap, back);
    }

    fn snap(rows: &[(RowKey, &str)]) -> Snapshot {
        Snapshot(
            rows.iter()
                .map(|(k, v)| (k.clone(), v.to_string()))
                .collect(),
        )
    }

    fn mark(guid: &str) -> RowKey {
        RowKey::Mark(guid.into())
    }

    const INCOMING: Plan = Plan {
        side: Side::Incoming,
        report: false,
    };
    const LOCAL: Plan = Plan {
        side: Side::Local,
        report: false,
    };

    /// One key through every row of the table in the spec.
    #[test]
    fn classify_follows_the_table() {
        let k = mark("M");
        // (base, incoming, local) → plan, delete, kept
        type Case = (
            Option<&'static str>,
            Option<&'static str>,
            Option<&'static str>,
            Option<Plan>,
            bool,
            bool,
        );
        let cases: [Case; 12] = [
            (None, Some("i"), None, Some(INCOMING), false, false),
            (None, None, Some("l"), None, false, false),
            (Some("b"), None, Some("b"), None, true, false),
            (Some("b"), None, Some("l"), None, false, true),
            (Some("b"), Some("b"), None, Some(LOCAL), false, false),
            (
                Some("b"),
                Some("i"),
                None,
                Some(Plan {
                    side: Side::Incoming,
                    report: true,
                }),
                false,
                false,
            ),
            (Some("b"), Some("b"), Some("b"), Some(LOCAL), false, false),
            (Some("b"), Some("b"), Some("l"), Some(LOCAL), false, false),
            (
                Some("b"),
                Some("i"),
                Some("b"),
                Some(INCOMING),
                false,
                false,
            ),
            (
                Some("b"),
                Some("i"),
                Some("l"),
                Some(Plan {
                    // "i" < "l": the local version has the greater hash.
                    side: Side::Recency {
                        incoming_wins_tie: false,
                    },
                    report: true,
                }),
                false,
                false,
            ),
            // Both changed the same way; both new, the same or not.
            (Some("b"), Some("x"), Some("x"), Some(LOCAL), false, false),
            (None, Some("x"), Some("x"), Some(LOCAL), false, false),
        ];
        for (n, (b, i, l, plan, delete, kept)) in cases.into_iter().enumerate() {
            let one =
                |v: Option<&str>| snap(&v.map(|v| (k.clone(), v)).into_iter().collect::<Vec<_>>());
            let c = classify(&one(b), &one(i), &one(l));
            assert_eq!(c.plans.get(&k).copied(), plan, "case {n}");
            assert_eq!(c.delete.contains(&k), delete, "case {n}");
            assert_eq!(c.kept.contains(&k), kept, "case {n}");
        }
        // Both new and different: the greater hash, reported, the same way
        // from either side.
        for (i, l, incoming_wins_tie) in [("i", "l", false), ("l", "i", true)] {
            let c = classify(
                &snap(&[]),
                &snap(&[(k.clone(), i)]),
                &snap(&[(k.clone(), l)]),
            );
            assert_eq!(
                c.plans.get(&k).copied(),
                Some(Plan {
                    side: Side::Recency { incoming_wins_tie },
                    report: true,
                })
            );
            assert!(c.delete.is_empty() && c.kept.is_empty());
        }
    }

    /// Whatever the three sides hold, a row to delete is never in the
    /// incoming file, so the merge that follows cannot touch it.
    #[test]
    fn classify_never_deletes_an_incoming_row() {
        let tag = RowKey::Tag(TAG_USER, "t".into());
        let note = RowKey::Note("N".into());
        let map = RowKey::TagMap(TAG_USER, "t".into(), TagTarget::Note("N".into()));
        let keys = [mark("M"), tag, note, map];
        let states = [None, Some("1"), Some("2")];
        // Every combination of states of the four keys on the three sides.
        let combos = states.len().pow((keys.len() * 3) as u32);
        for mut n in 0..combos {
            let mut sides = [Vec::new(), Vec::new(), Vec::new()];
            for key in &keys {
                for side in &mut sides {
                    if let Some(v) = states[n % states.len()] {
                        side.push((key.clone(), v));
                    }
                    n /= states.len();
                }
            }
            let [b, i, l] = sides.map(|rows| snap(&rows));
            let c = classify(&b, &i, &l);
            for key in &c.delete {
                assert!(!i.0.contains_key(key), "{key:?} in {b:?} {i:?} {l:?}");
                assert!(l.0.contains_key(key));
                assert!(!c.plans.contains_key(key));
            }
            for key in &c.kept {
                assert!(!i.0.contains_key(key) && l.0.contains_key(key));
            }
            // A row deleted here is added back only with a conflict, or
            // with the note or tag it belongs to.
            for (key, plan) in &c.plans {
                if plan.side == Side::Incoming && b.0.contains_key(key) && !l.0.contains_key(key) {
                    let parent_back = match key {
                        RowKey::TagMap(t, name, target) => {
                            let tag = RowKey::Tag(*t, name.clone());
                            let note = match target {
                                TagTarget::Note(g) => Some(RowKey::Note(g.clone())),
                                TagTarget::Location(_) => None,
                            };
                            [Some(tag), note].into_iter().flatten().any(|p| {
                                !l.0.contains_key(&p)
                                    && c.plans.get(&p).is_some_and(|p| p.side == Side::Incoming)
                            })
                        }
                        _ => false,
                    };
                    assert!(plan.report || parent_back, "{key:?} in {b:?} {i:?} {l:?}");
                }
            }
        }
    }

    #[test]
    fn classify_ignores_the_rank_of_tag_maps() {
        let map = |name: &str| RowKey::TagMap(TAG_USER, "t".into(), TagTarget::Note(name.into()));
        let tag = RowKey::Tag(TAG_USER, "t".into());
        let notes = [
            (tag.clone(), "t"),
            (RowKey::Note("1".into()), "n1"),
            (RowKey::Note("2".into()), "n2"),
        ];
        let with = |maps: &[(RowKey, &'static str)]| {
            let mut rows = notes.to_vec();
            rows.extend_from_slice(maps);
            snap(&rows)
        };
        let b = with(&[(map("1"), "0"), (map("2"), "1")]);
        // There: note 1 left the tag, so note 2 moved up. Here: reordered.
        let i = with(&[(map("2"), "0")]);
        let l = with(&[(map("1"), "1"), (map("2"), "0")]);
        let c = classify(&b, &i, &l);
        assert_eq!(c.delete, BTreeSet::from([map("1")]));
        assert_eq!(c.plans.get(&map("2")), Some(&LOCAL));
        assert!(c.kept.is_empty());
    }

    #[test]
    fn classify_keeps_a_note_or_tag_with_rows_added_here() {
        let tag = RowKey::Tag(TAG_USER, "t".into());
        let note = RowKey::Note("N".into());
        let map = |t: &str, n: &str| RowKey::TagMap(TAG_USER, t.into(), TagTarget::Note(n.into()));
        // Tag `t` and note N deleted there; here N got tag `u` and note O
        // got tag `t`.
        let b = snap(&[
            (tag.clone(), "t"),
            (note.clone(), "n"),
            (map("t", "N"), "0"),
        ]);
        let i = snap(&[]);
        let l = snap(&[
            (tag.clone(), "t"),
            (note.clone(), "n"),
            (map("t", "N"), "0"),
            (map("t", "O"), "1"),
            (map("u", "N"), "0"),
        ]);
        let c = classify(&b, &i, &l);
        assert_eq!(c.kept, BTreeSet::from([tag.clone(), note.clone()]));
        // The map of the kept note and tag stays with them.
        assert!(c.delete.is_empty(), "{:?}", c.delete);

        // The other way: deleted here, a map added there brings them back.
        let i = snap(&[
            (tag.clone(), "t"),
            (note.clone(), "n"),
            (map("t", "N"), "0"),
            (map("t", "O"), "1"),
            (map("u", "N"), "0"),
        ]);
        let c = classify(&b, &i, &snap(&[]));
        let back = Plan {
            side: Side::Incoming,
            report: true,
        };
        assert_eq!(c.plans[&tag], back);
        assert_eq!(c.plans[&note], back);
        assert_eq!(c.plans[&map("t", "N")], INCOMING);
        assert_eq!(c.plans[&map("t", "O")], INCOMING);

        // A tag that comes back does not bring back a note deleted here.
        let i = snap(&[
            (tag.clone(), "t"),
            (note.clone(), "n"),
            (map("t", "N"), "0"),
            (map("t", "O"), "1"),
        ]);
        let c = classify(&b, &i, &snap(&[]));
        assert_eq!(c.plans[&tag], back);
        assert_eq!(c.plans[&note], LOCAL);
    }
}
