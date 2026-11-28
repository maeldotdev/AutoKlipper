use crate::{notify, posts};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai::{env, highlights};
use crate::db::models::{Clip, Project};
use crate::db::repo;
use crate::error::{invalid, AppError, AppResult};
use crate::media::live::{self, Control, Event};
use crate::media::{ffmpeg, live_source, ytdlp};
use crate::settings;
use crate::state::AppState;

pub const MAX_SESSIONS: usize = 3;

/// The running monitoring sessions, by stream id.
#[derive(Default)]
pub struct LiveManager {
    sessions: Mutex<HashMap<String, Arc<Control>>>,
}

impl LiveManager {
    fn get(&self, id: &str) -> Option<Arc<Control>> {
        self.sessions.lock().ok()?.get(id).cloned()
    }
    fn remove(&self, id: &str) {
        if let Ok(mut s) = self.sessions.lock() {
            s.remove(id);
        }
    }
    /// Reserve a slot. Fails when the stream already runs or too many do.
    fn reserve(&self, id: &str) -> AppResult<Arc<Control>> {
        let mut s = self.sessions.lock().map_err(|_| AppError::Internal("live lock".into()))?;
        if s.contains_key(id) {
            return invalid("This stream is already being monitored.");
        }
        if s.len() >= MAX_SESSIONS {
            return invalid(format!("Up to {MAX_SESSIONS} streams can be monitored at once. Stop one first."));
        }
        let c = Arc::new(Control::default());
        s.insert(id.to_string(), c.clone());
        Ok(c)
    }
    /// Called when the app closes, so no FFmpeg or Python process is left behind.
    pub fn stop_all(&self) {
        if let Ok(s) = self.sessions.lock() {
            s.values().for_each(|c| c.stop());
        }
    }
    pub fn running(&self) -> Vec<String> {
        self.sessions.lock().map(|s| s.keys().cloned().collect()).unwrap_or_default()
    }
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiveRequest {
    pub id: String,
    pub url: String,
    pub confirmed_rights: bool,
    pub model: String,
    pub language: String,
    pub auto_clip: bool,
    pub buffer_minutes: u32,
    pub min_len: f64,
    pub max_len: f64,
    pub moments: Vec<String>,
    pub sensitivity: u32,
    pub aspect: String,
    pub target: String,
    pub max_height: u32,
}

impl LiveRequest {
    fn validate(&self) -> AppResult<()> {
        if !self.confirmed_rights {
            return invalid("Confirm that you have the right to record and clip this stream first.");
        }
        if self.id.is_empty() || self.id.len() > 40 || !self.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            return invalid("Bad stream id.");
        }
        if !env::MODELS.contains(&self.model.as_str()) {
            return invalid("Unknown model.");
        }
        if !(1..=60).contains(&self.buffer_minutes) || self.min_len < 5.0 || self.max_len < self.min_len || self.max_len > 180.0 {
            return invalid("Check the buffer length (1 to 60 minutes) and clip length (5 to 180 seconds).");
        }
        if ![0, 360, 480, 720, 1080].contains(&self.max_height) {
            return invalid("Choose a quality from the list.");
        }
        Clip {
            id: "check".into(), project_id: "check".into(), title: "check".into(), start_sec: 0.0, end_sec: 1.0,
            aspect: self.aspect.clone(), target: self.target.clone(), captions: "none".into(), export_status: "not-exported".into(),
            score: 0, hue: 0, created_at: String::new(), export_path: None, reason: None, crop_x: 50.0, zoom: 1.0, track: None, split: None, hook: None, cuts: None, layout: None, filters: None, post: None, sfx: None,
        }
        .validate()
    }
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct LiveUpdate {
    session_id: String,
    kind: &'static str,
    message: Option<String>,
    uptime_sec: Option<f64>,
    buffered_sec: Option<f64>,
    thumbnail: Option<String>,
    transcribing: Option<bool>,
    /// Moment number within the session.
    n: Option<usize>,
    at_sec: Option<f64>,
    score: Option<u32>,
    label: Option<String>,
    title: Option<String>,
    project_id: Option<String>,
}

fn mmss(sec: f64) -> String {
    let s = sec.max(0.0) as u64;
    format!("{}:{:02}", s / 60, s % 60)
}

struct Store {
    app: AppHandle,
    request: LiveRequest,
    stream_title: String,
    uploader: Option<String>,
    connector: &'static str,
    host: String,
    moments: HashMap<usize, (f64, u32, String, String)>,
}

impl Store {
    /// A finished live clip becomes its own project, so editing, captions and export work as for any video.
    fn save(&self, n: usize, clip: &live::Clip) -> AppResult<String> {
        let state = self.app.state::<AppState>();
        let db = state.db()?;
        let (at, score, reason, title) = self.moments.get(&n).cloned().unwrap_or((0.0, 0, "Live moment".into(), "Live clip".into()));
        let pid = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let hue = (self.request.id.bytes().map(u64::from).sum::<u64>() % 360) as i64;
        repo::insert_project(&db, &Project {
            id: pid.clone(),
            title: format!("Live: {}, {}", self.stream_title.chars().take(80).collect::<String>(), mmss(at)),
            source_kind: "live".into(),
            // Never the full link: RTMP addresses carry secret stream keys.
            source_label: self.host.clone(),
            platform: self.connector.into(),
            duration: clip.duration,
            status: "ready".into(),
            created_at: now.clone(),
            clip_count: 0,
            hue,
            size_bytes: std::fs::metadata(&clip.file).map(|m| m.len() as i64).unwrap_or(0),
            source_path: Some(clip.file.display().to_string()),
            uploader: self.uploader.as_ref().map(|u| u.chars().take(200).collect()),
        })?;
        if !clip.segments.is_empty() {
            repo::save_transcript(&db, &pid, &clip.language, &self.request.model, &clip.segments)?;
        }
        let clip_id = uuid::Uuid::new_v4().to_string();
        repo::insert_clips(&db, &[Clip {
            id: clip_id.clone(),
            project_id: pid.clone(),
            title,
            start_sec: clip.start,
            end_sec: clip.end.max(clip.start + 0.1),
            aspect: self.request.aspect.clone(),
            target: self.request.target.clone(),
            captions: if clip.segments.is_empty() { "none" } else { "generated" }.into(),
            export_status: "not-exported".into(),
            score: score as i64,
            hue,
            created_at: now,
            export_path: None,
            reason: Some(reason), crop_x: 50.0, zoom: 1.0, track: None, split: None, hook: None, cuts: None, layout: None, filters: None, post: None, sfx: None,
        }])?;
        drop(db);
        posts::write_in_background(&self.app, vec![clip_id]);
        notify::show(&self.app, "Live clip is ready", &self.stream_title, format!("/clips?project={pid}"));
        Ok(pid)
    }

