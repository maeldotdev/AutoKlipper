# Architecture

## Stack
Tauri 2 (Rust) shell, React 19 + TypeScript + Vite 8 frontend, Tailwind CSS 4 with CSS variable tokens, Radix primitives, Lucide icons, Motion, Recharts, Zustand, React Router (HashRouter, safe for the Tauri custom protocol).

## Layout
```
src/
  app/          route table and navigation metadata
  layouts/      AppShell, TitleBar, Sidebar, Header, CommandPalette
  pages/        one file per page (Dashboard, AutoClipper, LiveClipper, Projects,
                MyClips, ClipEditor, CaptionStudio, Templates, History, Settings)
  components/
    ui/         primitives: Button, Input/Field, Dialog/ConfirmDialog, Select, Switch,
                Slider, Segmented, Chip, Tabs, Menu, Popover, Toasts, Badge, Progress,
                Skeleton, EmptyState
    caption/    CaptionPreview (renderer), StylePanel, PresetGallery, SegmentEditor,
                Timeline, Transport
    Common.tsx  Page, Thumb, PlatformMark, StatTile
  stores/       Zustand stores: settings (persisted), ui, library, captions (persisted),
                live, playhead
  services/     the only boundary to data. Mock implementation today
  mock/         sample projects, clips, jobs, streams, transcript
  theme/        caption presets, templates, Whisper model facts
  hooks/        usePlaybackEngine, useLocalVideo
  lib/          utils, labels, srt, native
  types/        shared types
src-tauri/      Rust shell. Only the dialog plugin in Phase 1
```

## Data flow
Pages read from stores. Stores call `services/index.ts` (`api.library`). In Phase 1 the service returns mock data after a short delay so loading states are real. Phase 2 replaces the mock service with Tauri `invoke` wrappers that keep the same signatures. Pages do not change.

Simulated work (Auto Clipper run, exports, retries, live monitoring) lives in the stores and is always flagged `simulated` and labelled in the UI.

## Playback and captions
`stores/playhead` holds time, play state and duration outside React page state, because time changes about 60 times a second. Only leaf components (preview, timeline, clock, scrubber) subscribe to `time`. `usePlaybackEngine` drives it: the video element clock when a test video is loaded, a requestAnimationFrame clock otherwise.

`CaptionLayer` is a pure function of (segments, style, time). It sizes everything in `cqh` units against a size container, so one style renders identically at any preview size and aspect ratio. Animation, highlight and karaoke fill are computed per word from the playhead.

## Backend (Phase 2)
```
src-tauri/src/
  lib.rs        startup: paths, logging, database, state, command registration
  commands.rs   the only Tauri command surface (17 commands)
  state.rs      AppState: Mutex<Connection>, paths, log guard
  paths.rs      every folder under %APPDATA%\app.clipit.desktop
  error.rs      AppError, serialised as a plain message
  settings.rs   settings.json: load, merge patch, atomic write
  files.rs      storage usage, cleanup of cache and temp only
  logging.rs    daily rolling log file
  db/
    mod.rs      open, WAL, foreign keys, migrations (user_version)
    models.rs   Project, Clip, Job, ClipPatch with validation
    repo.rs     SQL, tested against an in-memory database
```
### Video engine (Phase 3)
```
src-tauri/src/
  media/ffmpeg.rs     locate FFmpeg, version, hardware encoders, hidden-console Command
  media/probe.rs      ffprobe JSON to MediaInfo (pure parser, tested)
  media/render.rs     filter graph, argument builder, progress parser, run with cancel
  media/scheduler.rs  pure FIFO with a concurrency limit (tested)
  media/queue.rs      threads, DB writes, `job-update` events
  media_commands.rs   ffmpeg_status, probe_media, export_clips, cancel_job, reveal_path
```
Export flow: the frontend calls `export_clips` with clip ids and options. The backend validates every clip first (source file exists, clip inside the video), creates one job per clip, then the queue runs FFmpeg processes up to the limit. Each state change is written to SQLite and emitted as `job-update`; the library store applies it. Output goes to the export folder as `<title>-<aspect>-<id>.mp4`.

