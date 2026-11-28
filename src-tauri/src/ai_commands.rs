use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, State};

use crate::ai::env::{self, AiStatus};
use crate::ai::transcript::Segment;
use crate::ai::{highlights, ollama, reframe};
use crate::db::models::{Clip, ClipPatch};
use crate::media::{analyze, process};
use crate::db::models::Job;
use crate::db::repo;
use crate::error::{invalid, AppError, AppResult};
use crate::media::analyze::Analyze;
use crate::media::ffmpeg;
use crate::media::queue::{self, Extra, Task, Work};
use crate::settings;
use crate::state::AppState;

fn ai_dir(state: &AppState) -> PathBuf {
    state.paths.root.join("ai")
}

fn models_root(state: &AppState) -> PathBuf {
    settings::load(&state.paths.settings_file)
        .ok()
        .and_then(|v| v["modelFolder"].as_str().map(str::trim).filter(|s| !s.is_empty() && !s.contains('%')).map(PathBuf::from))
        .unwrap_or_else(|| state.paths.models.clone())
}

fn new_job(title: String, kind: &str, source: String) -> Job {
    Job {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        kind: kind.into(),
        status: "queued".into(),
        progress: 0.0,
        source,
        started_at: chrono::Utc::now().to_rfc3339(),
        duration_sec: 0,
        error: None,
        simulated: false,
    }
}

fn submit(app: &AppHandle, state: &AppState, job: Job, work: Work, extra: Extra, concurrency: usize) -> AppResult<String> {
    repo::save_job(&*state.db()?, &job)?;
    queue::announce(app, &job, &extra);
    let id = job.id.clone();
    state.queue.clone().enqueue(app, Task { job, work }, concurrency);
    Ok(id)
}