    fn handle(&mut self, event: Event, transcribing: bool) {
        let mut u = LiveUpdate { session_id: self.request.id.clone(), ..Default::default() };
        match event {
            Event::Connecting => u.kind = "connecting",
            Event::Monitoring => {
                u.kind = "monitoring";
                u.transcribing = Some(transcribing);
            }
            Event::Reconnecting(m) => {
                u.kind = "reconnecting";
                u.message = Some(m);
            }
            Event::Tick { uptime, buffered, thumbnail } => {
                u.kind = "tick";
                u.uptime_sec = Some(uptime);
                u.buffered_sec = Some(buffered);
                u.thumbnail = thumbnail.map(|p| p.display().to_string());
            }
            Event::Found(m) => {
                self.moments.insert(m.n, (m.at, m.score, m.reason.clone(), m.title.clone()));
                u.kind = "found";
                u.n = Some(m.n);
                u.at_sec = Some(m.at);
                u.score = Some(m.score);
                u.label = Some(m.reason);
                u.title = Some(m.title);
            }
            Event::Ready { n, clip } => {
                u.n = Some(n);
                match self.save(n, &clip) {
                    Ok(pid) => {
                        u.kind = "ready";
                        u.project_id = Some(pid);
                        tracing::info!(session = %self.request.id, n, "live clip saved");
                    }
                    Err(e) => {
                        u.kind = "failed";
                        u.message = Some(e.to_string());
                    }
                }
            }
            Event::Failed { n, message } => {
                u.kind = "failed";
                u.n = Some(n);
                u.message = Some(message);
            }
            Event::Warning(m) => {
                tracing::warn!(session = %self.request.id, "{m}");
                u.kind = "warning";
                u.message = Some(m);
            }
            Event::Ended(error) => {
                u.kind = "ended";
                u.message = error;
                self.app.state::<AppState>().live.remove(&self.request.id);
                tracing::info!(session = %self.request.id, "live session ended");
            }
        }
        let _ = self.app.emit("live-update", u);
    }
}

/// Start monitoring a stream. Returns once the stream address is known; progress then arrives as `live-update`.
#[tauri::command]
pub async fn live_start(app: AppHandle, state: State<'_, AppState>, request: LiveRequest) -> AppResult<()> {
    request.validate()?;
    let saved = settings::load(&state.paths.settings_file)?;
    let setting = |k: &str| saved[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    let tools = ffmpeg::locate(setting("ffmpegPath").as_deref())
        .ok_or_else(|| AppError::Invalid("FFmpeg was not found. Install it or choose it in Settings, Processing.".into()))?;
    let control = state.live.reserve(&request.id)?;

    // From here on the slot must be released if anything fails.
    let source = {
        let (url, yt, cookies, height) = (request.url.clone(), ytdlp::locate(setting("ytdlpPath").as_deref()), setting("cookiesBrowser"), request.max_height);
        tauri::async_runtime::spawn_blocking(move || live_source::resolve(&url, yt.as_ref(), cookies.as_deref(), height))
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
            .and_then(|r| r)
    };
    let source = match source {
        Ok(s) if !control.stopped() => s,
        Ok(_) => {
            state.live.remove(&request.id);
            return Ok(());
        }
        Err(e) => {
            state.live.remove(&request.id);
            return Err(e);
        }
    };

    let ai_dir = state.paths.root.join("ai");
    let models = setting("modelFolder").filter(|s| !s.contains('%')).map(PathBuf::from).unwrap_or_else(|| state.paths.models.clone());
    let model_dir = env::model_dir(&models, &request.model);
    let transcriber = env::python(&ai_dir)
        .filter(|_| model_dir.join("model.bin").is_file())
        .map(|python| live::Transcriber { python, script: env::script_path(&ai_dir), model_dir, language: request.language.clone() });
    let transcribing = transcriber.is_some();

    let dir = state.paths.temp.join("live").join(&request.id);
    std::fs::create_dir_all(&dir)?;
    if let Err(e) = app.asset_protocol_scope().allow_directory(&dir, false) {
        tracing::warn!("preview will not show: {e}");
    }
    let mut input_args = Vec::new();
    let network = source.urls.first().is_some_and(|u| u.starts_with("http"));
    if network {
        input_args.extend(["-rw_timeout", "15000000", "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"].map(String::from));
        if !source.headers.is_empty() {
            input_args.extend(["-headers".to_string(), source.headers.clone()]);
        }
    }
    let cfg = live::Config {
        dir,
        clip_dir: state.paths.downloads.clone(),
        clip_stem: format!("live-{}", uuid::Uuid::new_v4().simple()),
        tools,
        inputs: source.urls.clone(),
        input_args,
        transcriber,
        segment_sec: 8,
        buffer_sec: request.buffer_minutes * 60,
        options: highlights::Options {
            min_len: request.min_len,
            max_len: request.max_len,
            count: 3,
            moments: request.moments.clone(),
            sensitivity: request.sensitivity,
            taken: vec![],
        },
        auto_clip: request.auto_clip,
    };
    let host = url::Url::parse(&request.url).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_else(|| "stream".into());
    let mut store = Store { app: app.clone(), stream_title: source.title, uploader: source.uploader, connector: source.connector, host: host.clone(), request, moments: HashMap::new() };
    // The link itself is not logged: it can carry stream keys.
    tracing::info!(session = %store.request.id, connector = source.connector, %host, transcribing, "live session starting");
    std::thread::spawn(move || live::run(&cfg, &control, |e| store.handle(e, transcribing)));
    Ok(())
}

#[tauri::command]
pub fn live_stop(state: State<'_, AppState>, id: String) -> bool {
    match state.live.get(&id) {
        Some(c) => {
            c.stop();
            true
        }
        None => false,
    }
}

/// Cut the last `seconds` of the buffer into a clip, on request.
#[tauri::command]
pub fn live_clip_now(state: State<'_, AppState>, id: String, seconds: f64) -> AppResult<()> {
    let Some(c) = state.live.get(&id) else {
        return invalid("This stream is not being monitored.");
    };
    c.clip_last(seconds);
    Ok(())
}

#[tauri::command]
pub fn live_running(state: State<'_, AppState>) -> Vec<String> {
    state.live.running()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> LiveRequest {
        LiveRequest {
            id: "s_1".into(), url: "https://example.com/live.m3u8".into(), confirmed_rights: true, model: "tiny".into(), language: "auto".into(),
            auto_clip: true, buffer_minutes: 10, min_len: 10.0, max_len: 60.0, moments: vec![], sensitivity: 60, aspect: "9:16".into(),
            target: "tiktok".into(), max_height: 720,
        }
    }

    #[test]
    fn requests_are_validated() {
        assert!(request().validate().is_ok());
        for bad in [
            LiveRequest { confirmed_rights: false, ..request() },
            LiveRequest { id: "../x".into(), ..request() },
            LiveRequest { model: "huge".into(), ..request() },
            LiveRequest { buffer_minutes: 0, ..request() },
            LiveRequest { max_len: 5.0, ..request() },
            LiveRequest { aspect: "2:1".into(), ..request() },
            LiveRequest { max_height: 999, ..request() },
        ] {
            assert!(bad.validate().is_err(), "{bad:?}");
        }
    }

    #[test]
    fn at_most_three_sessions_and_no_duplicates() {
        let m = LiveManager::default();
        let a = m.reserve("a").unwrap();
        assert!(m.reserve("a").is_err());
        m.reserve("b").unwrap();
        m.reserve("c").unwrap();
        assert!(m.reserve("d").unwrap_err().to_string().contains("at once"));
        m.stop_all();
        assert!(a.stopped());
        m.remove("a");
        assert!(m.reserve("d").is_ok());
        assert_eq!(m.running().len(), 3);
    }
}
