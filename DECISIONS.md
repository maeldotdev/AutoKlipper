# Decisions

| # | Decision | Why | Revisit when |
| --- | --- | --- | --- |
| 1 | Tauri 2 with window decorations off and a custom title bar | Matches the reference look and allows Windows-style controls inside the layout | Snap layouts or Mica needed (Phase 8) |
| 2 | HashRouter | Reliable under the Tauri custom protocol without server rewrites | Unlikely |
| 3 | Geist Variable as the UI font | Neutral, compact, strong numerals, free licence, self-hosted | Brand font chosen |
| 4 | Lucide icons as requested; platform marks are text monograms | Lucide 1.x removed brand logos; drawing logos by hand is not acceptable | Licensed brand assets available |
| 5 | Zustand for state | Small, no provider tree, selectors keep frame-rate updates local | State outgrows it |
| 6 | Playhead in its own store | 60 Hz updates must not re-render pages | Unlikely |
| 7 | Captions rendered in DOM with `cqh` units | Instant live preview at any size. FFmpeg burn-in in Phase 3 must reproduce the same layout | Phase 3 render parity tests |
| 8 | Mock service behind `services/index.ts` | Phase 2 swaps the implementation, pages stay | Phase 2 |
| 9 | Simulated jobs are labelled and never write files | Rule: never claim real processing with mock data | Phase 3 |
| 10 | Real features kept in Phase 1: local video preview, SRT download, URL validation, native folder dialog, drag and drop | They need no backend and make the prototype testable | n/a |
| 11 | Only Geist is used by the UI. Cormorant Garamond and Anton load for caption presets | Cinematic and Gaming presets need a serif and a display face | Presets reworked |
| 12 | Whisper model sizes and relative speeds taken from the public Whisper docs; memory marked approximate | Avoid invented benchmarks | Phase 5 measures real numbers |
| 14 | Captions are generated automatically when clips are made; the user can turn them off per run and remove them per clip. Burn-in happens only at export | Confirmed by the user | Phase 3 and 5 |
| 15 | All app data lives under one folder (`%APPDATA%\app.clipit.desktop`): `clipit.db`, `settings.json`, `logs`, `cache`, `temp`, `models`, `exports` | One place to back up, clean and uninstall | Portable mode wanted |
| 16 | SQLite through `rusqlite` (bundled), WAL mode, foreign keys on, one connection behind a mutex, forward-only migrations tracked by `PRAGMA user_version` | Local, fast, no server. Phase 2 load is tiny, so one connection is enough | Phase 3 queues write heavily |
| 17 | Settings stay a JSON file. Backend stores any JSON object, merges patches and writes atomically. Frontend owns keys and defaults | Keeps UI and backend decoupled and the file human-readable. A corrupt file is moved aside, never blocks startup | Settings need validation in Rust |
| 18 | Backend validates every value against the same enums the frontend uses and rejects bad input with a plain message | The database must never hold values the UI cannot render | Types generated from one source |
| 19 | Cleanup commands take a fixed target (`cache` or `temp`), never a path, and refuse anything outside the app root | A frontend bug must not be able to delete user files | n/a |
| 20 | Frontend is write-through: UI updates first, backend saves after, failures show an error toast and are logged | Keeps the UI instant while never hiding a failed save | Optimistic rollback needed |
| 21 | Jobs still marked running at startup are marked failed with an explanation | A job cannot survive a restart in Phase 2, so showing progress would be false | Phase 3 resumable queue |
| 22 | In a browser the mock service stays. In the desktop app the library starts empty (real data); Live streams stay empty until Phase 6 | Real empty states are honest and testable | n/a |
| 23 | FFmpeg is an external program found at runtime (Settings path, `bin` beside the app, PATH, WinGet links). It is never downloaded silently. The installer bundles it in Phase 8 | Licence and size are the user's call; avoids shipping a GPL build by accident | Phase 8 packaging |
| 24 | Clips are cut with `-ss` before `-i` and re-encoded (H.264 + AAC, `+faststart`) | Fast seek on long sources and frame-accurate cut points. Stream copy would cut only on keyframes | Phase 7 lossless trim option |
| 25 | Reframe = crop to the target shape (position from crop X, narrowed by zoom) then Lanczos scale. Output sizes are even numbers. Resolution means the short side | Matches what the editor preview shows. 1080 vertical is 1080x1920 | Face tracking (Phase 7) replaces the fixed crop X |
| 26 | GPU encoding is used only when the user picks GPU and FFmpeg lists nvenc, amf or qsv. Automatic uses CPU x264 | A hardware encoder listed in FFmpeg may still have no GPU behind it; failing silently on Automatic would be worse than a slower export | Phase 8 GPU probing |
| 27 | One queue with a user-set limit (1 to 4). Each job is an FFmpeg process; cancel kills it and deletes the partial file. Progress comes from FFmpeg `-progress`. Backend pushes `job-update` events | No polling, and the DB is the record of truth | Resumable jobs |
| 28 | Export is refused clearly if the clip has no source file on this PC. No fake render in the desktop app | Never claim a file was written when it was not | Phase 4 downloads |
| 29 | Highlight detection and captions are still placeholders: Auto Clipper splits the video into evenly spaced clips. Caption burn-in is not part of Phase 3 | The transcript comes from Faster-Whisper in Phase 5, and burn-in needs it | Phase 5 |
| 30 | Webview can play a source file only after the backend probes it (asset protocol scope grows per file, not a wildcard) | Least privilege | n/a |
| 31 | yt-dlp is an external program found at runtime (`CLIPIT_YTDLP` for dev and tests, Settings path, `bin` beside the app, PATH, WinGet links). Never downloaded silently. Bundling is a Phase 8 licence decision | Same reasoning as FFmpeg. Sites break yt-dlp often, so users must be able to update it themselves | Phase 8 |
| 32 | One connector per platform (YouTube, Twitch, Kick, TikTok, Facebook, generic), each in its own file with its own link rules and its own user notice | Platforms differ in what a valid link looks like and what they allow | New platform = new file |
| 33 | Hosts match exactly or as a subdomain, never by substring. Only http, https, rtmp and rtmps links are accepted. URLs are passed to yt-dlp after `--` | Stops lookalike domains, `file://` reads and option injection | n/a |
| 34 | Channel pages, playlists and profiles are refused with a message asking for one video | One link = one project. Clear scope | Playlist import later |
| 35 | Livestream links are recognised and refused for download: "clipped with the Live Clipper (Phase 6)" | A live stream is never a finite file. No pretend support | Phase 6 |
| 36 | Download needs the user to confirm they may use the video, and the backend enforces it. The platform notice is shown first | Respect copyright and terms. Consent is recorded in the log as platform and host only, never the full link | Terms review per platform |
| 37 | CLIPIT never signs in, never asks for passwords and does not defeat private, members-only, DRM or region blocks. Errors say what is wrong. The only access aid is an opt-in setting that lets yt-dlp use the user's own browser sign-in, from a fixed list of browsers | Respect permissions. A user's own account is theirs to use | Review if cookie reading breaks on browser updates |
| 38 | yt-dlp failures are translated into plain advice (private, age-restricted, members, region, DRM, rate limit, 403, offline, missing FFmpeg, disk full). Anything unknown shows yt-dlp's own last error line | Never a raw stack trace, never a silent failure | Add cases as they appear |
| 39 | Downloads go to `%APPDATA%\app.clipit.desktop\downloads\<jobid>.mp4`. Deleting a project deletes a file inside that folder and nothing else. A cancelled or failed download deletes its partial files | CLIPIT owns downloaded files and never touches the user's own videos | n/a |
| 40 | Downloads and exports share one queue and one concurrency limit. A download that ends by restart is marked failed, with its project | Nothing survives a restart yet | Resumable downloads |
| 41 | After a download the real length and size come from FFprobe, not from the site's metadata | Direct links often have no duration | n/a |
| 42 | Local AI lives in a CLIPIT-managed Python environment (`%APPDATA%\app.clipit.desktop\ai\venv`), created only when the user clicks Set up. Packages are pinned (`faster-whisper==1.2.1`, `sherpa-onnx==2.0.3`) | Faster-Whisper is a Python library. Isolation keeps the system Python clean; pinning stops silent changes | Phase 8: bundle an embedded Python |
| 43 | Models download once on request into the model folder; transcription runs with `local_files_only`, so it works offline | Local-first rule | n/a |
| 44 | CLIPIT extracts 16 kHz mono audio with FFmpeg and passes samples to faster-whisper, not the file | faster-whisper 1.2.1 breaks with the current PyAV decoder | Newer faster-whisper |
| 45 | Highlight detection is a transparent heuristic (loudness, reaction and insight phrases, questions, humour, story cues, speed). Each clip stores the reason. The Look-for choices double their signal | Honest and testable without a language model. English phrase lists, so other languages rank mostly by loudness and speed | Phrase lists per language |
| 46 | Ollama is optional, only `127.0.0.1`, and averages its score with the heuristic. Any failure leaves the heuristic result | Never block on an optional tool | n/a |
| 47 | Speaker detection uses sherpa-onnx with public ONNX models (no account or token) | pyannote needs a Hugging Face token and PyTorch | Better diarization wanted |
| 48 | Captions burn in through generated ASS files and FFmpeg `ass`. Fonts are the nearest Windows fonts; typewriter and slide-up are approximated | Exact preview fonts need bundled TTF files; ASS animates events, not letters | Phase 7 render parity |
| 49 | Without local AI, clips are evenly spaced and marked captions off | No captions without a transcript; never pretend | n/a |
| 50 | Transcripts are stored per project in SQLite; the editor shows a clip's slice and writes edits back into the project transcript | One source of truth, trimming just re-slices | n/a |
| 51 | Live monitoring records the stream with FFmpeg into short segments (8 s) on disk. That is the rolling buffer (5 to 30 minutes); older pieces are deleted | Retroactive clips need no memory buffer and survive transcription lag | Shorter segments for faster detection |
| 52 | Live transcription keeps one Python helper per session with the model loaded (`serve` mode) | Loading the model per segment is far too slow | Share one helper between sessions |
| 53 | A moment is reported only after it has ended, scored over the last window with the same heuristic as files | Never cut a moment in half; one scoring system | n/a |
| 54 | Each live clip is saved as its own project (source kind live) with its own short video and transcript | Reuses editor, captions, export and delete unchanged; the buffer can be thrown away | Group by session if the list gets noisy |
| 55 | Up to three sessions at once. A failing stream retries four times with growing pauses, then stops with a reason | Bounded CPU and network use | Setting for the limit |
| 56 | Monitoring needs the user's rights confirmation, enforced by the backend. Only the host is stored on clips and logged, never the full link. Saved stream links stay in the local settings file | RTMP links carry secret keys | Encrypt saved links |
| 57 | Platform streams are resolved by yt-dlp; direct HLS and RTMP links are read as given. No sign-in, DRM or region bypass | Same permission rules as downloads | n/a |
| 58 | Every child process joins a Windows job object that is killed with the app, including after a crash | An orphaned recorder would fill the disk | n/a |
| 59 | The whole app folder can move: `location.json` in the default app data folder names the folder to use. A separate setting moves only large files. If the chosen drive is missing, CLIPIT uses the default folder and says so | The system drive is small on some PCs; a silent empty library would look like data loss | Settings screen for moving the app folder |
| 60 | Face detection is OpenCV's YuNet, installed on request into the CLIPIT AI environment; the model file is checked against a pinned SHA-256 | Small, local, free; nothing is downloaded without the user's click | Bundle in Phase 8 |
| 61 | The face path is sampled at 5 per second, smoothed (median, dead zone, speed limit) and reduced to at most 60 points, stored in source seconds | A calm camera, a short FFmpeg expression, and trimming does not invalidate it | Per-scene tracking |
| 62 | It follows the largest, steadiest face. It does not detect who is speaking | Active speaker detection needs a much heavier model | Combine with speaker labels |
| 63 | The preview computes the same crop window as the render (`lib/reframe.ts` mirrors `ai/reframe.rs`) | What is seen is what is exported | Keep the two files in step |
| 64 | Splitting makes a second clip over the same source; no video is copied. There is no undo for trim or split | Cheap and non-destructive: drag the handle back to restore a range | Clip edit history |
| 65 | The installer holds only AutoKlipper. FFmpeg, yt-dlp, Python and models are installed by the user or downloaded on their click | No GPL redistribution, small installer | Bundle LGPL builds |
| 66 | `scripts/notices.mjs` builds the third-party notices and installer licence page from what is installed; run `npm run notices` after changing dependencies | No extra tool | cargo-about |
| 67 | A setup guide opens on first start and records `setupDone`; the dashboard keeps a reminder while something is missing | New users need tools and a model before captions work | One-click tool installation |
| 13 | The reference screenshot was not attached to the prompt | Visual direction follows the written description (navy, layered blue, glow, compact sidebar) | User supplies the image |
