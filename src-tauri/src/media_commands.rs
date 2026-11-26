use serde::Deserialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

use crate::ai::{ass, reframe, transcript};
use crate::db::models::Job;
use crate::db::repo;
use crate::error::{invalid, AppError, AppResult};
use crate::media::ffmpeg::{self, FfmpegStatus, Tools};
use crate::media::probe::{self, MediaInfo};
use crate::media::waveform;
use crate::connectors::{self, ConnectorInfo, UrlKind};
use crate::media::queue::{self, Extra, Task, Work};
use crate::media::ytdlp::{self, ToolStatus, UrlInfo, YtDlp};
use crate::media::render::{self, Encoder, Quality, RenderOptions};
use crate::settings;
use crate::state::AppState;

const NO_FFMPEG: &str = "FFmpeg was not found. Install it (winget install Gyan.FFmpeg) or choose ffmpeg.exe in Settings, Processing.";

/// The FFmpeg path the user chose in Settings, if any.
fn configured_path(state: &AppState) -> Option<String> {
    settings::load(&state.paths.settings_file).ok()?["ffmpegPath"].as_str().map(String::from)
}

fn tools(state: &AppState) -> AppResult<Tools> {
    ffmpeg::locate(configured_path(state).as_deref()).ok_or_else(|| AppError::Invalid(NO_FFMPEG.into()))
}

#[tauri::command]
pub async fn ffmpeg_status(state: State<'_, AppState>) -> AppResult<FfmpegStatus> {
    Ok(ffmpeg::status(configured_path(&state).as_deref()))
}

