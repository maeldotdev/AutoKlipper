# Developing AutoKlipper

The browser preview (`npm run dev`) uses sample data and processes nothing. The desktop app does the real work.

## Run
```powershell
npm install
npm run dev          # browser preview at http://localhost:1420
npm run tauri dev    # desktop app (needs Rust and the MSVC build tools)
```

## Checks
```powershell
npx tsc -b
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Tools AutoKlipper needs
FFmpeg (video) and yt-dlp (links) are not bundled yet. Install with `winget install Gyan.FFmpeg` and `winget install yt-dlp.yt-dlp`, or choose the .exe in Settings, Processing. Developers can point `CLIPIT_YTDLP` at a yt-dlp.exe.

## End-to-end tests against the real desktop app
```powershell
npm run tauri dev -- --config scripts/debug-window.json
node scripts/e2e-desktop.mjs  <path to any 20 s video>
node scripts/e2e-phase4.mjs   <path to any video>      # needs network
```

## Local AI
Needs Python 3.9 to 3.13 (`winget install Python.Python.3.12`). In the app: Settings, AI, Set up local AI, then download a model. Phase 5 end-to-end test (see the header of the script for setup):
```powershell
node scripts/e2e-phase5.mjs <speech video> <models folder>
```

Phase 6 test with a locally generated stream (nothing on the internet is recorded):
```powershell
node scripts/e2e-phase6.mjs <speech video> <empty work folder>
```

## Moving AutoKlipper to another drive
Settings, General moves large files only. To move everything (database, settings, logs, AI environment): close AutoKlipper, copy the contents of `%APPDATA%\app.clipit.desktop` to the new folder, then put `{ "root": "F:\\CLIPIT" }` in `%APPDATA%\app.clipit.desktop\location.json`.

See ARCHITECTURE.md, DESIGN_SYSTEM.md, COMPONENT_GUIDELINES.md, DECISIONS.md and DEVELOPMENT_PHASES.md in the project root.

Phase 7 test (face tracking and the editor; installs face tracking if missing). The first video shows one face moving left to right:

```powershell
node scripts/e2e-phase7.mjs <face video> <video with sound> <empty work folder> <AI venv python>
```

## Installer

```powershell
npm run notices
```

```powershell
npx tauri build
```

The installer is written to `src-tauri/target/release/bundle/nsis/`.
