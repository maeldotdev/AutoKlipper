# Phase 8: optimization and release plan

**Goal:** an installable AutoKlipper 0.1.0. **Spec:** `DEVELOPMENT_PHASES.md` (Phase 8), `RELEASE_GUIDE.md` sections 2 and 4.

**Constraints:** ship only AutoKlipper (no yt-dlp, FFmpeg, Python or models inside the installer); MIT, publisher maeldotdev; no new downloads or publishing without the user's yes; keep identifier `app.clipit.desktop` and existing data folders.

## Tasks
- [x] 1. GPU export: `hardware_encoders` only returns encoders that really encode (done in code, needs tests and rebuild). Then a real `h264_amf` export on the Radeon RX 5500.
- [x] 2. Performance: release profile (`lto`, `strip`, `codegen-units = 1`), lazy-load pages to remove the large chunk warning; exe size recorded (14.1 MB to 13.9 MB); start time not measured.
- [x] 3. Notices: `scripts/notices.mjs` writes `THIRD_PARTY_NOTICES.txt` from `cargo metadata` and `node_modules` licence files; fonts included; no new dependency.
- [x] 4. About screen: version, MIT licence, notices, terms. Fix `Cargo.toml` description and authors.
- [x] 5. First-run check: show missing FFmpeg, yt-dlp and Python with the official `winget` command for each.
- [x] 6. Installer: NSIS, licence page, per-user install. Needs permission: Tauri downloads NSIS and its plugin from GitHub (a few MB). WebView2 is fetched at install time if missing.
- [x] 7. QA: Rust tests, type check, lint, clippy, all end-to-end scripts, then install, run and uninstall. Windows 10 cannot be tested on this PC. Added during the phase: a first-start setup guide.
- [x] 8. Docs and report. Then suggest Securitycheckmael once.

## Review focus
- Install over an existing library must keep it, including `location.json`.
- Uninstall must not delete user videos or exports.
- A PC without FFmpeg must start and explain, not fail.
- GPU selected on a PC without a usable encoder must give a clear message.
- Install path and user name with spaces or non-English letters.

## Open items from the user
Contact for the terms, effective date, and the unconfirmed TitaNet-small model licence.
