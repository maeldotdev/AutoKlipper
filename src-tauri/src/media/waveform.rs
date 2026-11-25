use std::path::Path;
use std::process::Stdio;

use super::ffmpeg;
use crate::error::{invalid, AppResult};

/// Peak per bucket of 16-bit samples, scaled so the loudest bucket is 1.
pub fn bucket(samples: &[i16], buckets: usize) -> Vec<f32> {
    if samples.is_empty() || buckets == 0 {
        return vec![0.0; buckets];
    }
    let peaks: Vec<f32> = (0..buckets)
        .map(|i| {
            let a = i * samples.len() / buckets;
            let b = ((i + 1) * samples.len() / buckets).max(a + 1).min(samples.len());
            samples[a.min(b - 1)..b].iter().map(|s| (*s as i32).unsigned_abs()).max().unwrap_or(0) as f32
        })
        .collect();
    let top = peaks.iter().copied().fold(0.0, f32::max);
    if top <= 0.0 {
        return peaks;
    }
    peaks.into_iter().map(|p| p / top).collect()
}

/// The real waveform of `[start, end]`. A video without sound gives a flat line.
pub fn peaks(ffmpeg_exe: &Path, file: &Path, start: f64, end: f64, buckets: usize) -> AppResult<Vec<f32>> {
    let out = ffmpeg::command(ffmpeg_exe)
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-ss"])
        .arg(format!("{start:.3}"))
        .arg("-i")
        .arg(file)
        .arg("-t")
        .arg(format!("{:.3}", end - start))
        .args(["-vn", "-ac", "1", "-ar", "4000", "-f", "s16le", "-"])
        .stdin(Stdio::null())
        .output()?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        if err.contains("does not contain any stream") {
            return Ok(vec![0.0; buckets]);
        }
        return invalid(format!("Could not read the audio: {}", err.lines().last().unwrap_or("")));
    }
    let samples: Vec<i16> = out.stdout.as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b)).collect();
    Ok(bucket(&samples, buckets))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buckets_follow_the_loudness() {
        let mut s = vec![100i16; 100];
        s.extend(vec![-8000i16; 100]);
        let p = bucket(&s, 4);
        assert_eq!(p.len(), 4);
        assert!(p[0] < 0.05 && p[3] == 1.0);
        assert_eq!(bucket(&[], 3), vec![0.0; 3]);
        assert_eq!(bucket(&[5], 3).len(), 3);
    }

    #[test]
    fn real_waveform_shows_silence_then_tone() {
        let Some(t) = ffmpeg::locate(None) else { return };
        let dir = std::env::temp_dir().join(format!("clipit-wave-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.mp4");
        assert!(ffmpeg::command(&t.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "aevalsrc='if(lt(t,2),0,0.8*sin(2*PI*300*t))':d=4"])
            .args(["-c:a", "aac"])
            .arg(&f)
            .status()
            .unwrap()
            .success());
        let p = peaks(&t.ffmpeg, &f, 0.0, 4.0, 40).unwrap();
        assert!(p[..18].iter().all(|v| *v < 0.1), "{p:?}");
        assert!(p[22..].iter().all(|v| *v > 0.7), "{p:?}");
    }
}
