# Design system

Source of truth: `src/index.css` (tokens) and `src/components/ui`. Direction: deep navy, layered blue surfaces, one electric blue accent, a soft blue light at the top of the window. Cyan, green, amber and red are used only for meaning.

## Typography
Primary face: **Geist Variable** (self-hosted through Fontsource). It is neutral, tight and readable at 12 to 14 px, which suits a dense desktop tool. Timecodes use the system mono stack (Cascadia Mono).
Cormorant Garamond and Anton load only as caption-preset fonts (Cinematic, Gaming). The UI never uses them.

| Role | Size | Weight |
| --- | --- | --- |
| Page title | 22 px | 600 |
| Section heading | 15 px | 600 |
| Card title, body | 13 px | 500 / 400 |
| Label | 12 px | 500 |
| Meta | 11 px | 400 |

Labels are sentence case and untracked. No tracked capitals.

## Colour tokens (Midnight theme)
| Token | Value | Use |
| --- | --- | --- |
| `--bg-app` | #070b16 | window |
| `--bg-chrome` | #080d1a | title bar, sidebar |
| `--surface-1/2/3` | #0d1424 / #121b30 / #18233e | panels, controls, raised |
| `--accent` | #4d8dff (user changeable) | actions, focus, active |
| `--cyan` | #22d3ee | secondary accent |
| `--success/warning/danger` | #3ecf8e / #f5b942 / #f2706f | state only |

Themes: Midnight (default), Abyss (darker), Slate (blue grey). Accent is set at runtime from Settings; its foreground colour is computed for contrast.

## Spacing, radius, elevation
- Control height 34 px (30 px compact). Panel padding 18 px (14 compact). Grid gap 16 px (12 compact).
- Radius 6 / 9 / 13 px. Panels use 13 px. Controls use 9 px.
- Elevation is surface colour plus a hairline border. Popovers add `--shadow-pop`.

## States
- Focus: 2 px accent outline, shown instantly, on every interactive element.
- Hover: surface step up. Active: 1 px press. Disabled: 45% opacity.
- Motion: transform and opacity only, 120 to 200 ms, ease-out. `prefers-reduced-motion` and the in-app "Off" setting collapse all motion.

## Components
Button (primary, secondary, outline, ghost, danger; sm, md, lg, icon), Input and Field (label above, hint or error below), Select, Switch, Slider (single and range), Segmented, Chip, Tabs, Dialog, ConfirmDialog (required for destructive actions), Menu, Popover, Tooltip, Toast, Badge, Progress, Skeleton, EmptyState.

## Icons
Lucide React, 15 to 20 px, default stroke. Lucide no longer ships brand logos, so platforms use a monogram chip (`PlatformMark`).

## Imagery
No stock photos and no fake video stills. Thumbnails are generated gradients with a film glyph and are labelled as placeholders where it matters.