### Connectors and downloads (Phase 4)
```
src-tauri/src/
  connectors/mod.rs         Connector trait, link parsing, detect(), host matching
  connectors/{youtube,twitch,kick,tiktok,facebook,generic}.rs   one platform each
  media/ytdlp.rs            locate, link lookup, error explainer, download arguments, output finder
  media/process.rs          shared process runner (FFmpeg and yt-dlp): lines in, cancel, stderr out
  media/queue.rs            one queue for Render and Download work
```
Link flow: `probe_url` parses the link, picks a connector, refuses channel pages, answers livestreams without contacting the site, otherwise runs `yt-dlp --dump-single-json --skip-download` with a 60 second limit. `start_download` requires the rights confirmation, creates a job and queues a `Work::Download`. On success FFprobe reads the file, the project gets its source path, length and size, and a `job-update` event tells the UI, which then creates the clips the user asked for.

Commands added: `ytdlp_status`, `list_connectors`, `probe_url`, `start_download`.

### Local AI (Phase 5)
```
src-tauri/
  ai/clipit_ai.py       Python helper (check, download-model, download-speaker, transcribe)
  src/ai/env.rs         managed venv, pinned packages, status
  src/ai/transcript.rs  segment types, slicing to a clip, SRT
  src/ai/audio.rs       loudness per half second from the WAV
  src/ai/highlights.rs  candidate windows, scoring, reasons, keyword marking
  src/ai/ollama.rs      optional local model rating
  src/ai/ass.rs         caption style to ASS for burn-in
  src/media/analyze.rs  the analysis job
  src/ai_commands.rs    ai_status, ai_setup, downloads, analyze_project, transcripts, ollama_models
```
Analysis job: FFmpeg extracts audio, the helper transcribes (and tells speakers apart), Rust scores windows, optionally asks Ollama, then saves the transcript and clips and emits `job-update` with `clipsAdded`. Helper protocol: `CLIPIT_PROGRESS n` on stdout, `CLIPIT_ERROR: message` on stderr, result in a JSON file.

Developer overrides: `CLIPIT_AI_PYTHON` (interpreter with the packages).

### Live engine (Phase 6)
```
src-tauri/src/
  media/live_source.rs   link to stream address(es): yt-dlp for platforms, direct HLS and RTMP
  media/live.rs          Tauri-free engine: recorder, segment list, transcriber, detection, cutting
  media/job.rs           child processes die with the app (Windows job object)
  live_commands.rs       live_start, live_stop, live_clip_now, live_running; saves clips; `live-update` events
```
One thread per session. FFmpeg writes `temp/live/<id>/run*_NNNNNN.ts` and a CSV list; each finished piece is transcribed, scored and pruned. Clips are written to `downloads/live-*.mp4` and become projects.

Commands: `app_info`, `load_settings`, `patch_settings`, `list/create/delete_project`, `set_project_status`, `list/create/update/delete_clips`, `list_jobs`, `save_job`, `clear_finished_jobs`, `storage_usage`, `clean_storage`, `frontend_log`.

Data folder: `clipit.db` (SQLite), `settings.json`, `logs/`, `cache/`, `temp/`, `models/`, `exports/`.

Frontend bridge: `services/index.ts` exports `api.library` and `api.system`. Desktop app uses `services/tauri.ts`; a browser uses the mock. `services/bootstrap.ts` runs before first render: it installs error logging, loads settings from the backend, fills real folder defaults on first run, and saves later changes (debounced 300 ms).

### Editor and framing (Phase 7)
- `clips` carries `crop_x`, `zoom` and an optional `track` (`[[source seconds, face centre 0..1]]`).
- `ai/clipit_ai.py track` samples faces with YuNet; `ai/reframe.rs` smooths the samples and turns a path into an FFmpeg crop expression in `t`. `src/lib/reframe.ts` is the same maths for the preview.
- `media/waveform.rs` decodes a range of audio to peaks for the timeline.
- Tauri commands: `ai_setup_face`, `track_faces`, `audio_peaks`.
- End-to-end test: `scripts/e2e-phase7.mjs`.

## Native integration
- Custom title bar (window decorations off). Controls call the Tauri window API and are hidden in a plain browser.
- Native folder dialog through `@tauri-apps/plugin-dialog` (`lib/native.ts`). In a browser it explains it is desktop only.
- Capabilities in `src-tauri/capabilities/default.json` list only the window and dialog permissions in use.

## Decisions to revisit later
See DECISIONS.md.
