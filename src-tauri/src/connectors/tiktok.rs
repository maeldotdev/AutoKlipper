use url::Url;

use super::{host_is, segments, Connector, ConnectorInfo, UrlKind};

pub struct TikTok;

impl Connector for TikTok {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "tiktok",
            name: "TikTok",
            recorded: true,
            live_planned: true,
            notice: "Only public videos work. TikTok may block automated access at any time. Respect the creator's rights before reusing their video.",
        }
    }

    fn matches(&self, u: &Url) -> bool {
        host_is(u, "tiktok.com")
    }

    fn classify(&self, u: &Url) -> Result<UrlKind, &'static str> {
        const ONE: &str = "Paste a link to one video, not a profile.";
        let host = u.host_str().unwrap_or("").to_ascii_lowercase();
        let seg = segments(u);
        // Short share links: vm.tiktok.com/XXXX and vt.tiktok.com/XXXX.
        if (host.starts_with("vm.") || host.starts_with("vt.")) && !seg.is_empty() {
            return Ok(UrlKind::Video);
        }
        match seg.as_slice() {
            [u, v, id] if u.starts_with('@') && v == "video" && !id.is_empty() => Ok(UrlKind::Video),
            [u, l] if u.starts_with('@') && l == "live" => Ok(UrlKind::Live),
            [t, code] if t == "t" && !code.is_empty() => Ok(UrlKind::Video),
            _ => Err(ONE),
        }
    }
}