#[tauri::command]
pub async fn ai_status(state: State<'_, AppState>) -> AppResult<AiStatus> {
    let (dir, models) = (ai_dir(&state), models_root(&state));
    tauri::async_runtime::spawn_blocking(move || env::status(&dir, &models))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Create the virtual environment and install the pinned packages. Started only by the user.
#[tauri::command]
pub fn ai_setup(app: AppHandle, state: State<'_, AppState>) -> AppResult<String> {
    let Some((system, _)) = env::system_python() else {
        return invalid("Python 3.11 to 3.13 is needed first. Install it with: winget install Python.Python.3.12");
    };
    let dir = ai_dir(&state);
    let venv = env::venv_dir(&dir);
    let py = env::venv_python(&venv);
    env::write_script(&dir)?;
    let mut create = vec!["-m".into(), "venv".into(), venv.display().to_string()];
    if env::needs_rebuild(&venv) {
        create.push("--clear".into());
    }
    let steps = vec![
        (system, create),
        (py.clone(), env::install_args(&dir, "pip.txt")),
        (py, env::install_args(&dir, "base.txt")),
    ];
    submit(&app, &state, new_job("Set up local AI".into(), "download", "Python packages from PyPI".into()), Work::Tool { steps, cleanup: None }, Extra::default(), 1)
}

fn helper(state: &AppState) -> AppResult<(PathBuf, PathBuf)> {
    let dir = ai_dir(state);
    let py = env::python(&dir).ok_or_else(|| AppError::Invalid("Set up local AI first (Settings, AI).".into()))?;
    Ok((py, env::script_path(&dir)))
}

#[tauri::command]
pub fn ai_download_model(app: AppHandle, state: State<'_, AppState>, model: String) -> AppResult<String> {
    if !env::MODELS.contains(&model.as_str()) {
        return invalid("Unknown model.");
    }
    let (py, script) = helper(&state)?;
    let out = env::model_dir(&models_root(&state), &model);
    std::fs::create_dir_all(&out)?;
    let args = vec![script.display().to_string(), "download-model".into(), "--model".into(), model.clone(), "--out".into(), out.display().to_string()];
    submit(&app, &state, new_job(format!("Download Whisper model {model}"), "download", "Hugging Face".into()), Work::Tool { steps: vec![(py, args)], cleanup: Some(out) }, Extra::default(), 2)
}

#[tauri::command]
pub fn ai_download_speakers(app: AppHandle, state: State<'_, AppState>) -> AppResult<String> {
    let (py, script) = helper(&state)?;
    let out = env::speaker_dir(&models_root(&state));
    std::fs::create_dir_all(&out)?;
    let args = vec![script.display().to_string(), "download-speaker".into(), "--out".into(), out.display().to_string()];
    submit(&app, &state, new_job("Download speaker models".into(), "download", "GitHub, sherpa-onnx releases".into()), Work::Tool { steps: vec![(py, args)], cleanup: Some(out) }, Extra::default(), 2)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub project_id: String,
    pub options: highlights::Options,
    pub aspect: String,
    pub target: String,
    pub captions: bool,
    pub model: String,
    pub language: String,
    pub speakers: bool,
    pub ollama_model: Option<String>,
    pub concurrency: usize,
    /// Add clips to a project that already has some, without repeating their moments.
    #[serde(default)]
    pub more: bool,
}

/// Transcribe a project's video, pick highlights and create the clips.
#[tauri::command]
pub fn analyze_project(app: AppHandle, state: State<'_, AppState>, request: AnalyzeRequest) -> AppResult<String> {
    if !env::MODELS.contains(&request.model.as_str()) {
        return invalid("Unknown model.");
    }
    let lang = request.language.as_str();
    if !(lang == "auto" || (lang.len() <= 3 && lang.chars().all(|c| c.is_ascii_lowercase()))) {
        return invalid("Unknown language code.");
    }
    if request.options.count == 0 || request.options.count > 50 || request.options.min_len < 1.0 || request.options.max_len < request.options.min_len {
        return invalid("Check the clip count and length range.");
    }
    let (python, script) = helper(&state)?;
    let models = models_root(&state);
    let model_dir = env::model_dir(&models, &request.model);
    let project = repo::get_project(&*state.db()?, &request.project_id)?;
    if project.status == "processing" {
        return invalid("This project is still being worked on.");
    }
    let (mut taken, mut saved) = (Vec::new(), None);
    if request.more {
        let db = state.db()?;
        taken = repo::list_clips(&db)?.into_iter().filter(|c| c.project_id == project.id).map(|c| (c.start_sec, c.end_sec)).collect();
        saved = repo::get_transcript(&db, &project.id)?.filter(|t| !t.2.is_empty()).map(|(language, _, segments)| (language, segments, project.duration));
    }
    if saved.is_none() && !model_dir.join("model.bin").is_file() {
        return invalid(format!("The {} model is not downloaded yet. Download it in Settings, AI.", request.model));
    }
    let tools = ffmpeg::locate(settings::load(&state.paths.settings_file)?["ffmpegPath"].as_str())
        .ok_or_else(|| AppError::Invalid("FFmpeg was not found. Install it or choose it in Settings, Processing.".into()))?;
    let Some(source) = project.source_path.clone().map(PathBuf::from).filter(|p| p.is_file()) else {
        return invalid("This project has no video file on this PC.");
    };
    // Check the clip settings once, before hours of work.
    crate::db::models::Clip {
        id: "check".into(), project_id: project.id.clone(), title: "check".into(), start_sec: 0.0, end_sec: 1.0,
        aspect: request.aspect.clone(), target: request.target.clone(), captions: "none".into(), export_status: "not-exported".into(),
        score: 0, hue: 0, created_at: String::new(), export_path: None, reason: None, crop_x: 50.0, zoom: 1.0, track: None, split: None, hook: None, cuts: None, layout: None, filters: None, post: None, sfx: None,
    }
    .validate()?;

    let speaker_dir = (request.speakers && env::has_speaker_models(&models)).then(|| env::speaker_dir(&models));
    let work = Analyze {
        project_id: project.id.clone(),
        source,
        tools,
        python,
        script,
        model_dir,
        model_name: request.model.clone(),
        language: request.language.clone(),
        speaker_dir,
        hue: project.hue + taken.len() as i64 * 17,
        options: highlights::Options { taken, ..request.options },
        keep: request.more,
        transcript: saved,
        aspect: request.aspect,
        target: request.target,
        captions: request.captions,
        ollama_model: request.ollama_model.filter(|m| !m.trim().is_empty()),
        temp: state.paths.temp.clone(),
    };
    repo::set_project_status(&*state.db()?, &project.id, "processing")?;
    let what = if request.more { "Find more clips" } else { "Transcribe and find highlights" };
    let job = new_job(format!("{what}: {}", project.title), "transcribe", project.title);
    let extra = Extra { project_id: Some(project.id), project_status: Some("processing".into()), ..Default::default() };
    submit(&app, &state, job, Work::Analyze(Box::new(work)), extra, request.concurrency)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptDoc {
    pub language: String,
    pub model: String,
    pub segments: Vec<Segment>,
}

#[tauri::command]
pub fn get_transcript(state: State<'_, AppState>, project_id: String) -> AppResult<Option<TranscriptDoc>> {
    Ok(repo::get_transcript(&*state.db()?, &project_id)?.map(|(language, model, segments)| TranscriptDoc { language, model, segments }))
}

/// Save the user's corrections to a project's transcript.
#[tauri::command]
pub fn save_transcript(state: State<'_, AppState>, project_id: String, segments: Vec<Segment>) -> AppResult<()> {
    if segments.iter().flat_map(|s| &s.words).any(|w| !w.start.is_finite() || !w.end.is_finite() || w.text.chars().count() > 200) {
        return invalid("The transcript has a word with a bad time or is too long.");
    }
    let db = state.db()?;
    let (language, model, _) = repo::get_transcript(&db, &project_id)?.ok_or_else(|| AppError::NotFound("transcript".into()))?;
    repo::save_transcript(&db, &project_id, &language, &model, &segments)
}

#[tauri::command]
pub async fn ollama_models() -> AppResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(|| ollama::models(ollama::DEFAULT_BASE))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/* ---------------- face tracking ---------------- */

/// Install OpenCV into the AI environment and fetch the face model. Started only by the user.
#[tauri::command]
pub fn ai_setup_face(app: AppHandle, state: State<'_, AppState>) -> AppResult<String> {
    let (py, script) = helper(&state)?;
    let out = models_root(&state).join("face");
    std::fs::create_dir_all(&out)?;
    let dir = ai_dir(&state);
    env::write_script(&dir)?;
    let fetch = vec![script.display().to_string(), "download-face".into(), "--out".into(), out.display().to_string()];
    let steps = vec![(py.clone(), env::install_args(&dir, "pip.txt")), (py.clone(), env::install_args(&dir, "face.txt")), (py, fetch)];
    let work = Work::Tool { steps, cleanup: None };
    submit(&app, &state, new_job("Set up face tracking".into(), "download", "OpenCV from PyPI and GitHub".into()), work, Extra::default(), 2)
}

/// One look at the picture: when, and the main face as [centre x, centre y, width, height], all 0..1.
type Sample = (f64, Option<[f64; 4]>);

/// Find the main face a few times a second through one clip.
async fn face_samples(state: &AppState, clip_id: &str) -> AppResult<(Clip, Vec<Sample>)> {
    let (py, script) = helper(state)?;
    let model = env::face_model(&models_root(state));
    if !model.is_file() {
        return invalid("Set up face tracking first (Settings, AI).");
    }
    let (clip, source) = {
        let db = state.db()?;
        let clip = repo::get_clip_pub(&db, clip_id)?;
        let source = repo::get_project(&db, &clip.project_id)?.source_path.map(PathBuf::from).filter(|p| p.is_file());
        let source = source.ok_or_else(|| AppError::Invalid("This clip has no video file on this PC.".into()))?;
        (clip, source)
    };
    if clip.end_sec - clip.start_sec > 600.0 {
        return invalid("Face tracking works on clips up to 10 minutes.");
    }
    let out = state.paths.temp.join(format!("track-{}.json", uuid::Uuid::new_v4().simple()));
    let args: Vec<String> = vec![
        script.display().to_string(), "track".into(), "--video".into(), source.display().to_string(), "--model".into(), model.display().to_string(),
        "--start".into(), format!("{:.3}", clip.start_sec), "--end".into(), format!("{:.3}", clip.end_sec), "--out".into(), out.display().to_string(),
    ];
    let result_file = out.clone();
    let samples = tauri::async_runtime::spawn_blocking(move || -> AppResult<Vec<Sample>> {
        let running = process::Running::default();
        match process::run_lines(&py, &args, &running, |_| {}).map_err(AppError::Invalid)? {
            process::Outcome::Done => {}
            process::Outcome::Cancelled => return invalid("Cancelled"),
            process::Outcome::Failed(e) => return Err(AppError::Invalid(analyze::helper_error(&e))),
        }
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&result_file)?)?;
        let face = |s: &serde_json::Value| Some([s["cx"].as_f64()?, s["cy"].as_f64()?, s["w"].as_f64()?, s["h"].as_f64()?]);
        Ok(v["samples"].as_array().map(|a| a.iter().filter_map(|s| Some((s["t"].as_f64()?, face(s)))).collect()).unwrap_or_default())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let _ = std::fs::remove_file(&out);
    Ok((clip, samples?))
}

/// Follow the face through one clip and save the camera path on it. Returns the path.
#[tauri::command]
pub async fn track_faces(state: State<'_, AppState>, clip_id: String) -> AppResult<Vec<[f64; 2]>> {
    let (clip, samples) = face_samples(&state, &clip_id).await?;
    let xs: Vec<(f64, Option<f64>)> = samples.iter().map(|(t, f)| (*t, f.map(|f| f[0]))).collect();
    let path = reframe::smooth(&xs);
    if path.is_empty() {
        return invalid("No face was found in this clip, so the framing was left as it is.");
    }
    repo::update_clip(&*state.db()?, &clip.id, ClipPatch { track: Some(path.clone()), ..Default::default() })?;
    tracing::info!(clip = %clip.id, points = path.len(), "face path saved");
    Ok(path)
}

/// A first guess at the camera overlay [x, y, width, height], from where the face usually is.
/// Nothing is saved: the user checks it and can drag it.
#[tauri::command]
pub async fn guess_camera(state: State<'_, AppState>, clip_id: String) -> AppResult<[f64; 4]> {
    let (_, samples) = face_samples(&state, &clip_id).await?;
    let faces: Vec<[f64; 4]> = samples.iter().filter_map(|s| s.1).collect();
    match reframe::camera_box(&faces) {
        Some(b) => Ok(b),
        None => invalid("No face was found, so draw the camera box yourself."),
    }
}
