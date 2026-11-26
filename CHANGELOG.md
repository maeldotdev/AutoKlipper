# Changelog

## 0.3.2
- A Stop button wherever a job shows its progress: downloads, transcription, clip finding, exports and AI setup.

## 0.3.1
- AI post captions: hashtags are no longer glued into one long word, and the caption is written in the video's language.

## 0.3.0
- Every new clip gets a post text: caption, hashtags and credit. Your Ollama model writes it when it is running; otherwise it comes from the words in the clip.
- Windows pop-ups when clips are ready, an export ends or something fails. Clicking one opens AutoKlipper there.
- Drag and resize the captions and the hook title on the video.
- Filters at export: five looks with a strength slider, sharpen, noise clean-up and clearer voice.
- Security: the window now has a content security policy, and only the Windows file dialog can set the FFmpeg or yt-dlp path.
- Security: local AI packages are locked with a hash for every file, and pip is updated during setup.
- Updated the url library to fix a crash bug.

## 0.2.0
- Clip and project cards show a real frame from the video.
- Save a gaming layout and use it on other clips.
- Change many clips at once in My Clips: shape, captions, gaming layout, hook title.
- Review picks: watch each suggested clip, then keep or discard it.
- Hook title across the top of a clip.
- Remove long pauses and filler words from a clip, with a way to put them back.

## 0.1.3
- Vertical clips can show the game on top and the camera below, with captions between them. Turn it on in the editor, Frame tab.
- Project cards show a loading bar while processing.

## 0.1.2
- Fixed the Ko-fi link.

## 0.1.1
- New app and installer icon.

## Tray
- Closing the window keeps AutoKlipper running in the system tray. Switch it off in Settings, General.
- Opening AutoKlipper again brings back the running window.

## Updates, first run and polish
- In-app updates from GitHub releases, signed with the project's update key. A notice offers the new version; nothing installs without a click, and it waits while a job or livestream is running.
- A fresh install opens a full-screen setup before the app.
- Support on Ko-fi and GitHub links in the sidebar and About.
- UI: cards show the site name instead of the full link, History dates no longer wrap, icon buttons have names, the empty weekly chart says so, setup buttons line up with their content.

## Phase 8, release 0.1.0
- Fixed: a new library could skip the setup guide because of a flag remembered by the web view.
- Third-party notices now carry a licence text for every library.
- Windows installer (NSIS, per user) showing the MIT licence and terms of use. Licence and third-party notice files are installed with the app.
- Setup guide on first start: free tools, local AI and captions, folders. Run it again from Settings, General.
- About page shows the version, licence, terms and third-party notices.
- Fixed: choosing GPU picked an encoder the graphics card did not have. Only encoders that really encode are used.
- Pages load when first opened; release build uses link-time optimisation.
- Removed leftover prototype and "arrives in Phase" wording from the desktop app.

## Rename and licence
- The app is now called AutoKlipper. Internal identifiers and existing data folders are unchanged.
- Released under the MIT licence.

## Phase 7 (version stays 0.1.0 until release)
- A locked or encrypted browser cookie store now gives a plain message instead of the raw yt-dlp error.
- Face tracking: the crop follows the face in the preview and in the export. Optional setup in Settings, AI (OpenCV and the YuNet model).
- Crop position and zoom are saved per clip (database version 4).
- Editor: real audio waveform, split at the playhead, timeline zoom, keys I (start), O (end), S (split), arrows (frame step, Shift for one second).
- Batch export can follow faces on clips that have no path yet.
- Fixed: trimming or splitting no longer jumps the playhead to zero or stops seeking from moving the video.
- Fixed: the desktop app no longer offers to restore sample captions on a clip without a transcript.

## After Phase 6
- The app folder and large files can live on another drive.
- Manual live clips are cut to the exact length asked for; added "Last 10 s".
- A live link pasted in Auto Clipper offers "Monitor in Live Clipper"; saved live clips have a "Subtitles and export" button.

## Phase 6 (version stays 0.1.0 until release)
- Live clipping: stream resolving per platform (yt-dlp) and direct HLS or RTMP, rolling on-disk buffer, continuous local transcription, automatic highlight detection, retroactive cutting, manual "clip the last N seconds", up to three streams, reconnects, preview frame.
- Live clips are saved as normal projects with transcript and captions.
- Live Clipper page runs the real engine in the desktop app; streams are remembered; rights confirmation required.
- Child processes can no longer outlive the app.
- 103 Rust tests including a real live session on a simulated stream. `scripts/e2e-phase6.mjs` drives the real app with its own local HLS stream (21 checks).

