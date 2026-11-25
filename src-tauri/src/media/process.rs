use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use super::ffmpeg;

/// Shared between the worker thread and whoever cancels the job.
#[derive(Default)]
pub struct Running {
    pub cancel: AtomicBool,
    pub child: Mutex<Option<Child>>,
}

impl Running {
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        if let Ok(mut g) = self.child.lock() {
            if let Some(c) = g.as_mut() {
                let _ = c.kill();
            }
        }
    }
}

pub enum Outcome {
    Done,
    Cancelled,
    /// Process ended with an error. Carries everything it wrote to stderr.
    Failed(String),
}

/// Run a program, feeding every stdout line to `on_line`. Used for FFmpeg and yt-dlp.
/// `Err` only means the program could not be started at all.
pub fn run_lines(exe: &Path, args: &[String], running: &Running, on_line: impl FnMut(&str)) -> Result<Outcome, String> {
    run_lines_in(None, exe, args, running, on_line)
}

/// Same, with a working folder (used for caption files that the filter refers to by name).
pub fn run_lines_in(cwd: Option<&Path>, exe: &Path, args: &[String], running: &Running, mut on_line: impl FnMut(&str)) -> Result<Outcome, String> {
    if running.cancel.load(Ordering::SeqCst) {
        return Ok(Outcome::Cancelled);
    }
    let mut cmd = ffmpeg::command(exe);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let mut child = cmd
        .args(args)
        .env("PYTHONIOENCODING", "utf-8")
        .env("HF_HUB_DISABLE_TELEMETRY", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", exe.file_name().and_then(|n| n.to_str()).unwrap_or("the program")))?;
    super::job::bind_to_app(&child);
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    *running.child.lock().map_err(|_| "internal lock error".to_string())? = Some(child);

    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut e) = stderr {
            let _ = e.read_to_string(&mut s);
        }
        s
    });
    if let Some(out) = stdout {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            on_line(&line);
        }
    }
    let status = {
        let mut g = running.child.lock().map_err(|_| "internal lock error".to_string())?;
        g.take().map(|mut c| c.wait())
    };
    let stderr_text = err_thread.join().unwrap_or_default();

    if running.cancel.load(Ordering::SeqCst) {
        return Ok(Outcome::Cancelled);
    }
    Ok(match status {
        Some(Ok(s)) if s.success() => Outcome::Done,
        _ => Outcome::Failed(stderr_text),
    })
}
