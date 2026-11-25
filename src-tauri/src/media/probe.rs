use serde::Serialize;
use serde_json::Value;
use std::path::Path;

use super::ffmpeg::{self, Tools};
use crate::error::{invalid, AppError, AppResult};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub duration_sec: f64,
    pub size_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub video_codec: String,
    pub audio_codec: Option<String>,
    pub has_audio: bool,
    pub container: String,
}

fn parse_rate(s: &str) -> f64 {
    match s.split_once('/') {
        Some((n, d)) => {
            let (n, d): (f64, f64) = (n.parse().unwrap_or(0.0), d.parse().unwrap_or(0.0));
            if d > 0.0 { n / d } else { 0.0 }
        }
        None => s.parse().unwrap_or(0.0),
    }
}

/// Pure parser for `ffprobe -print_format json -show_format -show_streams` output.
pub fn parse(json: &Value, path: &str) -> AppResult<MediaInfo> {
    let streams = json["streams"].as_array().cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1)
        .ok_or_else(|| AppError::Invalid("This file has no video stream, so it cannot be clipped.".into()))?;
    let audio = streams.iter().find(|s| s["codec_type"] == "audio");

    let (mut w, mut h) = (video["width"].as_u64().unwrap_or(0) as u32, video["height"].as_u64().unwrap_or(0) as u32);
    // Phone footage is often stored sideways with a rotation flag.
    let rot = video["side_data_list"]
        .as_array()
        .and_then(|l| l.iter().find_map(|d| d["rotation"].as_f64()))
        .or_else(|| video["tags"]["rotate"].as_str().and_then(|r| r.parse().ok()))
        .unwrap_or(0.0);
    if (rot.abs() as i64) % 180 == 90 {
        std::mem::swap(&mut w, &mut h);
    }
    if w == 0 || h == 0 {
        return invalid("The video stream has no size information.");
    }

    let dur = json["format"]["duration"].as_str().and_then(|d| d.parse::<f64>().ok())
        .or_else(|| video["duration"].as_str().and_then(|d| d.parse::<f64>().ok()))
        .unwrap_or(0.0);
    if dur <= 0.0 {
        return invalid("Could not read the length of this video.");
    }
    let fps = {
        let a = parse_rate(video["avg_frame_rate"].as_str().unwrap_or("0"));
        if a > 0.0 { a } else { parse_rate(video["r_frame_rate"].as_str().unwrap_or("0")) }
    };
    Ok(MediaInfo {
        path: path.to_string(),
        duration_sec: dur,
        size_bytes: json["format"]["size"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0),
        width: w,
        height: h,
        fps: (fps * 100.0).round() / 100.0,
        video_codec: video["codec_name"].as_str().unwrap_or("unknown").to_string(),
        audio_codec: audio.and_then(|a| a["codec_name"].as_str()).map(String::from),
        has_audio: audio.is_some(),
        container: json["format"]["format_name"].as_str().unwrap_or("").split(',').next().unwrap_or("").to_string(),
    })
}

pub fn probe(tools: &Tools, file: &Path) -> AppResult<MediaInfo> {
    if !file.is_file() {
        return Err(AppError::NotFound(format!("video file {}", file.display())));
    }
    let out = ffmpeg::command(&tools.ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(file)
        .output()?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return invalid(format!("FFmpeg could not read this file. It may be damaged or not a video. {}", err.lines().last().unwrap_or("")));
    }
    let json: Value = serde_json::from_slice(&out.stdout)?;
    parse(&json, &file.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_normal_video_with_audio() {
        let j = json!({
            "format": {"duration": "125.5", "size": "1048576", "format_name": "mov,mp4,m4a,3gp"},
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080, "avg_frame_rate": "30000/1001"},
                {"codec_type": "audio", "codec_name": "aac"}
            ]
        });
        let m = parse(&j, "a.mp4").unwrap();
        assert_eq!((m.width, m.height, m.duration_sec, m.size_bytes), (1920, 1080, 125.5, 1048576));
        assert_eq!(m.fps, 29.97);
        assert_eq!(m.audio_codec.as_deref(), Some("aac"));
        assert!(m.has_audio);
        assert_eq!(m.container, "mov");
    }

    #[test]
    fn rotated_phone_video_swaps_size() {
        let j = json!({
            "format": {"duration": "10"},
            "streams": [{"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080, "avg_frame_rate": "30/1",
                         "side_data_list": [{"rotation": -90.0}]}]
        });
        let m = parse(&j, "p.mp4").unwrap();
        assert_eq!((m.width, m.height), (1080, 1920));
        assert!(!m.has_audio);
    }

    #[test]
    fn audio_only_file_is_rejected_with_a_clear_message() {
        let j = json!({"format": {"duration": "10"}, "streams": [{"codec_type": "audio", "codec_name": "mp3"}]});
        let e = parse(&j, "a.mp3").unwrap_err().to_string();
        assert!(e.contains("no video stream"), "{e}");
    }

    #[test]
    fn missing_duration_is_rejected() {
        let j = json!({"format": {}, "streams": [{"codec_type": "video", "width": 10, "height": 10}]});
        assert!(parse(&j, "x").is_err());
    }
}
