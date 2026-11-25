# Development phases

Per-phase exit checklist: build, type check, lint, test key interactions, inspect the UI, fix, document what is unfinished.

## Phase 0, foundation (done)
Tauri 2 shell compiles (`cargo check`). Vite + React + TypeScript. Tailwind 4. Lucide. Folder structure. Docs.

## Phase 1, design system and frontend (done, awaiting approval)
All ten pages plus Clip Editor, six caption presets with live customisation, template gallery, mock services, command palette, themes, accent colour, density, keyboard shortcuts.

## Phase 2, backend foundation (done, awaiting approval)
Tauri commands, SQLite (projects, clips, jobs), settings file, logging, file management, typed `invoke` wrappers behind the same service interface. Not in Phase 2: caption segments and saved presets still live in browser storage; they move to SQLite with the caption engine (Phase 5).

## Phase 3, video engine (done, awaiting approval)
FFmpeg discovery, probe, cut, reframe, export options, job queue with concurrency from Settings. Not in Phase 3: caption burn-in (needs the Phase 5 transcript), FFmpeg bundling (Phase 8), audio-only or lossless export.

## Phase 4, connectors (done, awaiting approval)
yt-dlp integration, one connector per platform (YouTube, Twitch, Kick, TikTok, Facebook, generic), access and permission checks with clear errors. Not in Phase 4: livestream capture (Phase 6), playlist or channel import, sign-in inside AutoKlipper, yt-dlp bundling and self-update (Phase 8).

## Phase 5, local AI (done, awaiting approval)
Faster-Whisper with word timestamps, model download and storage, speaker detection, highlight scoring, optional Ollama, caption burn-in and SRT. Not in Phase 5: saved caption presets in the database (still browser storage), bundled Python and fonts (Phase 8), face tracking (Phase 7).

## Phase 6, live clipping (done, awaiting approval)
Stream monitor, rolling buffer, continuous transcription, retroactive clip extraction, multiple streams. Not in Phase 6: chat-activity signals, live captions on screen, automatic export of live clips, testing against real platform broadcasts.

## Phase 7, professional editor (done, awaiting approval)
Timeline editing on real media (waveform, split, shortcuts, zoom), face tracking and crop automation, per-clip framing, batch rendering. Not in Phase 7: active speaker detection, undo for trim and split, dragging caption blocks on the timeline, joining clips, saved caption presets in the database.

## Phase 8, release (done, awaiting approval)
Performance and memory work, CPU and GPU tuning, installer (NSIS), dependency packaging, QA on Windows 10 and 11.
Not done: code signing, auto-update, testing on Windows 10 or a clean PC, memory profiling.
