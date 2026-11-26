use rusqlite::{params, Connection, Row};

use super::models::{check_project_status, Clip, ClipPatch, Split, Job, Project};
use crate::ai::transcript::Segment;
use crate::error::{AppError, AppResult};

fn project_row(r: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: r.get(0)?,
        title: r.get(1)?,
        source_kind: r.get(2)?,
        source_label: r.get(3)?,
        platform: r.get(4)?,
        duration: r.get(5)?,
        status: r.get(6)?,
        created_at: r.get(7)?,
        hue: r.get(8)?,
        size_bytes: r.get(9)?,
        source_path: r.get(10)?,
        clip_count: r.get(11)?,
        uploader: r.get(12)?,
    })
}

pub fn list_projects(c: &Connection) -> AppResult<Vec<Project>> {
    let mut st = c.prepare(
        "SELECT p.id, p.title, p.source_kind, p.source_label, p.platform, p.duration, p.status,
                p.created_at, p.hue, p.size_bytes, p.source_path,
                (SELECT COUNT(*) FROM clips k WHERE k.project_id = p.id), p.uploader
         FROM projects p ORDER BY p.created_at DESC",
    )?;
    let rows = st.query_map([], project_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_project(c: &Connection, id: &str) -> AppResult<Project> {
    list_projects(c)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound(format!("project {id}")))
}

pub fn insert_project(c: &Connection, p: &Project) -> AppResult<()> {
    p.validate()?;
    c.execute(
        "INSERT INTO projects (id, title, source_kind, source_label, platform, duration, status, created_at, hue, size_bytes, source_path, uploader)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![p.id, p.title, p.source_kind, p.source_label, p.platform, p.duration, p.status, p.created_at, p.hue, p.size_bytes, p.source_path, p.uploader],
    )?;
    Ok(())
}

pub fn set_project_status(c: &Connection, id: &str, status: &str) -> AppResult<()> {
    check_project_status(status)?;
    let n = c.execute("UPDATE projects SET status = ?1 WHERE id = ?2", params![status, id])?;
    if n == 0 {
        return Err(AppError::NotFound(format!("project {id}")));
    }
    Ok(())
}

/// A finished download: remember where the file is and what it really contains.
pub fn set_project_source(c: &Connection, id: &str, path: &str, duration: f64, size_bytes: i64) -> AppResult<()> {
    let n = c.execute(
        "UPDATE projects SET source_path = ?2, duration = ?3, size_bytes = ?4, status = 'ready' WHERE id = ?1",
        params![id, path, duration, size_bytes],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("project {id}")));
    }
    Ok(())
}

pub fn set_project_uploader(c: &Connection, id: &str, name: &str) -> AppResult<()> {
    let name: String = name.trim().chars().take(200).collect();
    let n = c.execute("UPDATE projects SET uploader = ?2 WHERE id = ?1", params![id, (!name.is_empty()).then_some(name)])?;
    if n == 0 {
        return Err(AppError::NotFound(format!("project {id}")));
    }
    Ok(())
}

/// Deletes the project and, through the foreign key, all its clips.
pub fn delete_project(c: &Connection, id: &str) -> AppResult<()> {
    let n = c.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    if n == 0 {
        return Err(AppError::NotFound(format!("project {id}")));
    }
    Ok(())
}

fn clip_row(r: &Row) -> rusqlite::Result<Clip> {
    Ok(Clip {
        id: r.get(0)?,
        project_id: r.get(1)?,
        title: r.get(2)?,
        start_sec: r.get(3)?,
        end_sec: r.get(4)?,
        aspect: r.get(5)?,
        target: r.get(6)?,
        captions: r.get(7)?,
        export_status: r.get(8)?,
        score: r.get(9)?,
        hue: r.get(10)?,
        created_at: r.get(11)?,
        export_path: r.get(12)?,
        reason: r.get(13)?,
        crop_x: r.get(14)?,
        zoom: r.get(15)?,
        track: r.get::<_, Option<String>>(16)?.and_then(|t| serde_json::from_str(&t).ok()),
        split: r.get::<_, Option<String>>(17)?.and_then(|t| serde_json::from_str(&t).ok()),
        hook: r.get(18)?,
        cuts: r.get::<_, Option<String>>(19)?.and_then(|t| serde_json::from_str(&t).ok()),
        layout: r.get::<_, Option<String>>(20)?.and_then(|t| serde_json::from_str(&t).ok()),
        filters: r.get::<_, Option<String>>(21)?.and_then(|t| serde_json::from_str(&t).ok()),
        post: r.get(22)?,
    })
}