/// Read a video's size, length and codecs. Also lets the webview play that one file for preview.
#[tauri::command]
pub async fn probe_media(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<MediaInfo> {
    let info = probe::probe(&tools(&state)?, Path::new(&path))?;
    use tauri::Manager;
    if let Err(e) = app.asset_protocol_scope().allow_file(&path) {
        tracing::warn!("could not allow preview of {path}: {e}");
    }
    tracing::info!(%path, secs = info.duration_sec, "media probed");
    Ok(info)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub clip_ids: Vec<String>,
    pub resolution: u32,
    pub fps: u32,
    pub quality: Quality,
    /// "auto" and "cpu" use x264. "gpu" uses the first hardware encoder FFmpeg offers.
    pub device: String,
    pub out_dir: Option<String>,
    pub concurrency: usize,
    /// Draw captions into the picture (clips whose captions are not switched off).
    #[serde(default)]
    pub burn_captions: bool,
    /// Also write an .srt file next to each video.
    #[serde(default)]
    pub write_srt: bool,
    #[serde(default)]
    pub style: Option<ass::Style>,
}

fn safe_name(title: &str) -> String {
    let s: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let s: String = s.chars().take(40).collect();
    if s.is_empty() { "clip".into() } else { s }
}

pub fn output_name(title: &str, aspect: &str, clip_id: &str) -> String {
    let id: String = clip_id.chars().filter(|c| c.is_alphanumeric()).rev().take(8).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{}-{}-{}.mp4", safe_name(title), aspect.replace(':', "x"), id)
}

/// Queue real renders, one job per clip. Nothing is queued unless every clip is valid.
#[tauri::command]
pub fn export_clips(app: AppHandle, state: State<'_, AppState>, request: ExportRequest) -> AppResult<Vec<String>> {
    if request.clip_ids.is_empty() {
        return invalid("Choose at least one clip to export.");
    }
    let tools = tools(&state)?;
    let encoder = if request.device == "gpu" {
        let hw = ffmpeg::hardware_encoders(&tools.ffmpeg);
        match hw.first().map(String::as_str) {
            Some("nvenc") => Encoder::Nvenc,
            Some("amf") => Encoder::Amf,
            Some("qsv") => Encoder::Qsv,
            _ => return invalid("GPU encoding was requested but this FFmpeg has no hardware H.264 encoder. Switch the device to Automatic or CPU in Settings."),
        }
    } else {
        Encoder::X264
    };
    let opts = RenderOptions { resolution: request.resolution, fps: request.fps, quality: request.quality, encoder, crop_x: 50.0, zoom: 1.0, x_expr: None, split: None };
    opts.validate()?;

    let out_dir: PathBuf = match request.out_dir.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => state.paths.exports.clone(),
    };
    std::fs::create_dir_all(&out_dir).map_err(|e| AppError::Invalid(format!("Cannot use the export folder {}: {e}", out_dir.display())))?;

    // Validate everything first so a bad clip cannot leave half a batch queued.
    let mut tasks = Vec::new();
    {
        let db = state.db()?;
        for id in &request.clip_ids {
            let clip = repo::get_clip_pub(&db, id)?;
            let project = repo::get_project(&db, &clip.project_id)?;
            let Some(src) = project.source_path.as_deref().filter(|s| !s.is_empty()) else {
                return invalid(format!("\"{}\" has no source video on this PC. Import a local video in Auto Clipper to export real files.", clip.title));
            };
            if !Path::new(src).is_file() {
                return Err(AppError::NotFound(format!("the source video for \"{}\" ({src}). It may have been moved or deleted", clip.title)));
            }
            if project.duration > 0.0 && clip.start_sec >= project.duration - 0.1 {
                return invalid(format!("\"{}\" starts after the end of its source video.", clip.title));
            }
            let dur = clip.end_sec - clip.start_sec;
            let out = out_dir.join(output_name(&clip.title, &clip.aspect, &clip.id));
            // Captions the user switched off for a clip stay off, whatever the batch setting.
            let wants = (request.burn_captions || request.write_srt) && clip.captions != "none";
            let words = if wants {
                let Some((_, _, all)) = repo::get_transcript(&db, &project.id)? else {
                    return invalid(format!("\"{}\" has captions on but its video has no transcript. Transcribe it first, or turn captions off for the export.", clip.title));
                };
                transcript::slice(&all, clip.start_sec, clip.end_sec)
            } else {
                Vec::new()
            };
            let cwd = state.paths.temp.clone();
            let mut temp_files = Vec::new();
            let mut ass_name = None;
            if request.burn_captions && !words.is_empty() {
                let mut style = request.style.clone().unwrap_or_default();
                // In the gaming layout captions sit where the game and the camera meet.
                if let Some(s) = clip.split.filter(|_| clip.aspect == "9:16") {
                    style.pos_y = (1.0 - s.share) * 100.0;
                }
                let (w, h) = render::target_size(&clip.aspect, opts.resolution)?;
                let name = format!("cap-{}.ass", uuid::Uuid::new_v4().simple());
                std::fs::write(cwd.join(&name), ass::build(&words, &style, w, h))?;
                temp_files.push(cwd.join(&name));
                ass_name = Some(name);
            }
            let srt = (request.write_srt && !words.is_empty()).then(|| (out.with_extension("srt"), transcript::to_srt(&words)));
            // Each clip carries its own framing; a face path makes the crop move.
            let mut framed = opts.clone();
            framed.crop_x = clip.crop_x;
            framed.zoom = clip.zoom;
            framed.split = clip.split;
            if let Some(path) = clip.track.as_deref().filter(|t| !t.is_empty()) {
                let info = probe::probe(&tools, Path::new(src))?;
                let (w, h) = render::target_size(&clip.aspect, opts.resolution)?;
                framed.x_expr = reframe::expression(path, clip.start_sec, info.width, info.height, w as f64 / h as f64, clip.zoom);
            }
            let args = render::build_args(Path::new(src), clip.start_sec, dur, &out, &clip.aspect, &framed, ass_name.as_deref())?;
            let job = Job {
                id: uuid::Uuid::new_v4().to_string(),
                title: format!("Export: {}", clip.title),
                kind: "export".into(),
                status: "queued".into(),
                progress: 0.0,
                source: project.title.clone(),
                started_at: chrono::Utc::now().to_rfc3339(),
                duration_sec: 0,
                error: None,
                simulated: false,
            };
            tasks.push(Task { job, work: Work::Render { clip_id: clip.id.clone(), args, duration: dur, out_path: out, ffmpeg: tools.ffmpeg.clone(), cwd, temp_files, srt } });
        }
        for t in &tasks {
            repo::save_job(&db, &t.job)?;
            if let Work::Render { clip_id, .. } = &t.work {
                repo::set_clip_export(&db, clip_id, "queued", None)?;
            }
        }
    }
    let ids: Vec<String> = tasks.iter().map(|t| t.job.id.clone()).collect();
    tracing::info!(count = ids.len(), "exports queued");
    for t in tasks {
        if let Work::Render { clip_id, .. } = &t.work {
            queue::announce(&app, &t.job, &Extra { clip_id: Some(clip_id.clone()), export_status: Some("queued".into()), ..Default::default() });
        }
        state.queue.clone().enqueue(&app, t, request.concurrency);
    }
    Ok(ids)
}

fn setting(state: &AppState, key: &str) -> Option<String> {
    settings::load(&state.paths.settings_file).ok()?[key].as_str().map(String::from).filter(|s| !s.trim().is_empty())
}

fn ytdlp_tool(state: &AppState) -> Option<YtDlp> {
    ytdlp::locate(setting(state, "ytdlpPath").as_deref())
}

#[tauri::command]
pub async fn ytdlp_status(state: State<'_, AppState>) -> AppResult<ToolStatus> {
    Ok(ytdlp::status(setting(&state, "ytdlpPath").as_deref()))
}

#[tauri::command]
pub fn list_connectors() -> Vec<ConnectorInfo> {
    connectors::infos()
}

