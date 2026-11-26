//! The ready-to-post text of a clip: a caption, hashtags and a credit line.
//! A model the user runs in Ollama writes it. Without one, it comes from the clip's own words.
use std::path::Path;

use super::ollama;
use crate::settings;

/// Tags added to every post until the user changes them in Settings. They are common, not live trends.
pub const DEFAULT_TAGS: &str = "#fyp #foryou #viral #shorts";

#[derive(Debug, Clone)]
pub struct Config {
    pub enabled: bool,
    pub base: String,
    /// The model chosen in Settings. The first installed one is used when it is empty.
    pub model: String,
    pub my_tags: String,
}

impl Config {
    pub fn load(settings_file: &Path) -> Config {
        let s = settings::load(settings_file).unwrap_or_default();
        Config {
            enabled: s["postCaptions"] != false,
            base: ollama::DEFAULT_BASE.into(),
            model: s["ollamaModel"].as_str().unwrap_or_default().into(),
            my_tags: s["postTags"].as_str().unwrap_or(DEFAULT_TAGS).into(),
        }
    }

    /// The model to ask, or `None` when Ollama is not running or has no model.
    pub fn pick_model(&self) -> Option<String> {
        let installed = ollama::models(&self.base).ok()?;
        installed.iter().find(|m| **m == self.model).or_else(|| installed.first()).cloned()
    }
}

/// One tag without its `#`. Several words are joined with capitals: "winning moment" is "WinningMoment".
fn tag_word(t: &str) -> String {
    let words: Vec<String> = t
        .split_whitespace()
        .map(|w| w.chars().filter(|c| c.is_alphanumeric() || *c == '_').collect::<String>())
        .filter(|w| !w.is_empty())
        .collect();
    if words.len() < 2 {
        return words.concat();
    }
    words.iter().map(|w| { let mut c = w.chars(); c.next().map(|f| f.to_uppercase().chain(c).collect::<String>()).unwrap_or_default() }).collect()
}

/// `#Tag` form, letters, digits and `_` only, no repeats, at most 12.
pub fn hashtags<'a>(raw: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::new();
    // A model may pack several tags into one item: "late game, winning moment".
    for t in raw.flat_map(|t| t.split([',', ';', '#', '\n'])) {
        let word = tag_word(t);
        if word.is_empty() || word.chars().count() > 30 || seen.contains(&word.to_lowercase()) {
            continue;
        }
        seen.push(word.to_lowercase());
        out.push(format!("#{word}"));
        if out.len() == 12 {
            break;
        }
    }
    out
}

/// The first sentence or so of what is said, else the clip's title.
pub fn fallback_caption(title: &str, said: &str) -> String {
    let said = said.trim();
    let end = said.char_indices().find(|(i, c)| *i >= 20 && matches!(c, '.' | '!' | '?')).map(|(i, c)| i + c.len_utf8());
    let first = &said[..end.unwrap_or(said.len())];
    if first.is_empty() {
        return title.trim().to_string();
    }
    if first.chars().count() <= 150 {
        return first.to_string();
    }
    let cut: String = first.chars().take(150).collect();
    format!("{}...", cut.rsplit_once(' ').map_or(cut.as_str(), |(a, _)| a))
}

pub fn compose(caption: &str, content_tags: &[String], my_tags: &str, credit: Option<&str>) -> String {
    let tags = hashtags(content_tags.iter().map(String::as_str).chain(my_tags.split_whitespace()));
    let mut parts = vec![caption.trim().to_string()];
    if !tags.is_empty() {
        parts.push(tags.join(" "));
    }
    if let Some(c) = credit.map(str::trim).filter(|c| !c.is_empty()) {
        parts.push(format!("Credit: {c}"));
    }
    parts.retain(|p| !p.is_empty());
    parts.join("\n\n")
}

/// Never fails: a model that is missing or answers badly leaves the plain version.
pub fn write(cfg: &Config, model: Option<&str>, title: &str, said: &str, language: &str, credit: Option<&str>) -> String {
    let answer = model.and_then(|m| match ollama::post(&cfg.base, m, title, said, language) {
        Ok(a) => Some(a),
        Err(e) => {
            tracing::warn!("post caption from the model failed, using the words said: {e}");
            None
        }
    });
    match answer {
        Some((caption, tags)) => compose(&caption, &tags, &cfg.my_tags, credit),
        None => compose(&fallback_caption(title, said), &[], &cfg.my_tags, credit),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(base: String) -> Config {
        Config { enabled: true, base, model: "chosen".into(), my_tags: "#fyp #Viral".into() }
    }

    #[test]
    fn hashtags_are_cleaned_and_not_repeated() {
        let t = hashtags(["gaming", "#Gaming", "so good!", "", "#", "viral"].into_iter());
        assert_eq!(t, ["#gaming", "#SoGood", "#viral"]);
        // What gemma3 really sent: everything in one item.
        let packed = hashtags(["Late game victory, incredible teamwork, winning moment"].into_iter());
        assert_eq!(packed, ["#LateGameVictory", "#IncredibleTeamwork", "#WinningMoment"]);
        assert!(hashtags(["x".repeat(31).as_str()].into_iter()).is_empty());
        assert_eq!(hashtags((0..30).map(|_| "a").chain(["b"])), ["#a", "#b"]);
    }

    #[test]
    fn without_a_model_the_words_said_become_the_caption() {
        let out = write(&cfg("http://127.0.0.1:9".into()), None, "Title", "I did not expect this at all. Then more.", "en", Some("Some Channel"));
        assert_eq!(out, "I did not expect this at all.\n\n#fyp #Viral\n\nCredit: Some Channel");
        assert_eq!(write(&cfg(String::new()), None, "Only a title", "  ", "", None), "Only a title\n\n#fyp #Viral");
        assert!(fallback_caption("t", &"word ".repeat(80)).ends_with("word..."));
    }

    #[test]
    fn an_unreachable_model_falls_back() {
        assert!(cfg("http://127.0.0.1:9".into()).pick_model().is_none());
        let out = write(&cfg("http://127.0.0.1:9".into()), Some("x"), "Title", "", "en", None);
        assert_eq!(out, "Title\n\n#fyp #Viral");
    }

    #[test]
    fn a_running_model_writes_caption_and_tags() {
        use std::io::{Read, Write};
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in server.incoming().take(2) {
                let mut s = stream.unwrap();
                let mut seen = Vec::new();
                let mut buf = [0u8; 4096];
                // Read the whole request: headers, then as many bytes as Content-Length says.
                loop {
                    let n = s.read(&mut buf).unwrap();
                    seen.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&seen).to_lowercase();
                    let Some(head) = text.find("\r\n\r\n") else { continue };
                    let want: usize = text.split("content-length:").nth(1).and_then(|r| r.split("\r\n").next()?.trim().parse().ok()).unwrap_or(0);
                    if n == 0 || seen.len() >= head + 4 + want {
                        break;
                    }
                }
                let body = if seen.starts_with(b"GET /api/tags") {
                    r#"{"models":[{"name":"first"},{"name":"chosen"}]}"#.to_string()
                } else {
                    serde_json::json!({"response": r##"{"caption": "Wait for it", "hashtags": ["gaming", "#clutch"]}"##}).to_string()
                };
                write!(s, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        let c = cfg(base);
        let model = c.pick_model();
        assert_eq!(model.as_deref(), Some("chosen"));
        assert_eq!(write(&c, model.as_deref(), "T", "words", "en", None), "Wait for it\n\n#gaming #clutch #fyp #Viral");
    }
}
