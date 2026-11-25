//! Live monitoring engine. FFmpeg records the stream into short segments (the rolling buffer). Each finished
//! segment is transcribed, the recent window is scored, and a good moment is cut from the buffer after the fact.
//! Free of Tauri: the caller receives events and decides what to store.
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::ffmpeg::{self, Tools};
use crate::ai::transcript::{self, Segment};
use crate::ai::{audio, highlights};

pub struct Transcriber {
    pub python: PathBuf,
    pub script: PathBuf,
    pub model_dir: PathBuf,
    pub language: String,
}

pub struct Config {
    /// Folder for this session's buffer. Created here, removed when the session ends.
    pub dir: PathBuf,
    /// Where finished clips are written.
    pub clip_dir: PathBuf,
    pub clip_stem: String,
    pub tools: Tools,
    /// One or two stream addresses.
    pub inputs: Vec<String>,
    /// Extra FFmpeg options before each `-i` (headers, reconnect; `-re` in tests).
    pub input_args: Vec<String>,
    pub transcriber: Option<Transcriber>,
    pub segment_sec: u32,
    pub buffer_sec: u32,
    pub options: highlights::Options,
    pub auto_clip: bool,
}

/// Shared with whoever controls the session.
#[derive(Default, Debug)]
pub struct Control {
    stop: AtomicBool,
    /// Requested "clip the last N seconds".
    manual: Mutex<VecDeque<f64>>,
    children: Mutex<Vec<Arc<Mutex<Child>>>>,
}

impl Control {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Ok(list) = self.children.lock() {
            for c in list.iter() {
                if let Ok(mut c) = c.lock() {
                    let _ = c.kill();
                }
            }
        }
    }
    pub fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
    pub fn clip_last(&self, seconds: f64) {
        if let Ok(mut q) = self.manual.lock() {
            q.push_back(seconds.clamp(5.0, 600.0));
        }
    }
    fn adopt(&self, child: Child) -> Arc<Mutex<Child>> {
        super::job::bind_to_app(&child);
        let c = Arc::new(Mutex::new(child));
        if let Ok(mut list) = self.children.lock() {
            list.push(c.clone());
        }
        c
    }
}

#[derive(Debug)]
pub struct Moment {
    pub n: usize,
    /// Session time where the moment starts.
    pub at: f64,
    pub score: u32,
    pub reason: String,
    pub title: String,
}

#[derive(Debug)]
pub struct Clip {
    pub file: PathBuf,
    pub duration: f64,
    /// The moment inside the file.
    pub start: f64,
    pub end: f64,
    /// Words with times measured from the start of the file.
    pub segments: Vec<Segment>,
    pub language: String,
}

#[derive(Debug)]
pub enum Event {
    Connecting,
    Monitoring,
    Reconnecting(String),
    Tick { uptime: f64, buffered: f64, thumbnail: Option<PathBuf> },
    /// A moment was found and is being cut.
    Found(Moment),
    Ready { n: usize, clip: Clip },
    Failed { n: usize, message: String },
    Warning(String),
    /// Always the last event. `Some` when the session ended because of an error.
    Ended(Option<String>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    pub file: String,
    pub start: f64,
    pub end: f64,
}

/// One line of FFmpeg's segment list: `name,start,end`.
pub fn parse_list_line(line: &str) -> Option<Piece> {
    let mut p = line.trim().rsplitn(3, ',');
    let end = p.next()?.parse().ok()?;
    let start = p.next()?.parse().ok()?;
    let file = p.next()?.trim_matches('"').to_string();
    (!file.is_empty() && end > start).then_some(Piece { file, start, end })
}

/// Pieces that cover `[start, end]`.
pub fn covering(pieces: &[Piece], start: f64, end: f64) -> Vec<Piece> {
    pieces.iter().filter(|p| p.end > start && p.start < end).cloned().collect()
}

/// Moments worth clipping in the recent window that are finished and not already taken.
pub fn new_moments(
    segments: &[Segment],
    loud: &[f32],
    now: f64,
    taken: &[(f64, f64)],
    options: &highlights::Options,
    window: f64,
) -> Vec<highlights::Highlight> {
    let recent: Vec<Segment> = segments.iter().filter(|s| s.end >= now - window).cloned().collect();
    let threshold = 90u32.saturating_sub(options.sensitivity.clamp(10, 100) / 2);
    let o = highlights::Options { count: 3, ..options.clone() };
    highlights::find(&recent, loud, now, &o)
        .into_iter()
        // Wait until the moment is over before cutting it.
        .filter(|h| h.score >= threshold && h.end <= now - 2.0)
        .filter(|h| {
            !taken.iter().any(|(s, e)| {
                let overlap = (h.end.min(*e) - h.start.max(*s)).max(0.0);
                overlap > 0.2 * (h.end - h.start).min(e - s)
            })
        })
        .collect()
}

fn text(p: &Path) -> String {
    p.display().to_string()
}

fn run_quiet(exe: &Path, args: &[String], cwd: &Path) -> Result<(), String> {
    let out = ffmpeg::command(exe).args(args).current_dir(cwd).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("FFmpeg failed").to_string())
    }
}