/// Look a link up without downloading it: title, length, uploader, whether it can be imported.
#[tauri::command]
pub async fn probe_url(state: State<'_, AppState>, url: String) -> AppResult<UrlInfo> {
    let tool = ytdlp_tool(&state);
    let cookies = setting(&state, "cookiesBrowser");
    tauri::async_runtime::spawn_blocking(move || ytdlp::probe_url(tool.as_ref(), &url, cookies.as_deref()))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub project_id: String,
    pub url: String,
    /// 0 means the best quality offered.
    pub max_height: u32,
    pub concurrency: usize,
    /// The user ticked the box saying they may use this video.
    pub confirmed_rights: bool,
}

/// Queue a download for an existing project. When it finishes the project gets its source file.
#[tauri::command]
pub fn start_download(app: AppHandle, state: State<'_, AppState>, request: DownloadRequest) -> AppResult<String> {
    if !request.confirmed_rights {
        return invalid("Confirm that you have the right to use this video before downloading it.");
    }
    if ![0, 360, 480, 720, 1080, 1440, 2160].contains(&request.max_height) {
        return invalid("Choose a quality from the list.");
    }
    let (conn, url, kind) = connectors::detect(&request.url)?;
    if kind == UrlKind::Live {
        return invalid(ytdlp::LIVE_MESSAGE);
    }
    let yt = ytdlp_tool(&state).ok_or_else(|| AppError::Invalid(ytdlp::NO_YTDLP.into()))?;
    let tools = tools(&state)?;
    let ffmpeg_dir = tools.ffmpeg.parent().map(Path::to_path_buf).unwrap_or_default();
    let cookies = ytdlp::cookie_args(setting(&state, "cookiesBrowser").as_deref())?;

    let project = {
        let db = state.db()?;
        let p = repo::get_project(&db, &request.project_id)?;
        if p.source_path.is_some() {
            return invalid("This project already has a video.");
        }
        p
    };
    let id = uuid::Uuid::new_v4().to_string();
    let args = ytdlp::download_args(url.as_str(), &state.paths.downloads, &id, request.max_height, &ffmpeg_dir, &conn.extra_args(), &cookies);
    let job = Job {
        id: id.clone(),
        title: format!("Download: {}", project.title),
        kind: "download".into(),
        status: "queued".into(),
        progress: 0.0,
        source: conn.info().name.to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        duration_sec: 0,
        error: None,
        simulated: false,
    };
    repo::save_job(&*state.db()?, &job)?;
    // The link itself is not logged: it can carry private tokens. Only the platform and host are.
    tracing::info!(connector = conn.info().id, host = url.host_str().unwrap_or(""), "download queued");
    queue::announce(&app, &job, &Extra { project_id: Some(project.id.clone()), project_status: Some("processing".into()), ..Default::default() });
    let task = Task { job, work: Work::Download { project_id: project.id, ytdlp: yt.path, args, dir: state.paths.downloads.clone(), stem: id.clone(), tools } };
    state.queue.clone().enqueue(&app, task, request.concurrency);
    Ok(id)
}

/// Loudness shape of part of a video, for the timeline. Values 0..1.
#[tauri::command]
pub async fn audio_peaks(state: State<'_, AppState>, path: String, start: f64, end: f64, buckets: u32) -> AppResult<Vec<f32>> {
    if !(end > start && start >= 0.0 && end - start <= 3600.0) || !(10..=2000).contains(&buckets) {
        return invalid("Bad waveform range.");
    }
    let tools = tools(&state)?;
    let file = PathBuf::from(path);
    if !file.is_file() {
        return Err(AppError::NotFound("video file".into()));
    }
    tauri::async_runtime::spawn_blocking(move || waveform::peaks(&tools.ffmpeg, &file, start, end, buckets as usize))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub fn cancel_job(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<bool> {
    Ok(state.queue.clone().cancel(&app, &id))
}

/// Open Explorer with the file selected. Only an existing file or folder is accepted.
#[tauri::command]
pub fn reveal_path(path: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::NotFound(format!("{path}. It may have been moved or deleted")));
    }
    #[cfg(windows)]
    {
        let arg = if p.is_file() { format!("/select,{}", p.display()) } else { p.display().to_string() };
        std::process::Command::new("explorer.exe").arg(arg).spawn()?;
    }
    #[cfg(not(windows))]
    {
        let _ = p;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_names_are_safe_and_stable() {
        assert_eq!(output_name("Final boss: one hit!", "9:16", "c_abc12345678"), "Final-boss-one-hit-9x16-12345678.mp4");
        assert_eq!(output_name("???", "1:1", "x"), "clip-1x1-x.mp4");
        assert!(!output_name("a/b\\c:d*e", "4:5", "id1").contains(['/', '\\', ':', '*']));
        assert!(output_name(&"x".repeat(200), "16:9", "id").len() < 70);
    }
}
