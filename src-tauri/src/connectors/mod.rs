//! One connector per platform. A connector knows its own hosts, which links it can handle,
//! what to tell the user about that platform, and any extra yt-dlp flags it needs.
//! It does not bypass sign-ins, paywalls, DRM or regional blocks.
mod facebook;
mod generic;
mod kick;
mod tiktok;
mod twitch;
mod youtube;

use serde::Serialize;
use url::Url;

use crate::error::{invalid, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UrlKind {
    /// One recorded video or clip. Can be downloaded now.
    Video,
    /// A livestream. Monitored by the Live Clipper, never downloaded as a file.
    Live,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorInfo {
    pub id: &'static str,
    pub name: &'static str,
    /// Recorded videos and clips can be imported.
    pub recorded: bool,
    /// The Live Clipper can try livestreams from this platform.
    pub live_planned: bool,
    /// Shown to the user before they use a link from this platform.
    pub notice: &'static str,
}

pub trait Connector: Sync {
    fn info(&self) -> ConnectorInfo;
    fn matches(&self, u: &Url) -> bool;
    /// `Err` is a message for the user: the link is a channel page, a playlist, and so on.
    fn classify(&self, u: &Url) -> Result<UrlKind, &'static str>;
    fn extra_args(&self) -> Vec<String> {
        Vec::new()
    }
}

/// Specific platforms first, the generic fallback last.
pub fn all() -> [&'static dyn Connector; 6] {
    [&youtube::YouTube, &twitch::Twitch, &kick::Kick, &tiktok::TikTok, &facebook::Facebook, &generic::Generic]
}

pub fn infos() -> Vec<ConnectorInfo> {
    all().iter().map(|c| c.info()).collect()
}

pub fn parse_url(raw: &str) -> AppResult<Url> {
    let raw = raw.trim();
    if raw.is_empty() {
        return invalid("Paste a link first.");
    }
    let Ok(u) = Url::parse(raw) else {
        return invalid("This is not a valid link. Paste the full address, starting with https://");
    };
    if !matches!(u.scheme(), "http" | "https" | "rtmp" | "rtmps") {
        return invalid(format!("Links starting with {}:// are not supported. Use http, https or rtmp.", u.scheme()));
    }
    if u.host_str().is_none() {
        return invalid("This link has no website address in it.");
    }
    Ok(u)
}

pub fn detect(raw: &str) -> AppResult<(&'static dyn Connector, Url, UrlKind)> {
    let u = parse_url(raw)?;
    for c in all() {
        if c.matches(&u) {
            let kind = c.classify(&u).map_err(|m| crate::error::AppError::Invalid(m.into()))?;
            return Ok((c, u, kind));
        }
    }
    invalid("No connector handles this link.")
}

/// True when the host is `domain` or one of its subdomains.
pub(crate) fn host_is(u: &Url, domain: &str) -> bool {
    u.host_str().is_some_and(|h| h.eq_ignore_ascii_case(domain) || h.to_ascii_lowercase().ends_with(&format!(".{domain}")))
}

pub(crate) fn segments(u: &Url) -> Vec<String> {
    u.path_segments().map(|s| s.filter(|p| !p.is_empty()).map(String::from).collect()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(raw: &str) -> (&'static str, UrlKind) {
        let (c, _, k) = detect(raw).unwrap_or_else(|e| panic!("{raw}: {e}"));
        (c.info().id, k)
    }
    fn refused(raw: &str) -> String {
        detect(raw).err().unwrap_or_else(|| panic!("{raw} should be refused")).to_string()
    }

    #[test]
    fn youtube_links() {
        assert_eq!(d("https://www.youtube.com/watch?v=YE7VzlLtp-4"), ("youtube", UrlKind::Video));
        assert_eq!(d("https://youtu.be/YE7VzlLtp-4"), ("youtube", UrlKind::Video));
        assert_eq!(d("https://m.youtube.com/shorts/abc123"), ("youtube", UrlKind::Video));
        assert_eq!(d("https://www.youtube.com/live/abc123"), ("youtube", UrlKind::Video));
        assert!(refused("https://www.youtube.com/@blender").contains("one video"));
        assert!(refused("https://www.youtube.com/playlist?list=PL1").contains("one video"));
        assert!(refused("https://www.youtube.com/watch").contains("one video"));
    }

    #[test]
    fn twitch_links() {
        assert_eq!(d("https://www.twitch.tv/videos/123456"), ("twitch", UrlKind::Video));
        assert_eq!(d("https://www.twitch.tv/somechannel/clip/FunnyName-abc"), ("twitch", UrlKind::Video));
        assert_eq!(d("https://clips.twitch.tv/FunnyName-abc"), ("twitch", UrlKind::Video));
        assert_eq!(d("https://www.twitch.tv/somechannel"), ("twitch", UrlKind::Live));
        assert!(refused("https://www.twitch.tv/somechannel/videos").contains("not the channel"));
    }

    #[test]
    fn kick_links() {
        assert_eq!(d("https://kick.com/video/6b1f1b0e-1111-2222-3333-444455556666"), ("kick", UrlKind::Video));
        assert_eq!(d("https://kick.com/somechannel/videos/6b1f1b0e"), ("kick", UrlKind::Video));
        assert_eq!(d("https://kick.com/somechannel/clips/clip_abc"), ("kick", UrlKind::Video));
        assert_eq!(d("https://kick.com/somechannel"), ("kick", UrlKind::Live));
        assert!(refused("https://kick.com/somechannel/videos").contains("not the channel"));
    }

    #[test]
    fn tiktok_links() {
        assert_eq!(d("https://www.tiktok.com/@someone/video/7300000000000000000"), ("tiktok", UrlKind::Video));
        assert_eq!(d("https://vm.tiktok.com/ZMabc123/"), ("tiktok", UrlKind::Video));
        assert_eq!(d("https://www.tiktok.com/@someone/live"), ("tiktok", UrlKind::Live));
        assert!(refused("https://www.tiktok.com/@someone").contains("one video"));
    }

    #[test]
    fn facebook_links() {
        assert_eq!(d("https://www.facebook.com/watch/?v=123456789"), ("facebook", UrlKind::Video));
        assert_eq!(d("https://www.facebook.com/somepage/videos/123456789"), ("facebook", UrlKind::Video));
        assert_eq!(d("https://www.facebook.com/reel/123456789"), ("facebook", UrlKind::Video));
        assert_eq!(d("https://fb.watch/abcDEF/"), ("facebook", UrlKind::Video));
        assert!(refused("https://www.facebook.com/somepage").contains("one video"));
    }

    #[test]
    fn generic_links() {
        assert_eq!(d("https://example.com/clips/a.mp4"), ("generic", UrlKind::Video));
        assert_eq!(d("https://cdn.example.com/stream/playlist.m3u8"), ("generic", UrlKind::Video));
        assert_eq!(d("rtmp://live.example.com/app/key"), ("generic", UrlKind::Live));
    }

    #[test]
    fn dangerous_or_broken_input_is_refused() {
        assert!(refused("").contains("Paste a link"));
        assert!(refused("not a url").contains("not a valid link"));
        assert!(refused("file:///C:/Windows/System32/config/SAM").contains("not supported"));
        assert!(refused("javascript:alert(1)").contains("not supported"));
        assert!(refused("ftp://example.com/a.mp4").contains("not supported"));
        assert!(refused("--exec calc https://x.com").contains("not a valid link"));
    }

    #[test]
    fn lookalike_hosts_do_not_match_a_platform() {
        // A domain that merely contains the platform name must fall through to the generic connector.
        assert_eq!(d("https://notyoutube.com/watch?v=abc").0, "generic");
        assert_eq!(d("https://youtube.com.evil.example/watch?v=abc").0, "generic");
        assert_eq!(d("https://faketwitch.tv/videos/1").0, "generic");
    }
}
