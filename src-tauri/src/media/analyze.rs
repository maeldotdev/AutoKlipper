//! The local analysis job: audio, transcription, speakers, highlight scoring, optional Ollama, clips.
use std::path::{Path, PathBuf};

use super::ffmpeg::Tools;
use super::process::{self, Outcome, Running};
use crate::ai::{audio, highlights, ollama, transcript};
use crate::db::models::Clip;

pub struct Analyze {
    pub project_id: String,
    pub source: PathBuf,
    pub tools: Tools,
    pub python: PathBuf,
    pub script: PathBuf,
    pub model_dir: PathBuf,
    pub model_name: String,
    pub language: String,
    pub speaker_dir: Option<PathBuf>,
    pub options: highlights::Options,
    pub aspect: String,
    pub target: String,
    pub captions: bool,
    pub hue: i64,
    pub ollama_model: Option<String>,
    pub temp: PathBuf,
}

pub struct Analysis {
    pub segments: Vec<transcript::Segment>,
    pub language: String,
    pub duration: f64,
    pub clips: Vec<Clip>,
    pub warnings: Vec<String>,
}

/// The helper ends a failure with `CLIPIT_ERROR: ...` on stderr.
pub fn helper_error(stderr: &str) -> String {
    let line = stderr.lines().rev().find_map(|l| l.split_once("CLIPIT_ERROR:").map(|(_, m)| m.trim().to_string()));
    let line = line.unwrap_or_else(|| stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("no details").trim().to_string());
    let low = line.to_lowercase();
    if low.contains("no module named") {
        "The local AI environment is incomplete. Run \"Set up local AI\" again in Settings, AI.".into()
    } else if low.contains("memoryerror") || low.contains("out of memory") || low.contains("bad_alloc") {
        "Not enough memory for this model. Choose a smaller model in Settings, AI.".into()
    } else if low.contains("urlopen") || low.contains("connection") || low.contains("getaddrinfo") {
        "Could not reach the download server. Check your internet connection and try again.".into()
    } else if low.contains("no space left") {
        "There is not enough free disk space.".into()
    } else {
        format!("Local AI failed: {}", line.chars().take(300).collect::<String>())
    }
}

pub fn parse_progress(line: &str) -> Option<f64> {
    line.trim().strip_prefix("CLIPIT_PROGRESS ")?.trim().parse::<f64>().ok().filter(|p| p.is_finite()).map(|p| p.clamp(0.0, 100.0))
}

fn done(outcome: Outcome, explain: impl Fn(&str) -> String) -> Result<(), String> {
    match outcome {
        Outcome::Done => Ok(()),
        Outcome::Cancelled => Err("Cancelled".into()),
        Outcome::Failed(e) => Err(explain(&e)),
    }
}

fn s(p: &Path) -> String {
    p.display().to_string()
}

