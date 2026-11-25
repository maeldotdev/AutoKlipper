use url::Url;

use super::{host_is, segments, Connector, ConnectorInfo, UrlKind};

pub struct Twitch;

/// First path words on twitch.tv that are pages, not channels.
const RESERVED: &[&str] = &["directory", "downloads", "jobs", "turbo", "settings", "subscriptions", "friends", "wallet", "p", "popout"];

impl Connector for Twitch {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "twitch",
            name: "Twitch",
            recorded: true,
            live_planned: true,
            notice: "Past broadcasts and clips are imported. Subscriber-only VODs need your own subscription and are not bypassed. Past broadcasts are deleted by Twitch after a while.",
        }
    }

    fn matches(&self, u: &Url) -> bool {
        host_is(u, "twitch.tv")
    }

    fn classify(&self, u: &Url) -> Result<UrlKind, &'static str> {
        const PAGE: &str = "Open one video or clip, not the channel page.";
        let seg = segments(u);
        if u.host_str().is_some_and(|h| h.eq_ignore_ascii_case("clips.twitch.tv")) {
            return if seg.is_empty() { Err(PAGE) } else { Ok(UrlKind::Video) };
        }
        match seg.as_slice() {
            [v, id] if v == "videos" && !id.is_empty() => Ok(UrlKind::Video),
            [_, c, slug] if c == "clip" && !slug.is_empty() => Ok(UrlKind::Video),
            [_, page] if page == "videos" || page == "clips" || page == "schedule" || page == "about" => Err("Open one video or clip, not the channel page."),
            [name] if !RESERVED.contains(&name.as_str()) => Ok(UrlKind::Live),
            _ => Err(PAGE),
        }
    }
}
