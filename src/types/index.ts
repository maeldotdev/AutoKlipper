export type PlatformId = 'youtube' | 'twitch' | 'kick' | 'tiktok' | 'facebook' | 'generic'
export type AspectRatio = '9:16' | '1:1' | '4:5' | '16:9'
export type TargetPlatform = 'tiktok' | 'shorts' | 'reels' | 'fb-reels'

export type ProjectStatus = 'ready' | 'processing' | 'failed' | 'draft'
export interface Project {
  id: string
  title: string
  sourceKind: 'file' | 'url' | 'live'
  sourceLabel: string
  platform: PlatformId | 'local'
  duration: number
  status: ProjectStatus
  createdAt: string
  clipCount: number
  hue: number
  sizeBytes: number
  /** Absolute path of the source video on this PC (desktop app only). */
  sourcePath?: string | null
  /** Who made the source video, for the credit line of a post. */
  uploader?: string | null
}

export type ExportStatus = 'not-exported' | 'queued' | 'exporting' | 'exported' | 'failed'
export type CaptionStatus = 'none' | 'generated' | 'styled'
export interface Clip {
  id: string
  projectId: string
  title: string
  startSec: number
  endSec: number
  aspect: AspectRatio
  target: TargetPlatform
  captions: CaptionStatus
  exportStatus: ExportStatus
  score: number
  hue: number
  createdAt: string
  /** Where the rendered file was written. */
  exportPath?: string | null
  /** Why highlight detection picked this clip. */
  reason?: string | null
  /** Framing: 0 left, 50 centre, 100 right. */
  cropX?: number
  zoom?: number
  /** Face-following path, [source seconds, face centre 0..1]. Replaces cropX. */
  track?: [number, number][] | null
  /** Gaming layout on vertical clips: game on top, camera below. */
  split?: Split | null
  /** Headline at the top of the picture. */
  hook?: string | null
  /** Parts removed from the clip, [from, to] in source seconds. */
  cuts?: [number, number][] | null
  /** Where the user dragged the captions and the hook title. */
  layout?: TextLayout | null
  filters?: Filters | null
  /** Caption, hashtags and credit, ready to paste. */
  post?: string | null
  /** Sound effects from the user's Sounds folder. */
  sfx?: Sfx[] | null
}

/** One sound effect: file name, start in source seconds, volume 0..1. */
export interface Sfx {
  file: string
  at: number
  volume: number
}

/** Centre across and position down, 0..100 of the picture, and a size factor. */
export interface TextPlace {
  x: number
  y: number
  scale: number
}
export interface TextLayout {
  cap?: TextPlace | null
  hook?: TextPlace | null
}
export type Look = 'none' | 'brighten' | 'vivid' | 'warm' | 'cool' | 'mono'
export interface Filters {
  look: Look
  strength: number
  sharpen: boolean
  denoise: boolean
  voice: boolean
}

/** The camera box in the source picture (0..1) and its share of the output height. A share of 0 is off. */
export interface Split {
  x: number
  y: number
  w: number
  h: number
  share: number
  /** Up and down position of the game picture, 0..1. Matters when it is zoomed in. */
  gy?: number
  /** Swapped: camera on top, game below. */
  top?: boolean
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'
export type JobKind = 'download' | 'detect' | 'transcribe' | 'render' | 'export'
export interface Job {
  id: string
  title: string
  kind: JobKind
  status: JobStatus
  progress: number
  source: string
  startedAt: string
  durationSec: number
  error?: string
  simulated: boolean
}

export type StreamState = 'idle' | 'connecting' | 'monitoring' | 'reconnecting' | 'error'
export interface LiveHighlight {
  id: string
  atSec: number
  label: string
  score: number
  clipState: 'queued' | 'rendering' | 'ready' | 'failed'
  /** Desktop app: the project holding the saved clip. */
  projectId?: string
  title?: string
}
export interface LiveStream {
  id: string
  platform: PlatformId
  url: string
  title: string
  state: StreamState
  uptimeSec: number
  highlights: LiveHighlight[]
  /** Last warning or error for the user. */
  message?: string
  bufferedSec?: number
  /** Latest frame of the stream, as a file path. */
  thumbnail?: string
  transcribing?: boolean
}

/* ---------------- captions ---------------- */
export interface CaptionWord {
  id: string
  text: string
  start: number
  end: number
  keyword?: boolean
}
export interface CaptionSegment {
  id: string
  start: number
  end: number
  words: CaptionWord[]
}

export type CaptionAnimation =
  | 'none'
  | 'word-reveal'
  | 'karaoke'
  | 'pop-in'
  | 'scale-emphasis'
  | 'fade'
  | 'slide-up'
  | 'typewriter'
  | 'keyword-emphasis'
export type HighlightBehavior = 'none' | 'active-word' | 'keywords' | 'karaoke-fill'
export type CaptionFont = 'geist' | 'geist-mono' | 'serif' | 'impact'

export interface CaptionStyle {
  font: CaptionFont
  size: number // % of frame height * 10 => 52 means 5.2% of height
  weight: number
  uppercase: boolean
  color: string
  highlightColor: string
  outlineWidth: number
  outlineColor: string
  shadow: number
  bgEnabled: boolean
  bgColor: string
  bgOpacity: number
  radius: number
  letterSpacing: number
  lineHeight: number
  align: 'left' | 'center' | 'right'
  posY: number // 0..100 vertical centre of caption block, % of frame height
  maxWords: number
  maxLines: number
  animSpeed: number // 0.5..2
  animation: CaptionAnimation
  highlight: HighlightBehavior
}

export interface CaptionPreset {
  id: string
  name: string
  blurb: string
  style: CaptionStyle
  builtIn: boolean
}

export type TemplateKind = 'caption' | 'animation' | 'typography' | 'highlight'
export interface Template {
  id: string
  kind: TemplateKind
  name: string
  blurb: string
  patch: Partial<CaptionStyle>
  builtIn: boolean
}
