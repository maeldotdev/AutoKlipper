use url::Url;

use super::{host_is, segments, Connector, ConnectorInfo, UrlKind};

pub struct Facebook;

impl Connector for Facebook {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "facebook",
            name: "Facebook",
            recorded: true,
            live_planned: true,
            notice: "Only public videos work. Many Facebook videos need you to be signed in, and AutoKlipper does not sign in for you. If one fails, use your own browser sign-in in Settings, Processing.",
        }
    }

    fn matches(&self, u: &Url) -> bool {
        host_is(u, "facebook.com") || host_is(u, "fb.watch") || host_is(u, "fb.com")
    }

    fn classify(&self, u: &Url) -> Result<UrlKind, &'static str> {
        const ONE: &str = "Paste a link to one video, not a page or profile.";
        if host_is(u, "fb.watch") {
            return if segments(u).is_empty() { Err(ONE) } else { Ok(UrlKind::Video) };
        }
        let seg = segments(u);
        let has_v = u.query_pairs().any(|(k, v)| k == "v" && !v.is_empty());
        match seg.first().map(String::as_str) {
            Some("watch") if has_v => Ok(UrlKind::Video),
            Some("reel" | "reels" | "share") if seg.len() >= 2 => Ok(UrlKind::Video),
            _ if seg.iter().any(|s| s == "videos") && seg.len() >= 3 => Ok(UrlKind::Video),
            _ => Err(ONE),
        }
    }
}
