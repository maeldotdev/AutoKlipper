# AutoKlipper project plan

AutoKlipper is a local-first Windows desktop studio that finds interesting moments in long videos and livestreams, cuts short clips, adds animated captions and prepares them for social platforms.

## Goals
- Real desktop app (Tauri 2), not a website in a window.
- Everything runs on the user's machine. No mandatory cloud service. Captions use Faster-Whisper and FFmpeg locally.
- Premium, consistent interface built on one design system.

## Status
| Phase | Scope | State |
| --- | --- | --- |
| 0 | Foundation: Tauri 2, React, Vite, Tailwind, docs | Done |
| 1 | Design system and complete frontend prototype with mock data | Done |
| 2 | Tauri commands, SQLite, config, logging, file management | Done |
| 3 | FFmpeg video engine | Done |
| 4 | yt-dlp and platform connectors | Done |
| 5 | Local AI: Faster-Whisper, highlight scoring, optional Ollama | Done |
| 6 | Live clipping engine | Done |
| 7 | Professional clip editor (timeline, face tracking, batch render) | Done |
| 8 | Optimisation, installer, QA | Done, awaiting approval |

One phase at a time. Each phase ends with build, type check, lint, interaction tests and a report. The next phase starts only after explicit approval.

## Ownership
- Opus 5.5: design, frontend architecture, design system, React and TypeScript.
- Sonnet 5.5: Rust and Tauri, FFmpeg, Faster-Whisper, yt-dlp, SQLite, queues, connectors, backend tests.
- Sonnet follows the design system and does not redesign UI.

## Rules that hold in every phase
- Mock data is labelled as mock in the UI. A mock never claims a real video was processed.
- Each platform gets its own connector. Respect terms, permissions, authentication and copyright.
- Do not add dependencies before the phase that needs them.
