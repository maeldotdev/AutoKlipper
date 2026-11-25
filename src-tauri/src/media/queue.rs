use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use super::ffmpeg::Tools;
use super::process::{self, Outcome, Running};
use super::scheduler::Scheduler;
use super::analyze::{self, Analyze};
use super::{probe, render, ytdlp};
use crate::db::models::Job;
use crate::db::repo;
use crate::state::AppState;

/// What a queued job does. Every kind shares one queue and one concurrency limit.
pub enum Work {
    Render { clip_id: String, args: Vec<String>, duration: f64, out_path: PathBuf, ffmpeg: PathBuf, cwd: PathBuf, temp_files: Vec<PathBuf>, srt: Option<(PathBuf, String)> },
    /// Program steps with CLIPIT_PROGRESS output: AI setup and model downloads. `cleanup` is removed if it fails.
    Tool { steps: Vec<(PathBuf, Vec<String>)>, cleanup: Option<PathBuf> },
    Analyze(Box<Analyze>),
    Download { project_id: String, ytdlp: PathBuf, args: Vec<String>, dir: PathBuf, stem: String, tools: Tools },
}

pub struct Task {
    pub job: Job,
    pub work: Work,
}

/// The part of a `job-update` event that says what changed beside the job itself.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Extra {
    pub clip_id: Option<String>,
    pub export_status: Option<String>,
    pub export_path: Option<String>,
    pub project_id: Option<String>,
    pub project_status: Option<String>,
    pub source_path: Option<String>,
    pub duration: Option<f64>,
    pub size_bytes: Option<u64>,
    /// Set when analysis added clips: the UI reloads them.
    pub clips_added: Option<usize>,
    pub warning: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct JobEvent<'a> {
    job: &'a Job,
    #[serde(flatten)]
    extra: &'a Extra,
}

pub fn announce(app: &AppHandle, job: &Job, extra: &Extra) {
    let _ = app.emit("job-update", JobEvent { job, extra });
}

fn save(app: &AppHandle, job: &Job) {
    let state = app.state::<AppState>();
    if let Ok(db) = state.db() {
        if let Err(e) = repo::save_job(&db, job) {
            tracing::error!(job = %job.id, "could not save job: {e}");
        }
    }
}

fn set_clip(app: &AppHandle, clip_id: &str, status: &str, path: Option<&str>) {
    let state = app.state::<AppState>();
    if let Ok(db) = state.db() {
        if let Err(e) = repo::set_clip_export(&db, clip_id, status, path) {
            tracing::error!(clip = %clip_id, "could not update clip export state: {e}");
        }
    }
}

fn set_project_status(app: &AppHandle, id: &str, status: &str) {
    let state = app.state::<AppState>();
    if let Ok(db) = state.db() {
        if let Err(e) = repo::set_project_status(&db, id, status) {
            tracing::error!(project = %id, "could not update project status: {e}");
        }
    }
}

impl Work {
    /// The state a job leaves behind while it waits or after it stops without finishing.
    pub fn idle_extra(&self, failed: bool) -> Extra {
        match self {
            Work::Render { clip_id, .. } => Extra {
                clip_id: Some(clip_id.clone()),
                export_status: Some(if failed { "failed" } else { "not-exported" }.into()),
                ..Default::default()
            },
            Work::Download { project_id, .. } => Extra { project_id: Some(project_id.clone()), project_status: Some("failed".into()), ..Default::default() },
            Work::Tool { .. } => Extra::default(),
            // The video is fine; only the analysis did not happen.
            Work::Analyze(a) => Extra { project_id: Some(a.project_id.clone()), project_status: Some("draft".into()), ..Default::default() },
        }
    }

    fn mark_waiting_ended(&self, app: &AppHandle) {
        match self {
            Work::Render { clip_id, .. } => set_clip(app, clip_id, "not-exported", None),
            Work::Download { project_id, .. } => set_project_status(app, project_id, "failed"),
            Work::Tool { .. } => {}
            Work::Analyze(a) => set_project_status(app, &a.project_id, "draft"),
        }
    }
}

