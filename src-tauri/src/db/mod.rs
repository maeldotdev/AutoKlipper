pub mod models;
pub mod repo;

use rusqlite::Connection;
use std::path::Path;

use crate::error::AppResult;

/// Ordered, append-only. `PRAGMA user_version` records how many have run.
/// Never edit a shipped migration; add a new one.
const MIGRATIONS: &[&str] = &[
    // v1: library tables
    "
    CREATE TABLE projects (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        source_kind   TEXT NOT NULL,
        source_label  TEXT NOT NULL,
        platform      TEXT NOT NULL,
        duration      REAL NOT NULL DEFAULT 0,
        status        TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        hue           INTEGER NOT NULL DEFAULT 0,
        size_bytes    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE clips (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title         TEXT NOT NULL,
        start_sec     REAL NOT NULL,
        end_sec       REAL NOT NULL,
        aspect        TEXT NOT NULL,
        target        TEXT NOT NULL,
        captions      TEXT NOT NULL,
        export_status TEXT NOT NULL,
        score         INTEGER NOT NULL DEFAULT 0,
        hue           INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
    );
    CREATE INDEX idx_clips_project ON clips(project_id);
    CREATE TABLE jobs (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        kind          TEXT NOT NULL,
        status        TEXT NOT NULL,
        progress      REAL NOT NULL DEFAULT 0,
        source        TEXT NOT NULL,
        started_at    TEXT NOT NULL,
        duration_sec  INTEGER NOT NULL DEFAULT 0,
        error         TEXT,
        simulated     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_jobs_started ON jobs(started_at);
    ",
    // v2: real media. Where the source file lives and where an exported clip was written.
    "
    ALTER TABLE projects ADD COLUMN source_path TEXT;
    ALTER TABLE clips ADD COLUMN export_path TEXT;
    ",
    // v3: transcripts and why a clip was picked.
    "
    CREATE TABLE transcripts (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        language   TEXT NOT NULL,
        model      TEXT NOT NULL,
        segments   TEXT NOT NULL
    );
    ALTER TABLE clips ADD COLUMN reason TEXT;
    ",
    // v4: how each clip is framed: fixed crop position and zoom, or a face-following path.
    "
    ALTER TABLE clips ADD COLUMN crop_x REAL NOT NULL DEFAULT 50;
    ALTER TABLE clips ADD COLUMN zoom REAL NOT NULL DEFAULT 1;
    ALTER TABLE clips ADD COLUMN track TEXT;
    ",
    // v5: gaming layout, the camera box and its share of the picture.
    "
    ALTER TABLE clips ADD COLUMN split TEXT;
    ",
    // v6: hook title and the parts cut out of a clip.
    "
    ALTER TABLE clips ADD COLUMN hook TEXT;
    ALTER TABLE clips ADD COLUMN cuts TEXT;
    ",
];

pub fn schema_version(c: &Connection) -> AppResult<u32> {
    Ok(c.pragma_query_value(None, "user_version", |r| r.get(0))?)
}

pub fn migrate(c: &Connection) -> AppResult<()> {
    let current = schema_version(c)? as usize;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = c.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as u32)?;
        tx.commit()?;
        tracing::info!(version = i + 1, "database migrated");
    }
    Ok(())
}

fn configure(c: &Connection) -> AppResult<()> {
    c.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
    Ok(())
}

pub fn open(path: &Path) -> AppResult<Connection> {
    let c = Connection::open(path)?;
    configure(&c)?;
    migrate(&c)?;
    Ok(c)
}

#[cfg(test)]
pub fn open_memory() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    configure(&c).unwrap();
    migrate(&c).unwrap();
    c
}