## Phase 5 (version stays 0.1.0 until release)
- Local AI: managed Python environment, set up on request, with Faster-Whisper transcription and word timestamps, model downloads (tiny to large v3), speaker detection (sherpa-onnx).
- Highlight detection with scores and reasons, preference weighting, sensitivity, optional Ollama second opinion.
- Database v3: transcripts per project, clip reason.
- Captions: automatic after clipping, burned into exports in the chosen style (ASS), SRT files, transcript corrections saved, per-clip on/off.
- UI: Settings AI panel (setup, models, speakers, Ollama), Auto Clipper analysis flow, real transcript and footage in Clip Editor and Caption Studio, export options for captions and SRT.
- 90 Rust tests including real transcription, highlight picking, speaker separation and caption burn-in. `scripts/e2e-phase5.mjs` drives the real app (16 checks).

## Phase 4 (version stays 0.1.0 until release)
- yt-dlp integration: locate and version check, link lookup without downloading (title, length, uploader, thumbnail, sizes offered), real downloads with progress, cancel, cleanup, FFprobe of the result.
- Six connectors, one file each: YouTube, Twitch, Kick, TikTok, Facebook and a generic one for direct files and HLS. Each has its own link rules and notice. Channels, playlists and profiles are refused. Livestreams are recognised and not downloaded.
- Safety: rights confirmation enforced in the backend, strict link schemes, exact host matching, options terminator before every link, optional browser sign-in only from a fixed list, links never logged.
- Plain-language error messages for private, age-restricted, members-only, region-blocked, DRM, rate limit, 403, offline and disk full.
- Shared queue now runs downloads and exports. Download jobs show in History with progress and can be cancelled.
- Auto Clipper in the desktop app: check a link, see what it is, pick a quality, confirm rights, download, and clips appear. Settings, Processing shows yt-dlp status and the optional browser sign-in. Deleting a project removes only the video CLIPIT downloaded.
- 56 Rust tests, including real yt-dlp runs. `scripts/e2e-phase4.mjs` drives the real app (26 checks).

## Phase 3 (version stays 0.1.0 until release)
- FFmpeg engine: locate, version and hardware encoder detection, probe (size, length, fps, codecs, rotation), cut, vertical and other aspect reframing with crop position and zoom, 480/720/1080 output, 24 to 60 fps, three quality levels, CPU or GPU encoder.
- Job queue with a concurrency limit, live progress, cancel (running and waiting), partial file cleanup, results saved to the database and pushed to the UI as events.
- Database v2: `projects.source_path`, `clips.export_path`.
- Desktop app: native file dialog and window drag-and-drop for video, FFmpeg-read file details and playback preview in Auto Clipper, clip editor plays the clip from its real source, real exports from the Clip Editor and My Clips, Show file, Settings FFmpeg status and picker, History cancel.
- Placeholder detection now spreads clips across the chosen length range; clips never run past the end of the video.
- 32 Rust tests including a real FFmpeg cut and reframe. `scripts/e2e-desktop.mjs` drives the running desktop app end to end (20 checks).

## Phase 2 (version stays 0.1.0 until release)
- Rust backend: SQLite (projects, clips, jobs) with versioned migrations, settings file with atomic writes, daily rolling log file, storage usage and safe cleanup, one typed error for all commands.
- 17 Tauri commands. Frontend `api` switches between Tauri and the mock automatically.
- Library, jobs and settings persist across restarts in the desktop app. Interrupted jobs are marked failed on next start.
- Storage numbers on the Dashboard and Settings are real folder sizes. Clear cache and Delete temp files really delete.
- Frontend errors and unhandled rejections are written to the backend log.
- 15 Rust unit tests.

## 0.1.0 (Phase 0 and 1)
- Tauri 2 shell with custom Windows title bar, native folder dialog, minimum window 1100 x 700.
- Design system: tokens, three themes, accent picker, density, motion preference.
- App shell: collapsible sidebar, header with breadcrumbs, search palette (Ctrl K), processing and notification popovers.
- Pages: Dashboard, Auto Clipper, Live Clipper, Projects, My Clips, Clip Editor, Caption Studio, Templates, History, Settings.
- Caption Studio: six presets (Bold Creator, Karaoke, Minimal, Cinematic, Podcast, Gaming), full customisation, eight animations, live preview with aspect switching and style comparison, transcript editor (word edit, timing, split, merge, search and replace, undo and redo), real SRT download, saved presets and templates.
- Mock services and simulated jobs, clearly labelled.