#[derive(Default)]
struct Inner {
    sched: Scheduler<Task>,
    running: HashMap<String, Arc<Running>>,
    limit: usize,
}

#[derive(Default)]
pub struct Queue {
    inner: Mutex<Inner>,
}

impl Queue {
    /// Jobs running or waiting.
    pub fn active(&self) -> usize {
        let (running, pending) = self.inner.lock().map(|g| g.sched.counts()).unwrap_or_default();
        running + pending
    }

    pub fn enqueue(self: &Arc<Self>, app: &AppHandle, task: Task, limit: usize) {
        {
            let mut g = self.inner.lock().unwrap();
            g.limit = limit.clamp(1, 4);
            g.sched.enqueue(task.job.id.clone(), task);
        }
        self.pump(app);
    }

    /// Stop a waiting or running job. Returns false if the job is unknown or already finished.
    pub fn cancel(self: &Arc<Self>, app: &AppHandle, job_id: &str) -> bool {
        let (waiting, running) = {
            let mut g = self.inner.lock().unwrap();
            (g.sched.cancel_pending(job_id), g.running.get(job_id).cloned())
        };
        if let Some(t) = waiting {
            let mut job = t.job;
            job.status = "failed".into();
            job.error = Some("Cancelled.".into());
            save(app, &job);
            t.work.mark_waiting_ended(app);
            let mut extra = t.work.idle_extra(false);
            // A cancelled download leaves an empty project that the user can delete.
            if matches!(t.work, Work::Download { .. }) {
                extra.project_status = Some("failed".into());
            }
            announce(app, &job, &extra);
            return true;
        }
        if let Some(r) = running {
            r.cancel();
            return true;
        }
        false
    }

    fn pump(self: &Arc<Self>, app: &AppHandle) {
        let ready = {
            let mut g = self.inner.lock().unwrap();
            let limit = g.limit.max(1);
            let ready = g.sched.take_ready(limit);
            ready
                .into_iter()
                .map(|(id, t)| {
                    let r = Arc::new(Running::default());
                    g.running.insert(id, r.clone());
                    (t, r)
                })
                .collect::<Vec<_>>()
        };
        for (task, running) in ready {
            let (q, app) = (self.clone(), app.clone());
            std::thread::spawn(move || {
                q.run_task(&app, task, running);
            });
        }
    }