/// The long-running helper that keeps the Whisper model in memory.
struct Helper {
    stdin: ChildStdin,
    out: BufReader<ChildStdout>,
}

impl Helper {
    fn start(t: &Transcriber, control: &Control) -> Result<Helper, String> {
        let mut child = ffmpeg::command(&t.python)
            .args([text(&t.script), "serve".into(), "--model-dir".into(), text(&t.model_dir), "--language".into(), t.language.clone()])
            .env("PYTHONIOENCODING", "utf-8")
            .env("HF_HUB_DISABLE_TELEMETRY", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Could not start the transcriber: {e}"))?;
        let stdin = child.stdin.take().expect("piped");
        let out = BufReader::new(child.stdout.take().expect("piped"));
        control.adopt(child);
        let mut h = Helper { stdin, out };
        h.expect("CLIPIT_READY")?;
        Ok(h)
    }

    fn expect(&mut self, prefix: &str) -> Result<String, String> {
        let mut line = String::new();
        loop {
            line.clear();
            if self.out.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
                return Err("The transcriber stopped. Check local AI in Settings.".into());
            }
            if let Some(rest) = line.trim().strip_prefix(prefix) {
                return Ok(rest.trim().to_string());
            }
        }
    }

    fn transcribe(&mut self, wav: &Path) -> Result<(Vec<Segment>, String), String> {
        writeln!(self.stdin, "{}", wav.display()).map_err(|e| e.to_string())?;
        let json: serde_json::Value = serde_json::from_str(&self.expect("CLIPIT_RESULT")?).map_err(|e| e.to_string())?;
        if let Some(e) = json["error"].as_str() {
            return Err(e.to_string());
        }
        let segments = transcript::from_helper(&json).map_err(|e| e.to_string())?;
        Ok((segments, json["language"].as_str().unwrap_or("").to_string()))
    }
}

struct Recorder {
    child: Arc<Mutex<Child>>,
    errors: std::thread::JoinHandle<String>,
    /// Pieces from this recorder are numbered with its own clock, offset by this much.
    offset: f64,
    list: PathBuf,
    read_lines: usize,
}

fn start_recorder(cfg: &Config, control: &Control, run: u32, offset: f64) -> Result<Recorder, String> {
    let list = cfg.dir.join(format!("run{run}.csv"));
    let mut a: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"].map(String::from).to_vec();
    for input in &cfg.inputs {
        a.extend(cfg.input_args.iter().cloned());
        a.extend(["-i".into(), input.clone()]);
    }
    if cfg.inputs.len() > 1 {
        a.extend(["-map", "0:v:0?", "-map", "1:a:0?"].map(String::from));
    }
    a.extend(["-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-f", "segment", "-segment_format", "mpegts", "-reset_timestamps", "1", "-segment_list_type", "csv"].map(String::from));
    a.extend(["-segment_time".into(), cfg.segment_sec.to_string(), "-segment_list".into(), format!("run{run}.csv"), format!("run{run}_%06d.ts")]);
    let mut child = ffmpeg::command(&cfg.tools.ffmpeg)
        .args(&a)
        .current_dir(&cfg.dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start FFmpeg: {e}"))?;
    let mut err = child.stderr.take().expect("piped");
    let errors = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });
    Ok(Recorder { child: control.adopt(child), errors, offset, list, read_lines: 0 })
}

impl Recorder {
    /// Segments finished since the last call, on the session clock.
    fn finished(&mut self) -> Vec<Piece> {
        let Ok(content) = std::fs::read_to_string(&self.list) else { return vec![] };
        // The last line may still be being written: only take lines that end in a newline.
        let complete = content.rfind('\n').map_or("", |i| &content[..=i]);
        let new: Vec<Piece> = complete
            .lines()
            .skip(self.read_lines)
            .filter_map(parse_list_line)
            .map(|p| Piece { start: p.start + self.offset, end: p.end + self.offset, ..p })
            .collect();
        self.read_lines = complete.lines().count();
        new
    }
    fn exited(&self) -> bool {
        self.child.lock().map(|mut c| !matches!(c.try_wait(), Ok(None))).unwrap_or(true)
    }
}

