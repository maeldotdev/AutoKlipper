use url::Url;

use super::{host_is, segments, Connector, ConnectorInfo, UrlKind};

pub struct YouTube;

impl Connector for YouTube {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "youtube",
            name: "YouTube",
            recorded: true,
            live_planned: true,
            notice: "Use only videos you own or have permission to reuse. Private, members-only, age-restricted and region-locked videos need your own access and are not bypassed.",
        }
    }

    fn matches(&self, u: &Url) -> bool {
        host_is(u, "youtube.com") || host_is(u, "youtu.be") || host_is(u, "youtube-nocookie.com")
    }

    fn classify(&self, u: &Url) -> Result<UrlKind, &'static str> {
        const ONE: &str = "Paste a link to one video, not a channel or playlist.";
        let seg = segments(u);
        if host_is(u, "youtu.be") {
            return if seg.is_empty() { Err(ONE) } else { Ok(UrlKind::Video) };
        }
        match seg.first().map(String::as_str) {
            Some("watch") if u.query_pairs().any(|(k, v)| k == "v" && !v.is_empty()) => Ok(UrlKind::Video),
            Some("shorts" | "live" | "embed" | "v") if seg.len() >= 2 => Ok(UrlKind::Video),
            _ => Err(ONE),
        }
    }
}