    fn run_task(self: &Arc<Self>, app: &AppHandle, task: Task, running: Arc<Running>) {
        let Task { mut job, work } = task;
        let started = Instant::now();
        job.status = "running".into();
        job.progress = 0.0;
        save(app, &job);
        let start_extra = match &work {
            Work::Render { clip_id, .. } => {
                set_clip(app, clip_id, "exporting", None);
                Extra { clip_id: Some(clip_id.clone()), export_status: Some("exporting".into()), ..Default::default() }
            }
            Work::Download { project_id, .. } => Extra { project_id: Some(project_id.clone()), project_status: Some("processing".into()), ..Default::default() },
            Work::Tool { .. } => Extra::default(),
            Work::Analyze(a) => Extra { project_id: Some(a.project_id.clone()), project_status: Some("processing".into()), ..Default::default() },
        };
        announce(app, &job, &start_extra);
        tracing::info!(job = %job.id, kind = %job.kind, "job started");

        let outcome = match &work {
            Work::Render { clip_id, args, duration, out_path, ffmpeg, cwd, srt, .. } => run_render(app, &mut job, clip_id, args, *duration, out_path, ffmpeg, cwd, srt.as_ref(), &running),
            Work::Tool { steps, .. } => run_tool(app, &mut job, steps, &running),
            Work::Analyze(a) => run_analyze(app, &mut job, a, &running),
            Work::Download { project_id, ytdlp, args, dir, stem, tools } => run_download(app, &mut job, project_id, ytdlp, args, dir, stem, tools, &running),
        };

        job.duration_sec = started.elapsed().as_secs() as i64;
        let extra = match outcome {
            Ok(extra) => {
                job.status = "completed".into();
                job.progress = 100.0;
                job.error = None;
                tracing::info!(job = %job.id, secs = job.duration_sec, "job finished");
                extra
            }
            Err(msg) => {
                let cancelled = msg == "Cancelled";
                job.status = "failed".into();
                job.error = Some(if cancelled { "Cancelled.".into() } else { msg.clone() });
                match &work {
                    Work::Render { clip_id, out_path, .. } => {
                        let _ = std::fs::remove_file(out_path);
                        set_clip(app, clip_id, if cancelled { "not-exported" } else { "failed" }, None);
                    }
                    Work::Download { project_id, dir, stem, .. } => {
                        ytdlp::cleanup(dir, stem);
                        set_project_status(app, project_id, "failed");
                    }
                    Work::Tool { cleanup, .. } => {
                        // Remove half-downloaded model files, but never a finished model.
                        if let Some(dir) = cleanup {
                            if !dir.join("model.bin").is_file() && !dir.join("embedding.onnx").is_file() {
                                let _ = std::fs::remove_dir_all(dir);
                            }
                        }
                    }
                    Work::Analyze(a) => set_project_status(app, &a.project_id, "draft"),
                }
                if cancelled {
                    tracing::info!(job = %job.id, "job cancelled");
                } else {
                    tracing::error!(job = %job.id, "job failed: {msg}");
                }
                work.idle_extra(!cancelled)
            }
        };
        match &work {
            Work::Render { temp_files, .. } => temp_files.iter().for_each(|f| {
                let _ = std::fs::remove_file(f);
            }),
            Work::Analyze(a) => {
                for ext in ["wav", "json"] {
                    let _ = std::fs::remove_file(a.temp.join(format!("{}.{ext}", job.id)));
                }
            }
            _ => {}
        }
        save(app, &job);
        announce(app, &job, &extra);

        {
            let mut g = self.inner.lock().unwrap();
            g.running.remove(&job.id);
            g.sched.finish(&job.id);
        }
        self.pump(app);
    }
}

#[allow(clippy::too_many_arguments)]
fn run_render(app: &AppHandle, job: &mut Job, clip_id: &str, args: &[String], duration: f64, out_path: &PathBuf, ffmpeg: &PathBuf, cwd: &PathBuf, srt: Option<&(PathBuf, String)>, running: &Running) -> Result<Extra, String> {
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let progress_extra = Extra { clip_id: Some(clip_id.into()), export_status: Some("exporting".into()), ..Default::default() };
    render::run_in(Some(cwd), ffmpeg, args, duration, running, |p| {
        job.progress = p;
        if last_emit.elapsed() >= Duration::from_millis(250) {
            last_emit = Instant::now();
            announce(app, job, &progress_extra);
        }
    })?;
    match std::fs::metadata(out_path) {
        Ok(m) if m.len() > 0 => {}
        _ => return Err("FFmpeg finished but the output file is empty. The clip may start after the end of the video.".into()),
    }
    if let Some((file, text)) = srt {
        std::fs::write(file, text).map_err(|e| format!("The video was written but the SRT file was not: {e}"))?;
    }
    let path = out_path.display().to_string();
    set_clip(app, clip_id, "exported", Some(&path));
    Ok(Extra { clip_id: Some(clip_id.into()), export_status: Some("exported".into()), export_path: Some(path), ..Default::default() })
}