const CLIP_COLS: &str =
    "id, project_id, title, start_sec, end_sec, aspect, target, captions, export_status, score, hue, created_at, export_path, reason, crop_x, zoom, track, split, hook, cuts, layout, filters, post";

pub fn list_clips(c: &Connection) -> AppResult<Vec<Clip>> {
    let mut st = c.prepare(&format!("SELECT {CLIP_COLS} FROM clips ORDER BY created_at DESC, rowid DESC"))?;
    let rows = st.query_map([], clip_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn track_json(t: &Option<Vec<[f64; 2]>>) -> Option<String> {
    t.as_ref().and_then(|v| serde_json::to_string(v).ok())
}

fn split_json(s: &Option<Split>) -> Option<String> {
    s.as_ref().and_then(|v| serde_json::to_string(v).ok())
}

fn json<T: serde::Serialize>(v: &Option<T>) -> Option<String> {
    v.as_ref().and_then(|v| serde_json::to_string(v).ok())
}

fn get_clip(c: &Connection, id: &str) -> AppResult<Clip> {
    c.query_row(&format!("SELECT {CLIP_COLS} FROM clips WHERE id = ?1"), params![id], clip_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("clip {id}")),
            other => other.into(),
        })
}

/// All-or-nothing: if any clip is invalid or its project is missing, none are stored.
pub fn insert_clips(c: &Connection, clips: &[Clip]) -> AppResult<()> {
    for k in clips {
        k.validate()?;
    }
    let tx = c.unchecked_transaction()?;
    for k in clips {
        tx.execute(
            &format!("INSERT INTO clips ({CLIP_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)"),
            params![k.id, k.project_id, k.title, k.start_sec, k.end_sec, k.aspect, k.target, k.captions, k.export_status, k.score, k.hue, k.created_at, k.export_path, k.reason, k.crop_x, k.zoom, track_json(&k.track), split_json(&k.split), k.hook, track_json(&k.cuts), json(&k.layout), json(&k.filters), k.post],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn update_clip(c: &Connection, id: &str, patch: ClipPatch) -> AppResult<Clip> {
    let mut clip = get_clip(c, id)?;
    patch.apply(&mut clip);
    clip.validate()?;
    c.execute(
        "UPDATE clips SET title=?2, start_sec=?3, end_sec=?4, aspect=?5, target=?6, captions=?7, export_status=?8, crop_x=?9, zoom=?10, track=?11, split=?12, hook=?13, cuts=?14, layout=?15, filters=?16, post=?17 WHERE id=?1",
        params![clip.id, clip.title, clip.start_sec, clip.end_sec, clip.aspect, clip.target, clip.captions, clip.export_status, clip.crop_x, clip.zoom, track_json(&clip.track), split_json(&clip.split), clip.hook, track_json(&clip.cuts), json(&clip.layout), json(&clip.filters), clip.post],
    )?;
    Ok(clip)
}

pub fn save_transcript(c: &Connection, project_id: &str, language: &str, model: &str, segments: &[Segment]) -> AppResult<()> {
    c.execute(
        "INSERT INTO transcripts (project_id, language, model, segments) VALUES (?1,?2,?3,?4)
         ON CONFLICT(project_id) DO UPDATE SET language=excluded.language, model=excluded.model, segments=excluded.segments",
        params![project_id, language, model, serde_json::to_string(segments)?],
    )?;
    Ok(())
}

pub fn get_transcript(c: &Connection, project_id: &str) -> AppResult<Option<(String, String, Vec<Segment>)>> {
    let row = c.query_row(
        "SELECT language, model, segments FROM transcripts WHERE project_id = ?1",
        params![project_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    );
    match row {
        Ok((l, m, s)) => Ok(Some((l, m, serde_json::from_str(&s)?))),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Re-analysing a project replaces clips that were never exported. Exported ones are kept.
pub fn delete_unexported_clips(c: &Connection, project_id: &str) -> AppResult<usize> {
    Ok(c.execute("DELETE FROM clips WHERE project_id = ?1 AND export_status IN ('not-exported','failed') AND export_path IS NULL", params![project_id])?)
}

pub fn set_project_duration(c: &Connection, id: &str, duration: f64) -> AppResult<()> {
    c.execute("UPDATE projects SET duration = ?2 WHERE id = ?1", params![id, duration])?;
    Ok(())
}

/// Called by the render queue when an export ends. Not exposed as a frontend command.
pub fn set_clip_export(c: &Connection, id: &str, status: &str, path: Option<&str>) -> AppResult<()> {
    let n = c.execute(
        "UPDATE clips SET export_status = ?2, export_path = COALESCE(?3, export_path) WHERE id = ?1",
        params![id, status, path],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("clip {id}")));
    }
    Ok(())
}

pub fn get_clip_pub(c: &Connection, id: &str) -> AppResult<Clip> {
    get_clip(c, id)
}

pub fn delete_clips(c: &Connection, ids: &[String]) -> AppResult<usize> {
    let tx = c.unchecked_transaction()?;
    let mut n = 0;
    for id in ids {
        n += tx.execute("DELETE FROM clips WHERE id = ?1", params![id])?;
    }
    tx.commit()?;
    Ok(n)
}

fn job_row(r: &Row) -> rusqlite::Result<Job> {
    Ok(Job {
        id: r.get(0)?,
        title: r.get(1)?,
        kind: r.get(2)?,
        status: r.get(3)?,
        progress: r.get(4)?,
        source: r.get(5)?,
        started_at: r.get(6)?,
        duration_sec: r.get(7)?,
        error: r.get(8)?,
        simulated: r.get::<_, i64>(9)? != 0,
    })
}

pub fn list_jobs(c: &Connection) -> AppResult<Vec<Job>> {
    let mut st = c.prepare(
        "SELECT id, title, kind, status, progress, source, started_at, duration_sec, error, simulated
         FROM jobs ORDER BY started_at DESC, rowid DESC",
    )?;
    let rows = st.query_map([], job_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert or update by id, so the frontend can call this for every progress step.
pub fn save_job(c: &Connection, j: &Job) -> AppResult<()> {
    j.validate()?;
    c.execute(
        "INSERT INTO jobs (id, title, kind, status, progress, source, started_at, duration_sec, error, simulated)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, kind=excluded.kind, status=excluded.status, progress=excluded.progress,
            source=excluded.source, started_at=excluded.started_at, duration_sec=excluded.duration_sec,
            error=excluded.error, simulated=excluded.simulated",
        params![j.id, j.title, j.kind, j.status, j.progress, j.source, j.started_at, j.duration_sec, j.error, j.simulated as i64],
    )?;
    Ok(())
}

/// Removes completed and failed jobs. Running and queued jobs stay.
pub fn clear_finished_jobs(c: &Connection) -> AppResult<usize> {
    Ok(c.execute("DELETE FROM jobs WHERE status IN ('completed','failed')", [])?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_memory, schema_version, migrate};

    fn project(id: &str) -> Project {
        Project {
            id: id.into(), title: "Ranked grind".into(), source_kind: "url".into(), source_label: "twitch.tv/videos/1".into(),
            platform: "twitch".into(), duration: 3600.0, status: "processing".into(), created_at: "2026-11-20T10:00:00Z".into(),
            clip_count: 0, hue: 220, size_bytes: 0, source_path: None, uploader: None,
        }
    }
    fn clip(id: &str, pid: &str) -> Clip {
        Clip {
            id: id.into(), project_id: pid.into(), title: "Final boss".into(), start_sec: 10.0, end_sec: 40.0,
            aspect: "9:16".into(), target: "tiktok".into(), captions: "generated".into(), export_status: "not-exported".into(),
            score: 90, hue: 10, created_at: "2026-11-20T10:05:00Z".into(), export_path: None, reason: None, crop_x: 50.0, zoom: 1.0, track: None, split: None, hook: None, cuts: None, layout: None, filters: None, post: None,
        }
    }
    fn job(id: &str, status: &str) -> Job {
        Job {
            id: id.into(), title: "Transcribe".into(), kind: "transcribe".into(), status: status.into(), progress: 10.0,
            source: "Ranked grind".into(), started_at: "2026-11-20T10:01:00Z".into(), duration_sec: 0, error: None, simulated: true,
        }
    }

    #[test]
    fn migration_is_idempotent() {
        let c = open_memory();
        assert_eq!(schema_version(&c).unwrap(), 7);
        migrate(&c).unwrap();
        assert_eq!(schema_version(&c).unwrap(), 7);
    }

    #[test]
    fn source_and_export_paths_roundtrip() {
        let c = open_memory();
        let mut p = project("p1");
        p.source_path = Some("C:\\videos\\a.mp4".into());
        insert_project(&c, &p).unwrap();
        insert_clips(&c, &[clip("c1", "p1")]).unwrap();
        assert_eq!(get_project(&c, "p1").unwrap().source_path.as_deref(), Some("C:\\videos\\a.mp4"));
        set_clip_export(&c, "c1", "exported", Some("C:\\out\\c1.mp4")).unwrap();
        let k = get_clip(&c, "c1").unwrap();
        assert_eq!((k.export_status.as_str(), k.export_path.as_deref()), ("exported", Some("C:\\out\\c1.mp4")));
        // a later status change without a path keeps the file path
        set_clip_export(&c, "c1", "queued", None).unwrap();
        assert_eq!(get_clip(&c, "c1").unwrap().export_path.as_deref(), Some("C:\\out\\c1.mp4"));
    }

    #[test]
    fn project_roundtrip_with_computed_clip_count() {
        let c = open_memory();
        insert_project(&c, &project("p1")).unwrap();
        insert_clips(&c, &[clip("c1", "p1"), clip("c2", "p1")]).unwrap();
        let ps = list_projects(&c).unwrap();
        assert_eq!(ps.len(), 1);
        assert_eq!(ps[0].clip_count, 2);
        assert_eq!(ps[0].title, "Ranked grind");
    }

    #[test]
    fn finished_download_updates_the_project() {
        let c = open_memory();
        insert_project(&c, &project("p1")).unwrap();
        set_project_source(&c, "p1", "C:\\dl\\a.mp4", 61.5, 2048).unwrap();
        let p = get_project(&c, "p1").unwrap();
        assert_eq!((p.status.as_str(), p.duration, p.size_bytes, p.source_path.as_deref()), ("ready", 61.5, 2048, Some("C:\\dl\\a.mp4")));
        assert!(matches!(set_project_source(&c, "nope", "x", 1.0, 1), Err(AppError::NotFound(_))));
    }

    #[test]
    fn transcripts_roundtrip_upsert_and_cascade() {
        let c = open_memory();
        insert_project(&c, &project("p1")).unwrap();
        assert!(get_transcript(&c, "p1").unwrap().is_none());
        let segs = crate::ai::transcript::tests::make(&[(0.0, "hello there")]);
        save_transcript(&c, "p1", "en", "tiny", &segs).unwrap();
        save_transcript(&c, "p1", "en", "base", &segs).unwrap();
        let (lang, model, got) = get_transcript(&c, "p1").unwrap().unwrap();
        assert_eq!((lang.as_str(), model.as_str()), ("en", "base"));
        assert_eq!(got, segs);
        delete_project(&c, "p1").unwrap();
        assert!(get_transcript(&c, "p1").unwrap().is_none());
    }

    #[test]
    fn reanalysis_keeps_exported_clips() {
        let c = open_memory();
        insert_project(&c, &project("p1")).unwrap();
        let mut done = clip("c1", "p1");
        done.export_status = "exported".into();
        done.export_path = Some("C:\\out\\a.mp4".into());
        let mut fresh = clip("c2", "p1");
        fresh.reason = Some("Loud moment".into());
        insert_clips(&c, &[done, fresh]).unwrap();
        assert_eq!(get_clip(&c, "c2").unwrap().reason.as_deref(), Some("Loud moment"));
        assert_eq!(delete_unexported_clips(&c, "p1").unwrap(), 1);
        assert_eq!(list_clips(&c).unwrap().len(), 1);
    }

    #[test]
    fn framing_is_stored_updated_and_cleared() {
        let c = open_memory();
        insert_project(&c, &project("p1")).unwrap();
        insert_clips(&c, &[clip("c1", "p1")]).unwrap();
        let patch = ClipPatch { crop_x: Some(20.0), zoom: Some(1.5), track: Some(vec![[10.0, 0.3], [12.0, 0.6]]), ..Default::default() };
        update_clip(&c, "c1", patch).unwrap();
        let k = get_clip(&c, "c1").unwrap();
        assert_eq!((k.crop_x, k.zoom, k.track.as_ref().map(Vec::len)), (20.0, 1.5, Some(2)));
        let split = Split { x: 0.0, y: 0.6, w: 0.3, h: 0.4, share: 0.35, gy: 0.5 };
        let k = update_clip(&c, &k.id, ClipPatch { split: Some(split), ..Default::default() }).unwrap();
        assert_eq!(list_clips(&c).unwrap().into_iter().find(|x| x.id == k.id).unwrap().split, Some(split));
        let bad = Split { w: 0.9, x: 0.5, ..split };
        assert!(update_clip(&c, &k.id, ClipPatch { split: Some(bad), ..Default::default() }).is_err());
        let off = update_clip(&c, &k.id, ClipPatch { split: Some(Split { share: 0.0, ..split }), ..Default::default() }).unwrap();
        assert_eq!(off.split, None);
        let k2 = update_clip(&c, &off.id, ClipPatch { hook: Some("Watch this".into()), cuts: Some(vec![[1.0, 2.0]]), ..Default::default() }).unwrap();
        let read = list_clips(&c).unwrap().into_iter().find(|x| x.id == k2.id).unwrap();
        assert_eq!((read.hook.as_deref(), read.cuts), (Some("Watch this"), Some(vec![[1.0, 2.0]])));
        assert!(update_clip(&c, &k2.id, ClipPatch { cuts: Some(vec![[2.0, 1.0]]), ..Default::default() }).is_err());
        let none = update_clip(&c, &k2.id, ClipPatch { hook: Some(String::new()), cuts: Some(vec![]), ..Default::default() }).unwrap();
        assert_eq!((none.hook, none.cuts), (None, None));
        update_clip(&c, "c1", ClipPatch { track: Some(vec![]), ..Default::default() }).unwrap();
        assert!(get_clip(&c, "c1").unwrap().track.is_none());
        assert!(update_clip(&c, "c1", ClipPatch { zoom: Some(9.0), ..Default::default() }).is_err());
        assert!(update_clip(&c, "c1", ClipPatch { track: Some(vec![[0.0, 2.0]]), ..Default::default() }).is_err());
    }

    #[test]
    fn deleting_project_cascades_to_clips() {
        let c = open_memory();
        insert_project(&c, &project("p1")).unwrap();
        insert_clips(&c, &[clip("c1", "p1")]).unwrap();
        delete_project(&c, "p1").unwrap();
        assert!(list_clips(&c).unwrap().is_empty());
        assert!(matches!(delete_project(&c, "p1"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn clips_for_missing_project_are_rejected_atomically() {
        let c = open_memory();
        insert_project(&c, &project("p1")).unwrap();
        let r = insert_clips(&c, &[clip("c1", "p1"), clip("c2", "ghost")]);
        assert!(r.is_err());
        assert!(list_clips(&c).unwrap().is_empty(), "first clip must be rolled back");
    }

    #[test]
    fn invalid_values_are_rejected() {
        let c = open_memory();
        let mut p = project("p1");
        p.status = "weird".into();
        assert!(insert_project(&c, &p).is_err());
        insert_project(&c, &project("p1")).unwrap();
        let mut k = clip("c1", "p1");
        k.end_sec = 5.0; // before start
        assert!(insert_clips(&c, &[k]).is_err());
    }

    #[test]
    fn clip_update_applies_only_given_fields_and_validates() {
        let c = open_memory();
        insert_project(&c, &project("p1")).unwrap();
        insert_clips(&c, &[clip("c1", "p1")]).unwrap();
        let u = update_clip(&c, "c1", ClipPatch { export_status: Some("exported".into()), ..Default::default() }).unwrap();
        assert_eq!(u.export_status, "exported");
        assert_eq!(u.title, "Final boss");
        assert!(update_clip(&c, "c1", ClipPatch { start_sec: Some(50.0), ..Default::default() }).is_err());
        assert!(matches!(update_clip(&c, "nope", ClipPatch::default()), Err(AppError::NotFound(_))));
    }

    #[test]
    fn delete_clips_returns_count() {
        let c = open_memory();
        insert_project(&c, &project("p1")).unwrap();
        insert_clips(&c, &[clip("c1", "p1"), clip("c2", "p1")]).unwrap();
        assert_eq!(delete_clips(&c, &["c1".into(), "zzz".into()]).unwrap(), 1);
        assert_eq!(list_clips(&c).unwrap().len(), 1);
    }

    #[test]
    fn job_upsert_updates_progress_and_clear_keeps_running() {
        let c = open_memory();
        save_job(&c, &job("j1", "running")).unwrap();
        let mut j = job("j1", "completed");
        j.progress = 100.0;
        save_job(&c, &j).unwrap();
        save_job(&c, &job("j2", "running")).unwrap();
        save_job(&c, &job("j3", "failed")).unwrap();
        let all = list_jobs(&c).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all.iter().find(|x| x.id == "j1").unwrap().progress, 100.0);
        assert_eq!(clear_finished_jobs(&c).unwrap(), 2);
        let left = list_jobs(&c).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, "j2");
    }

    #[test]
    fn job_progress_out_of_range_is_rejected() {
        let c = open_memory();
        let mut j = job("j1", "running");
        j.progress = 140.0;
        assert!(save_job(&c, &j).is_err());
    }
}
