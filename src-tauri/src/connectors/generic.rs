use url::Url;

use super::{Connector, ConnectorInfo, UrlKind};

/// Direct video files and HLS/DASH links on any other site. yt-dlp's own extractors decide
/// whether the page really holds a video.
pub struct Generic;

impl Connector for Generic {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "generic",
            name: "Other sites and direct links",
            recorded: true,
            live_planned: true,
            notice: "Works with direct video files, HLS (.m3u8) and many other sites. Make sure you have the right to use the video. Streams that need a sign-in or use DRM are refused.",
        }
    }

    fn matches(&self, _u: &Url) -> bool {
        true
    }

    fn classify(&self, u: &Url) -> Result<UrlKind, &'static str> {
        Ok(if matches!(u.scheme(), "rtmp" | "rtmps") { UrlKind::Live } else { UrlKind::Video })
    }
}
