# AutoKlipper: costs, licences and what to do before release

Checked 2026-11-25. This is not legal advice. Prices and terms change, so open the links again before you release. If you plan to sell AutoKlipper, pay a lawyer for one review.

## 1. Does AutoKlipper cost money?

**Using it: no.** There is no paid service, API key, account or subscription in the app. Transcription, highlight finding, face tracking and rendering run on your PC.

| Part | What it does | Price | Licence |
| --- | --- | --- | --- |
| AutoKlipper's libraries (Tauri, React, Rust crates, npm packages) | The app itself | Free | MIT, Apache-2.0, BSD, ISC, Zlib, Unicode; five Rust crates are MPL-2.0 |
| Fonts: Geist, Anton, Cormorant Garamond | Interface and captions preview | Free | SIL OFL 1.1 |
| yt-dlp | Downloads from links | Free | Source: Unlicense. The Windows .exe: GPLv3+ |
| FFmpeg (the gyan.dev "full" build on your PC) | Cutting and rendering | Free | GPLv3 |
| Python | Runs the AI helper | Free | PSF |
| faster-whisper, CTranslate2 | Speech to text | Free | MIT |
| Whisper models (Systran conversions) | Speech to text | Free | Listed as MIT; confirm on each model page |
| sherpa-onnx | Speaker detection | Free | Apache-2.0 |
| pyannote segmentation 3.0 model | Speaker detection | Free | MIT |
| NeMo TitaNet-small model | Speaker detection | Free to download | **Not confirmed.** See section 5 |
| OpenCV, YuNet face model | Face tracking | Free | Apache-2.0; YuNet is listed as MIT |
| Ollama (optional) | Second opinion on highlights | Free on your PC | MIT; each model has its own licence |
| NSIS | Builds the installer | Free | zlib |
| WebView2 | Draws the window | Free | Microsoft's terms |

**Things that could cost money. None is required.**

| Item | When you would pay | Free choice |
| --- | --- | --- |
| Code signing certificate | To remove the "Unknown publisher" warning | Release unsigned and tell users about the warning |
| Website domain | If you want your own address | GitHub page and GitHub Releases |
| Ollama cloud models | If you pick a cloud model inside Ollama | Use only models downloaded to your PC |
| Video patent fees | Large distribution of H.264, see section 5 | Not expected at hobby scale |

**How not to spend by accident**
- Never start a cloud signing service "to try it": Azure Artifact Signing is reported to bill from the moment the account is created, even if identity checks fail.
- AutoKlipper needs no API key. If anything asks for one or for a card, stop.
- Do not add a payment method to Ollama or Hugging Face. AutoKlipper does not need it.

## 2. The one rule that keeps the installer simple

**Ship only AutoKlipper. Do not put yt-dlp, FFmpeg, Python or AI models inside the installer.** The user installs them, or clicks a button in AutoKlipper that downloads them from the official source.

Why:
- The yt-dlp .exe and your FFmpeg build are GPL. If you hand them out, you must also give their licence texts and offer the matching source code.
- An FFmpeg build without GPL parts exists, but it has no libx264, which AutoKlipper uses for CPU export.
- Models and Python make the installer very large.

This is how AutoKlipper already works today.

## 3. Decisions
| Decision | Answer (2026-11-26) |
| --- | --- |
| Open source or closed | Open source |
| Publisher name | maeldotdev |
| Country in the terms | Left out. It is optional; it only matters later if you buy code signing |
| Which open source licence | MIT (see `LICENSE`). Anyone may use, copy, change, share or sell it if they keep the copyright notice |
| App name | AutoKlipper (was CLIPIT, then briefly Klipper) |
| Speaker detection | Kept |
| Contact for users | Not chosen. A GitHub issues page works and keeps your email private |
| Free or paid | Free |

Open source may qualify for free signing from [SignPath Foundation](https://signpath.org/terms) if every part is open source licensed and builds are automated.

## 4. Steps to release

1. Finish the open items in section 3.
2. Check that the name "AutoKlipper" is free to use. A web search on 2026-11-26 found no project with that exact name; many tools are called "AutoClipper", and "Klipper" alone is a well-known 3D printer firmware. The Microsoft Store, domain names and trademark databases have not been checked.
3. Fill in the `[brackets]` in `legal/TERMS_OF_USE.md`.
4. Phase 8 builds the installer with: the licence and terms shown during setup, `THIRD_PARTY_NOTICES` with the full licence texts, an About screen listing them, and a first-run check for FFmpeg, yt-dlp and Python.
5. Test the installer on a clean Windows PC.
6. Publish the installer with its SHA-256 checksum, the terms and a short privacy statement.

**Signing, if you want it later**
- Unsigned: free. Windows SmartScreen warns users.
- [Azure Artifact Signing](https://www.devclass.com/security/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/4079554): reported at about USD 9.99 a month; individuals only in the USA and Canada.
- Certificate from a certificate authority: yearly fee, check current prices.
- SignPath Foundation: free, only for fully open source projects with automated builds.
- Microsoft Store: registration is [free for individuals](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-individual-developer), but an .exe installer [must still be signed by you](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements) and must install offline.

## 5. Risks to know

- **Platform terms.** [YouTube's terms](https://www.youtube.com/t/terms) do not allow downloading unless YouTube allows it or you have written permission. Twitch, Kick, TikTok and Facebook have their own rules. Owning the rights to a video does not always cancel the platform's rule. Safest: your own files, or content you have written permission for. A tool that downloads from these sites can also be refused by app stores or draw complaints.
- **Copyright.** Posting clips of other people's videos can lead to strikes or claims, even with credit.
- **TitaNet-small licence.** NVIDIA's page points to the NeMo toolkit licence and I could not confirm more. Read the [model page](https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/titanet_small) before a public release, or drop speaker detection.
- **H.264 patents.** Free software licences do not include patent rights. The pool lists [no royalty for the first 100,000 units a year](https://www.via-la.com/licensing-2/avc-h-264/avc-h-264-license-fees). Ask a lawyer if you sell at scale.
- **Selling.** The libraries above allow commercial use if you keep their notices. Selling a downloader for platform video raises the legal risk a lot.

## 6. Where release stands (2026-11-26)

**Publishing to GitHub.** The folder is a git repository with a first commit. Nothing has been uploaded.

**Free code signing (SignPath Foundation).** Only you can apply. In order: publish the repository publicly, add an automated build (GitHub Actions) that makes the installer from the source, add the code signing policy text their [terms](https://signpath.org/terms) ask for, turn on two-factor sign-in, then apply. Until then the installer is unsigned and Windows warns about it.

**Clean PC test.** Windows Sandbox is not turned on here. To use it: Windows Features, "Windows Sandbox", restart, then run the installer inside it. Windows 10 needs a Windows 10 machine or virtual machine.

**Speaker model.** The TitaNet-small licence is still unconfirmed. A replacement with an Apache-2.0 label is the 3D-Speaker CAM++ model; switching needs a download and a test.

