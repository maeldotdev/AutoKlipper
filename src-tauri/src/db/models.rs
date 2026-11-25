use serde::{Deserialize, Serialize};

use crate::error::{invalid, AppResult};

/// Field names and allowed values mirror `src/types/index.ts` on the frontend.
const SOURCE_KINDS: &[&str] = &["file", "url", "live"];
const PLATFORMS: &[&str] = &["youtube", "twitch", "kick", "tiktok", "facebook", "generic", "local"];
const PROJECT_STATUS: &[&str] = &["ready", "processing", "failed", "draft"];
const ASPECTS: &[&str] = &["9:16", "1:1", "4:5", "16:9"];
const TARGETS: &[&str] = &["tiktok", "shorts", "reels", "fb-reels"];
const CAPTIONS: &[&str] = &["none", "generated", "styled"];
const EXPORT_STATUS: &[&str] = &["not-exported", "queued", "exporting", "exported", "failed"];
const JOB_KINDS: &[&str] = &["download", "detect", "transcribe", "render", "export"];
const JOB_STATUS: &[&str] = &["queued", "running", "completed", "failed"];

fn middle() -> f64 {
    50.0
}
fn one() -> f64 {
    1.0
}

fn one_of(field: &str, v: &str, allowed: &[&str]) -> AppResult<()> {
    if allowed.contains(&v) {
        Ok(())
    } else {
        invalid(format!("{field} \"{v}\" is not one of: {}", allowed.join(", ")))
    }
}

fn text(field: &str, v: &str, max: usize) -> AppResult<()> {
    if v.trim().is_empty() {
        return invalid(format!("{field} cannot be empty"));
    }
    if v.chars().count() > max {
        return invalid(format!("{field} is longer than {max} characters"));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub source_kind: String,
    pub source_label: String,
    pub platform: String,
    pub duration: f64,
    pub status: String,
    pub created_at: String,
    /// Computed from the clips table on read; ignored on write.
    #[serde(default)]
    pub clip_count: i64,
    pub hue: i64,
    pub size_bytes: i64,
    /// Absolute path of the source video on this PC. None for projects without a local file.
    #[serde(default)]
    pub source_path: Option<String>,
}

impl Project {
    pub fn validate(&self) -> AppResult<()> {
        text("id", &self.id, 64)?;
        text("title", &self.title, 300)?;
        text("sourceLabel", &self.source_label, 2000)?;
        one_of("sourceKind", &self.source_kind, SOURCE_KINDS)?;
        one_of("platform", &self.platform, PLATFORMS)?;
        one_of("status", &self.status, PROJECT_STATUS)?;
        if self.duration < 0.0 || !self.duration.is_finite() {
            return invalid("duration must be a non-negative number");
        }
        Ok(())
    }
}

pub fn check_project_status(s: &str) -> AppResult<()> {
    one_of("status", s, PROJECT_STATUS)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub aspect: String,
    pub target: String,
    pub captions: String,
    pub export_status: String,
    pub score: i64,
    pub hue: i64,
    pub created_at: String,
    /// Where the rendered file was written. Set by the backend when an export finishes.
    #[serde(default)]
    pub export_path: Option<String>,
    /// Why highlight detection picked this clip.
    #[serde(default)]
    pub reason: Option<String>,
    /// 0 left, 50 centre, 100 right. Used when there is no face path.
    #[serde(default = "middle")]
    pub crop_x: f64,
    #[serde(default = "one")]
    pub zoom: f64,
    /// Face-following path: [seconds in the source, face centre 0..1].
    #[serde(default)]
    pub track: Option<Vec<[f64; 2]>>,
}

impl Clip {
    pub fn validate(&self) -> AppResult<()> {
        text("id", &self.id, 64)?;
        text("projectId", &self.project_id, 64)?;
        text("title", &self.title, 300)?;
        one_of("aspect", &self.aspect, ASPECTS)?;
        one_of("target", &self.target, TARGETS)?;
        one_of("captions", &self.captions, CAPTIONS)?;
        one_of("exportStatus", &self.export_status, EXPORT_STATUS)?;
        if !(self.start_sec.is_finite() && self.end_sec.is_finite()) || self.start_sec < 0.0 || self.end_sec <= self.start_sec {
            return invalid("A clip must start at 0 or later and end after it starts");
        }
        if !(0.0..=100.0).contains(&self.crop_x) || !(1.0..=3.0).contains(&self.zoom) {
            return invalid("Crop position must be 0 to 100 and zoom 1 to 3");
        }
        if let Some(t) = &self.track {
            if t.len() > 500 || t.iter().any(|p| !p[0].is_finite() || !(0.0..=1.0).contains(&p[1])) {
                return invalid("The face path is not valid");
            }
        }
        Ok(())
    }
}

/// Partial update. Absent fields stay as they are.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClipPatch {
    pub title: Option<String>,
    pub start_sec: Option<f64>,
    pub end_sec: Option<f64>,
    pub aspect: Option<String>,
    pub target: Option<String>,
    pub captions: Option<String>,
    pub export_status: Option<String>,
    pub crop_x: Option<f64>,
    pub zoom: Option<f64>,
    /// An empty list removes the face path.
    pub track: Option<Vec<[f64; 2]>>,
}

impl ClipPatch {
    pub fn apply(self, c: &mut Clip) {
        if let Some(v) = self.title { c.title = v }
        if let Some(v) = self.start_sec { c.start_sec = v }
        if let Some(v) = self.end_sec { c.end_sec = v }
        if let Some(v) = self.aspect { c.aspect = v }
        if let Some(v) = self.target { c.target = v }
        if let Some(v) = self.captions { c.captions = v }
        if let Some(v) = self.export_status { c.export_status = v }
        if let Some(v) = self.crop_x { c.crop_x = v }
        if let Some(v) = self.zoom { c.zoom = v }
        if let Some(v) = self.track { c.track = (!v.is_empty()).then_some(v) }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub status: String,
    pub progress: f64,
    pub source: String,
    pub started_at: String,
    pub duration_sec: i64,
    #[serde(default)]
    pub error: Option<String>,
    pub simulated: bool,
}

impl Job {
    pub fn validate(&self) -> AppResult<()> {
        text("id", &self.id, 64)?;
        text("title", &self.title, 300)?;
        one_of("kind", &self.kind, JOB_KINDS)?;
        one_of("status", &self.status, JOB_STATUS)?;
        if !(0.0..=100.0).contains(&self.progress) {
            return invalid("progress must be between 0 and 100");
        }
        Ok(())
    }
}
