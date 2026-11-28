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

## Local AI
Needs Python 3.11 to 3.13 (`winget install Python.Python.3.12`). In the app: Settings, AI, Set up local AI, then download a model.

The packages are locked with a hash for each file in `src-tauri/ai/requirements/`. To change a version, edit the `.in` file, delete the matching `.txt`, and run this there (for `face`, add `-c base.txt`; for `pip`, use `pip.in`):

```powershell
uv pip compile base.in --universal --python-version 3.11 --custom-compile-command "see docs/DEVELOPMENT.md" --generate-hashes --only-binary :all: -o base.txt
```

## Moving AutoKlipper to another drive
Settings, General moves large files only. To move everything (database, settings, logs, AI environment): close AutoKlipper, copy the contents of `%APPDATA%\app.clipit.desktop` to the new folder, then put `{ "root": "F:\\CLIPIT" }` in `%APPDATA%\app.clipit.desktop\location.json`.

## Installer

```powershell
npm run notices
```

```powershell
npx tauri build
```

The installer is written to `src-tauri/target/release/bundle/nsis/`.
