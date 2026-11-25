use url::Url;

use super::{host_is, segments, Connector, ConnectorInfo, UrlKind};

pub struct Kick;

impl Connector for Kick {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "kick",
            name: "Kick",
            recorded: true,
            live_planned: true,
            notice: "Past broadcasts and clips are imported. Kick changes its site often, so a link can stop working until yt-dlp is updated.",
        }
    }

    fn matches(&self, u: &Url) -> bool {
        host_is(u, "kick.com")
    }

    fn classify(&self, u: &Url) -> Result<UrlKind, &'static str> {
        const PAGE: &str = "Open one video or clip, not the channel page.";
        match segments(u).as_slice() {
            [v, id] if (v == "video" || v == "clips") && !id.is_empty() => Ok(UrlKind::Video),
            [_, c, id] if (c == "videos" || c == "clips") && !id.is_empty() => Ok(UrlKind::Video),
            [_, c] if c == "videos" || c == "clips" => Err(PAGE),
            [name] if !["categories", "browse", "following", "dashboard"].contains(&name.as_str()) => Ok(UrlKind::Live),
            _ => Err(PAGE),
        }
    }
}