/// Cut `[start, end]` out of the buffered pieces into a clip file with padding.
/// `pad` adds context around a detected moment. A clip the user asked for gets exactly what was asked.
fn cut(cfg: &Config, pieces: &[Piece], n: usize, start: f64, end: f64, pad: f64) -> Result<(PathBuf, f64, f64), String> {
    let cover = covering(pieces, start - pad, end + pad);
    let (Some(first), Some(last)) = (cover.first(), cover.last()) else {
        return Err("That moment has already left the buffer.".into());
    };
    let from = (start - pad).max(first.start);
    let to = (end + pad).min(last.end);
    let list = cfg.dir.join(format!("cut{n}.txt"));
    // Segment names are generated by us (run0_000001.ts), so no quoting problems are possible.
    let body: String = cover.iter().map(|p| format!("file '{}'\n", p.file)).collect();
    std::fs::write(&list, body).map_err(|e| e.to_string())?;
    let out = cfg.clip_dir.join(format!("{}-{n}.mp4", cfg.clip_stem));
    let args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i"]
        .iter()
        .map(|s| s.to_string())
        .chain([format!("cut{n}.txt"), "-ss".into(), format!("{:.3}", (from - first.start).max(0.0)), "-t".into(), format!("{:.3}", to - from)])
        .chain(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart"].map(String::from))
        .chain([text(&out)])
        .collect();
    let result = run_quiet(&cfg.tools.ffmpeg, &args, &cfg.dir);
    let _ = std::fs::remove_file(&list);
    result?;
    if std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("The cut produced an empty file.".into());
    }
    Ok((out, from, to - from))
}

struct Session<'a> {
    cfg: &'a Config,
    pieces: Vec<Piece>,
    segments: Vec<Segment>,
    loud: Vec<f32>,
    language: String,
    helper: Option<Helper>,
    taken: Vec<(f64, f64)>,
    made: usize,
}

impl Session<'_> {
    /// Extract audio from a finished piece, measure loudness and transcribe it.
    fn digest(&mut self, piece: &Piece, emit: &mut impl FnMut(Event)) {
        let wav = self.cfg.dir.join("current.wav");
        let args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"]
            .iter()
            .map(|s| s.to_string())
            .chain([piece.file.clone(), "-vn".into(), "-ac".into(), "1".into(), "-ar".into(), "16000".into(), "-c:a".into(), "pcm_s16le".into(), "current.wav".into()])
            .collect();
        if run_quiet(&self.cfg.tools.ffmpeg, &args, &self.cfg.dir).is_err() {
            return; // no audio in this piece
        }
        // Keep the loudness list lined up with the session clock.
        let at = (piece.start / audio::WINDOW_SEC) as usize;
        self.loud.resize(at, -60.0);
        self.loud.extend(audio::loudness(&wav).unwrap_or_default());
        if let Some(h) = &mut self.helper {
            match h.transcribe(&wav) {
                Ok((mut new, lang)) => {
                    highlights::mark_keywords(&mut new);
                    for mut s in new {
                        // ponytail: a word cut exactly at a segment edge may be split; overlap windows if it shows up.
                        s.id = format!("s{}", self.segments.len() + 1);
                        s.start += piece.start;
                        s.end += piece.start;
                        for w in &mut s.words {
                            w.start += piece.start;
                            w.end += piece.start;
                            w.id = format!("{}{}", s.id, w.id);
                        }
                        self.segments.push(s);
                    }
                    if !lang.is_empty() {
                        self.language = lang;
                    }
                }
                Err(e) => {
                    emit(Event::Warning(format!("Transcription stopped: {e}")));
                    self.helper = None;
                }
            }
        }
        let _ = std::fs::remove_file(&wav);
    }

    fn make_clip(&mut self, start: f64, end: f64, score: u32, reason: String, title: String, emit: &mut impl FnMut(Event)) {
        self.made += 1;
        let n = self.made;
        self.taken.push((start, end));
        emit(Event::Found(Moment { n, at: start, score, reason, title }));
        // Score 0 marks a clip the user asked for.
        match cut(self.cfg, &self.pieces, n, start, end, if score == 0 { 0.0 } else { 1.0 }) {
            Ok((file, file_start, duration)) => {
                let segments = transcript::slice(&self.segments, file_start, file_start + duration);
                let clip = Clip { file, duration, start: (start - file_start).max(0.0), end: (end - file_start).min(duration), segments, language: self.language.clone() };
                emit(Event::Ready { n, clip });
            }
            Err(message) => emit(Event::Failed { n, message }),
        }
    }

    fn thumbnail(&self, piece: &Piece) -> Option<PathBuf> {
        let out = self.cfg.dir.join("preview.jpg");
        let args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"]
            .iter()
            .map(|s| s.to_string())
            .chain([piece.file.clone(), "-frames:v".into(), "1".into(), "-vf".into(), "scale=640:-2".into(), "preview.jpg".into()])
            .collect();
        run_quiet(&self.cfg.tools.ffmpeg, &args, &self.cfg.dir).ok().map(|_| out)
    }

    /// Drop pieces that have fallen out of the rolling buffer.
    fn prune(&mut self) {
        let Some(newest) = self.pieces.last().map(|p| p.end) else { return };
        let horizon = newest - self.cfg.buffer_sec as f64;
        let dir = &self.cfg.dir;
        self.pieces.retain(|p| {
            let keep = p.end > horizon;
            if !keep {
                let _ = std::fs::remove_file(dir.join(&p.file));
            }
            keep
        });
        self.segments.retain(|s| s.end > horizon);
        self.taken.retain(|t| t.1 > horizon);
    }
}