/// `stem` names the temporary files, which the caller removes afterwards.
pub fn run(a: &Analyze, stem: &str, running: &Running, mut progress: impl FnMut(f64)) -> Result<Analysis, String> {
    let wav = a.temp.join(format!("{stem}.wav"));
    let json = a.temp.join(format!("{stem}.json"));

    progress(2.0);
    let args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"]
        .iter()
        .map(|x| x.to_string())
        .chain([s(&a.source), "-vn".into(), "-ac".into(), "1".into(), "-ar".into(), "16000".into(), "-c:a".into(), "pcm_s16le".into(), s(&wav)])
        .collect();
    done(process::run_lines(&a.tools.ffmpeg, &args, running, |_| {})?, |e| {
        if e.contains("does not contain any stream") || e.contains("Output file does not contain") {
            "This video has no sound, so there is nothing to transcribe.".into()
        } else {
            format!("Could not read the audio: {}", e.lines().last().unwrap_or(""))
        }
    })?;
    progress(8.0);

    let mut args = vec![
        s(&a.script), "transcribe".into(), "--audio".into(), s(&wav), "--model-dir".into(), s(&a.model_dir),
        "--language".into(), a.language.clone(), "--out".into(), s(&json),
    ];
    if let Some(d) = &a.speaker_dir {
        args.extend(["--speaker-dir".into(), s(d)]);
    }
    done(process::run_lines(&a.python, &args, running, |line| {
        if let Some(p) = parse_progress(line) {
            progress(8.0 + p * 0.82);
        }
    })?, helper_error)?;

    let raw = std::fs::read_to_string(&json).map_err(|e| format!("The transcript file is missing: {e}"))?;
    let doc: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("The transcript file is damaged: {e}"))?;
    let mut segments = transcript::from_helper(&doc).map_err(|e| e.to_string())?;
    if segments.is_empty() {
        return Err("No speech was found in this video.".into());
    }
    highlights::mark_keywords(&mut segments);
    let duration = doc["duration"].as_f64().unwrap_or(segments.last().map_or(0.0, |x| x.end));
    let mut warnings: Vec<String> = doc["warning"].as_str().map(String::from).into_iter().collect();

    progress(91.0);
    let loud = audio::loudness(&wav).map_err(|e| e.to_string())?;
    let mut found = highlights::find(&segments, &loud, duration, &a.options);
    if let Some(model) = &a.ollama_model {
        let total = found.len().max(1) as f64;
        for (i, h) in found.iter_mut().enumerate() {
            if running.cancel.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("Cancelled".into());
            }
            let text = transcript::slice(&segments, h.start, h.end).iter().map(|x| x.text()).collect::<Vec<_>>().join(" ");
            match ollama::rate(ollama::DEFAULT_BASE, model, &text) {
                Ok(o) => {
                    h.score = ((h.score + o.score) as f64 / 2.0).round() as u32;
                    if let Some(t) = o.title {
                        h.title = t;
                    }
                    h.reason = format!("{}, rated by {model}", h.reason);
                }
                Err(e) => {
                    warnings.push(format!("Ollama was skipped: {e}"));
                    break;
                }
            }
            progress(91.0 + (i + 1) as f64 / total * 7.0);
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let clips = found
        .into_iter()
        .enumerate()
        .map(|(i, h)| Clip {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: a.project_id.clone(),
            title: h.title,
            start_sec: h.start,
            end_sec: h.end.min(duration.max(h.end.min(duration))),
            aspect: a.aspect.clone(),
            target: a.target.clone(),
            captions: if a.captions { "generated" } else { "none" }.into(),
            export_status: "not-exported".into(),
            score: h.score as i64,
            hue: (a.hue + i as i64 * 17) % 360,
            created_at: now.clone(),
            export_path: None,
            reason: Some(h.reason), crop_x: 50.0, zoom: 1.0, track: None,
        })
        .collect();
    progress(99.0);
    Ok(Analysis { segments, language: doc["language"].as_str().unwrap_or("").to_string(), duration, clips, warnings })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_errors_become_plain_advice() {
        assert!(helper_error("x\nCLIPIT_ERROR: ModuleNotFoundError: No module named 'faster_whisper'").contains("Set up local AI"));
        assert!(helper_error("CLIPIT_ERROR: MemoryError: ").contains("smaller model"));
        assert!(helper_error("CLIPIT_ERROR: URLError: <urlopen error [Errno 11001]>").contains("internet"));
        assert_eq!(helper_error("CLIPIT_ERROR: ValueError: odd"), "Local AI failed: ValueError: odd");
        assert_eq!(helper_error("traceback\nlast line"), "Local AI failed: last line");
    }

    #[test]
    fn progress_lines_parse() {
        assert_eq!(parse_progress("CLIPIT_PROGRESS 42.5"), Some(42.5));
        assert_eq!(parse_progress("CLIPIT_PROGRESS 400"), Some(100.0));
        assert_eq!(parse_progress("hello"), None);
    }

    /// Real FFmpeg, faster-whisper and (when present) speaker models. Needs:
    /// CLIPIT_AI_PYTHON (venv with faster-whisper), CLIPIT_TEST_MODELS (folder with whisper-tiny/ and speaker/),
    /// CLIPIT_TEST_SPEECH (a video with two people speaking, containing "incredible" and "secret").
    #[test]
    fn real_analysis_of_a_speech_video() {
        use crate::ai::env;
        use crate::media::ffmpeg;
        let (Some(py), Some(models), Some(speech)) = (
            std::env::var_os("CLIPIT_AI_PYTHON").map(PathBuf::from),
            std::env::var_os("CLIPIT_TEST_MODELS").map(PathBuf::from),
            std::env::var_os("CLIPIT_TEST_SPEECH").map(PathBuf::from),
        ) else {
            eprintln!("SKIPPED: set CLIPIT_AI_PYTHON, CLIPIT_TEST_MODELS and CLIPIT_TEST_SPEECH to run");
            return;
        };
        let tools = ffmpeg::locate(None).expect("FFmpeg");
        let dir = std::env::temp_dir().join(format!("clipit-analyze-{}", uuid::Uuid::new_v4()));
        env::write_script(&dir).unwrap();
        let a = Analyze {
            project_id: "p".into(),
            source: speech,
            tools,
            python: py,
            script: env::script_path(&dir),
            model_dir: env::model_dir(&models, "tiny"),
            model_name: "tiny".into(),
            language: "auto".into(),
            speaker_dir: env::has_speaker_models(&models).then(|| env::speaker_dir(&models)),
            options: highlights::Options { min_len: 8.0, max_len: 20.0, count: 3, moments: vec![], sensitivity: 80 },
            aspect: "9:16".into(),
            target: "tiktok".into(),
            captions: true,
            hue: 0,
            ollama_model: None,
            temp: dir.clone(),
        };
        let mut last = 0.0;
        let r = run(&a, "t", &Running::default(), |p| last = p).expect("analysis");
        let text = r.segments.iter().map(|x| x.text()).collect::<Vec<_>>().join(" ").to_lowercase();
        eprintln!("transcript: {text}");
        for c in &r.clips {
            eprintln!("clip {:.1}-{:.1} score {} {:?} '{}'", c.start_sec, c.end_sec, c.score, c.reason, c.title);
        }
        assert!(text.contains("incredible") && text.contains("secret"), "{text}");
        assert_eq!(r.language, "en");
        assert!(r.segments.iter().all(|s| s.words.iter().all(|w| w.end >= w.start)));
        assert!(!r.clips.is_empty() && r.clips.len() <= 3);
        assert!(r.clips.iter().all(|c| c.end_sec > c.start_sec && c.end_sec <= r.duration + 0.5 && c.validate().is_ok()));
        assert!(last >= 90.0);
        if a.speaker_dir.is_some() {
            let who: std::collections::HashSet<_> = r.segments.iter().filter_map(|s| s.speaker).collect();
            assert!(who.len() >= 2, "two voices should give two speakers: {who:?} {:?}", r.warnings);
        }
    }
}