fn run_tool(app: &AppHandle, job: &mut Job, steps: &[(PathBuf, Vec<String>)], running: &Running) -> Result<Extra, String> {
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let n = steps.len().max(1) as f64;
    for (i, (exe, args)) in steps.iter().enumerate() {
        job.progress = i as f64 / n * 100.0;
        announce(app, job, &Extra::default());
        let outcome = process::run_lines(exe, args, running, |line| {
            if let Some(p) = analyze::parse_progress(line) {
                job.progress = (i as f64 * 100.0 + p) / n;
                if last_emit.elapsed() >= Duration::from_millis(300) {
                    last_emit = Instant::now();
                    announce(app, job, &Extra::default());
                }
            }
        })?;
        match outcome {
            Outcome::Done => {}
            Outcome::Cancelled => return Err("Cancelled".into()),
            Outcome::Failed(e) => return Err(analyze::helper_error(&e)),
        }
    }
    Ok(Extra::default())
}

fn run_analyze(app: &AppHandle, job: &mut Job, a: &Analyze, running: &Running) -> Result<Extra, String> {
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let progress_extra = Extra { project_id: Some(a.project_id.clone()), project_status: Some("processing".into()), ..Default::default() };
    let stem = job.id.clone();
    let result = analyze::run(a, &stem, running, |p| {
        job.progress = p;
        if last_emit.elapsed() >= Duration::from_millis(300) {
            last_emit = Instant::now();
            announce(app, job, &progress_extra);
        }
    })?;
    let state = app.state::<AppState>();
    let db = state.db().map_err(|e| e.to_string())?;
    let store = || -> crate::error::AppResult<()> {
        repo::save_transcript(&db, &a.project_id, &result.language, &a.model_name, &result.segments)?;
        repo::delete_unexported_clips(&db, &a.project_id)?;
        repo::insert_clips(&db, &result.clips)?;
        repo::set_project_duration(&db, &a.project_id, result.duration)?;
        repo::set_project_status(&db, &a.project_id, "ready")
    };
    store().map_err(|e| e.to_string())?;
    for w in &result.warnings {
        tracing::warn!(project = %a.project_id, "{w}");
    }
    Ok(Extra {
        project_id: Some(a.project_id.clone()),
        project_status: Some("ready".into()),
        duration: Some(result.duration),
        clips_added: Some(result.clips.len()),
        warning: (!result.warnings.is_empty()).then(|| result.warnings.join(" ")),
        ..Default::default()
    })
}

#[allow(clippy::too_many_arguments)]
fn run_download(app: &AppHandle, job: &mut Job, project_id: &str, ytdlp_exe: &PathBuf, args: &[String], dir: &PathBuf, stem: &str, tools: &Tools, running: &Running) -> Result<Extra, String> {
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let progress_extra = Extra { project_id: Some(project_id.into()), project_status: Some("processing".into()), ..Default::default() };
    let outcome = process::run_lines(ytdlp_exe, args, running, |line| {
        if let Some(p) = ytdlp::parse_progress(line) {
            job.progress = p;
            if last_emit.elapsed() >= Duration::from_millis(300) {
                last_emit = Instant::now();
                announce(app, job, &progress_extra);
            }
        }
    })?;
    match outcome {
        Outcome::Cancelled => return Err("Cancelled".into()),
        Outcome::Failed(stderr) => return Err(ytdlp::explain_error(&stderr)),
        Outcome::Done => {}
    }
    let file = ytdlp::find_output(dir, stem).ok_or("The download finished but no video file was found. Try updating yt-dlp.")?;
    let info = probe::probe(tools, &file).map_err(|e| format!("The download is not a video AutoKlipper can read. {e}"))?;
    let path = file.display().to_string();
    {
        let state = app.state::<AppState>();
        let db = state.db().map_err(|e| e.to_string())?;
        repo::set_project_source(&db, project_id, &path, info.duration_sec, info.size_bytes as i64).map_err(|e| e.to_string())?;
    }
    Ok(Extra {
        project_id: Some(project_id.into()),
        project_status: Some("ready".into()),
        source_path: Some(path),
        duration: Some(info.duration_sec),
        size_bytes: Some(info.size_bytes),
        ..Default::default()
    })
}