const MAX_RETRIES: u32 = 4;

/// Runs until stopped or the stream is gone for good. Blocks the calling thread.
pub fn run(cfg: &Config, control: &Control, mut emit: impl FnMut(Event)) {
    let error = drive(cfg, control, &mut emit).err();
    control.stop();
    let _ = std::fs::remove_dir_all(&cfg.dir);
    emit(Event::Ended(error));
}

fn drive(cfg: &Config, control: &Control, emit: &mut impl FnMut(Event)) -> Result<(), String> {
    std::fs::create_dir_all(&cfg.dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&cfg.clip_dir).map_err(|e| e.to_string())?;
    emit(Event::Connecting);
    let mut s = Session { cfg, pieces: vec![], segments: vec![], loud: vec![], language: String::new(), helper: None, taken: vec![], made: 0 };
    if let Some(t) = &cfg.transcriber {
        match Helper::start(t, control) {
            Ok(h) => s.helper = Some(h),
            Err(e) => emit(Event::Warning(format!("{e} Monitoring continues without transcription."))),
        }
    }

    let started = Instant::now();
    let mut run_no = 0;
    let mut failures = 0;
    let mut rec = start_recorder(cfg, control, run_no, 0.0)?;
    let mut monitoring = false;
    let mut thumb = None;
    loop {
        if control.stopped() {
            return Ok(());
        }
        let exited = rec.exited();
        for piece in rec.finished() {
            if !monitoring {
                monitoring = true;
                emit(Event::Monitoring);
            }
            failures = 0;
            s.pieces.push(piece.clone());
            thumb = s.thumbnail(&piece).or(thumb);
            s.digest(&piece, emit);
            if cfg.auto_clip && s.helper.is_some() {
                let window = (cfg.options.max_len * 2.0).max(90.0);
                for h in new_moments(&s.segments, &s.loud, piece.end, &s.taken, &cfg.options, window) {
                    if control.stopped() {
                        return Ok(());
                    }
                    s.make_clip(h.start, h.end, h.score, h.reason, h.title, emit);
                }
            }
            s.prune();
        }

        let newest = s.pieces.last().map_or(0.0, |p| p.end);
        let wanted = control.manual.lock().ok().and_then(|mut q| q.pop_front());
        if let Some(seconds) = wanted {
            if newest > 0.0 {
                let from = (newest - seconds).max(s.pieces.first().map_or(0.0, |p| p.start));
                s.make_clip(from, newest, 0, "Clipped by you".into(), "Manual clip".into(), emit);
            } else {
                emit(Event::Warning("Nothing is buffered yet. Try again in a few seconds.".into()));
            }
        }

        let oldest = s.pieces.first().map_or(newest, |p| p.start);
        emit(Event::Tick { uptime: started.elapsed().as_secs_f64(), buffered: newest - oldest, thumbnail: thumb.clone() });

        if exited && !control.stopped() {
            let stderr = rec.errors.join().unwrap_or_default();
            let last = stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("the stream ended").to_string();
            failures += 1;
            if failures > MAX_RETRIES {
                return if monitoring { Err(format!("The stream stopped: {last}")) } else { Err(format!("Could not open the stream: {last}")) };
            }
            emit(Event::Reconnecting(format!("Attempt {failures} of {MAX_RETRIES}. {last}")));
            std::thread::sleep(Duration::from_secs(2 * failures as u64));
            run_no += 1;
            let offset = s.pieces.last().map_or(0.0, |p| p.end);
            rec = start_recorder(cfg, control, run_no, offset)?;
        }
        std::thread::sleep(Duration::from_millis(700));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::transcript::tests::make;

    #[test]
    fn segment_list_lines_parse() {
        assert_eq!(parse_list_line("run0_000001.ts,10.000000,20.033000"), Some(Piece { file: "run0_000001.ts".into(), start: 10.0, end: 20.033 }));
        assert_eq!(parse_list_line("\"a,b.ts\",0,1").unwrap().file, "a,b.ts");
        assert!(parse_list_line("half,3").is_none());
        assert!(parse_list_line("x.ts,5,5").is_none());
    }

    #[test]
    fn covering_picks_only_overlapping_pieces() {
        let p: Vec<Piece> = (0..5).map(|i| Piece { file: format!("{i}.ts"), start: i as f64 * 10.0, end: (i + 1) as f64 * 10.0 }).collect();
        let names: Vec<_> = covering(&p, 15.0, 31.0).into_iter().map(|x| x.file).collect();
        assert_eq!(names, ["1.ts", "2.ts", "3.ts"]);
        assert!(covering(&p, 80.0, 90.0).is_empty());
    }

    #[test]
    fn a_moment_is_reported_once_and_only_after_it_ends() {
        let segs = make(&[
            (0.0, "the numbers look the same as before and the rows are fine."),
            (8.0, "oh my did you see that? that was the most incredible thing!"),
            (16.0, "no way that is insane i cannot believe it worked!"),
            (24.0, "okay back to the spreadsheet for a while now."),
        ]);
        let loud: Vec<f32> = (0..70).map(|i| if (16..44).contains(&i) { -8.0 } else { -32.0 }).collect();
        let o = highlights::Options { min_len: 6.0, max_len: 14.0, count: 3, moments: vec![], sensitivity: 60 };
        // At t=15 the excited part is still going.
        assert!(new_moments(&segs[..2], &loud[..30], 15.0, &[], &o, 90.0).is_empty());
        let found = new_moments(&segs, &loud, 34.0, &[], &o, 90.0);
        assert_eq!(found.len(), 1, "{found:?}");
        let taken = vec![(found[0].start, found[0].end)];
        assert!(new_moments(&segs, &loud, 34.0, &taken, &o, 90.0).is_empty(), "not reported twice");
    }

    fn control_after(c: Arc<Control>, secs: u64) {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(secs));
            c.stop();
        });
    }

    fn config(dir: &Path, tools: Tools, input: String, transcriber: Option<Transcriber>) -> Config {
        Config {
            dir: dir.join("buffer"),
            clip_dir: dir.join("clips"),
            clip_stem: "live-test".into(),
            tools,
            inputs: vec![input],
            input_args: vec!["-re".into()], // read at playback speed, like a live stream
            transcriber,
            segment_sec: 4,
            buffer_sec: 40,
            options: highlights::Options { min_len: 6.0, max_len: 16.0, count: 3, moments: vec![], sensitivity: 80 },
            auto_clip: true,
        }
    }

    /// Real FFmpeg on a file read at playback speed: segments, rolling buffer, manual retroactive clip, cleanup.
    #[test]
    fn real_session_buffers_clips_and_cleans_up() {
        let Some(tools) = ffmpeg::locate(None) else { return };
        let dir = std::env::temp_dir().join(format!("clipit-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.mp4");
        assert!(ffmpeg::command(&tools.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=300", "-t", "60", "-c:v", "libx264", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac"])
            .arg(&src)
            .status()
            .unwrap()
            .success());
        let cfg = Config { buffer_sec: 12, ..config(&dir, tools.clone(), text(&src), None) };
        let control = Arc::new(Control::default());
        let c2 = control.clone();
        control_after(control.clone(), 26);
        let mut clips = Vec::new();
        let mut buffered = Vec::new();
        let mut saw_monitoring = false;
        let mut asked = false;
        let mut ended = None;
        run(&cfg, &control, |e| match e {
            Event::Monitoring => saw_monitoring = true,
            Event::Tick { uptime, buffered: b, .. } => {
                buffered.push(b);
                if uptime > 18.0 && !asked {
                    asked = true;
                    c2.clip_last(8.0);
                }
            }
            Event::Ready { clip, .. } => clips.push(clip),
            Event::Failed { message, .. } => panic!("{message}"),
            Event::Ended(x) => ended = Some(x),
            _ => {}
        });
        assert!(saw_monitoring);
        assert_eq!(ended, Some(None), "a stop is not an error");
        assert_eq!(clips.len(), 1, "the manual clip");
        let info = super::super::probe::probe(&tools, &clips[0].file).unwrap();
        assert!((info.duration_sec - 8.0).abs() < 0.3, "asked for 8 s, got {}", info.duration_sec);
        let max = buffered.iter().cloned().fold(0.0, f64::max);
        // The oldest piece straddles the horizon and stays, and a piece can run past its target to the next keyframe.
        assert!(max <= 12.0 + 2.0 * 4.0, "rolling buffer stays bounded, saw {max}");
        assert!(!cfg.dir.exists(), "buffer folder removed");
    }

    /// Real transcription of a looping speech video: highlights are found and cut automatically.
    /// Needs the same variables as the analysis test.
    #[test]
    fn real_session_finds_moments_automatically() {
        use crate::ai::env;
        let (Some(py), Some(models), Some(speech)) = (
            std::env::var_os("CLIPIT_AI_PYTHON").map(PathBuf::from),
            std::env::var_os("CLIPIT_TEST_MODELS").map(PathBuf::from),
            std::env::var_os("CLIPIT_TEST_SPEECH").map(PathBuf::from),
        ) else {
            eprintln!("SKIPPED: set CLIPIT_AI_PYTHON, CLIPIT_TEST_MODELS and CLIPIT_TEST_SPEECH to run");
            return;
        };
        let tools = ffmpeg::locate(None).unwrap();
        let dir = std::env::temp_dir().join(format!("clipit-live-{}", uuid::Uuid::new_v4()));
        env::write_script(&dir).unwrap();
        let t = Transcriber { python: py, script: env::script_path(&dir), model_dir: env::model_dir(&models, "tiny"), language: "auto".into() };
        let cfg = Config { segment_sec: 5, buffer_sec: 90, ..config(&dir, tools.clone(), text(&speech), Some(t)) };
        let control = Arc::new(Control::default());
        control_after(control.clone(), 55);
        let mut clips = Vec::new();
        let mut warnings = Vec::new();
        run(&cfg, &control, |e| match e {
            Event::Ready { clip, .. } => clips.push(clip),
            Event::Found(m) => eprintln!("found at {:.1}s score {} {} '{}'", m.at, m.score, m.reason, m.title),
            Event::Warning(w) => warnings.push(w),
            _ => {}
        });
        assert!(warnings.is_empty(), "{warnings:?}");
        assert!(!clips.is_empty(), "at least one automatic clip");
        let words: String = clips.iter().flat_map(|c| c.segments.iter().map(|s| s.text())).collect::<Vec<_>>().join(" ").to_lowercase();
        eprintln!("clip words: {words}");
        assert!(words.contains("incredible") || words.contains("insane"), "{words}");
        for c in &clips {
            assert!(c.file.exists() && c.end > c.start && c.end <= c.duration + 0.1);
            assert!(c.segments.iter().all(|s| s.start >= 0.0 && s.end <= c.duration + 0.5));
        }
    }

    #[test]
    fn an_unreachable_stream_ends_with_an_error() {
        let Some(tools) = ffmpeg::locate(None) else { return };
        let dir = std::env::temp_dir().join(format!("clipit-live-{}", uuid::Uuid::new_v4()));
        let cfg = Config { input_args: vec![], ..config(&dir, tools, "http://127.0.0.1:9/nothing.m3u8".into(), None) };
        let control = Control::default();
        let mut ended = None;
        let mut retries = 0;
        run(&cfg, &control, |e| match e {
            Event::Reconnecting(_) => retries += 1,
            Event::Ended(x) => ended = x,
            _ => {}
        });
        assert_eq!(retries, MAX_RETRIES);
        assert!(ended.unwrap().starts_with("Could not open the stream"));
    }
}
