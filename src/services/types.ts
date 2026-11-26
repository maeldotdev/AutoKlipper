import type { CaptionSegment, CaptionStyle, Clip, Job, LiveStream, Project, Sfx } from '@/types'

export type ClipPatch = Partial<Pick<Clip, 'title' | 'startSec' | 'endSec' | 'aspect' | 'target' | 'captions' | 'exportStatus' | 'cropX' | 'zoom' | 'track' | 'split' | 'hook' | 'cuts' | 'layout' | 'filters' | 'post' | 'sfx'>>

export interface SoundService {
  /** File names in the user's Sounds folder. */
  list(): Promise<string[]>
  folder(): Promise<string>
  /** Full path of one sound, allowed for playback. */
  file(name: string): Promise<string>
  /** Choose sounds for a clip again. Saved by the backend. */
  suggest(clipId: string): Promise<Sfx[] | null>
}

export interface AppPathsInfo {
  root: string
  warning: string | null
  data: string
  dbFile: string
  settingsFile: string
  logs: string
  cache: string
  temp: string
  models: string
  exports: string
}
export interface AppInfo {
  version: string
  schemaVersion: number
  paths: AppPathsInfo
}
export interface UsageItem {
  id: string
  label: string
  bytes: number
}

/** Library data. Mutations resolve when the data is stored. */
export interface LibraryService {
  listProjects(): Promise<Project[]>
  listClips(): Promise<Clip[]>
  listJobs(): Promise<Job[]>
  listStreams(): Promise<LiveStream[]>
  createProject(p: Project): Promise<void>
  setProjectStatus(id: string, status: Project['status']): Promise<void>
  deleteProject(id: string): Promise<void>
  createClips(clips: Clip[]): Promise<void>
  updateClip(id: string, patch: ClipPatch): Promise<void>
  setCredit(projectId: string, name: string): Promise<void>
  deleteClips(ids: string[]): Promise<void>
  saveJob(job: Job): Promise<void>
  clearFinishedJobs(): Promise<void>
}

export interface MediaInfo {
  path: string
  durationSec: number
  sizeBytes: number
  width: number
  height: number
  fps: number
  videoCodec: string
  audioCodec: string | null
  hasAudio: boolean
  container: string
}
export interface FfmpegStatus {
  found: boolean
  version: string | null
  ffmpegPath: string | null
  ffprobePath: string | null
  hardwareEncoders: string[]
}
export interface ExportRequest {
  clipIds: string[]
  resolution: number
  fps: number
  quality: 'fast' | 'balanced' | 'high'
  device: 'auto' | 'cpu' | 'gpu'
  outDir: string | null
  concurrency: number
  burnCaptions: boolean
  writeSrt: boolean
  style: CaptionStyle | null
}
export interface ToolStatus {
  found: boolean
  version: string | null
  path: string | null
}
export interface ConnectorInfo {
  id: string
  name: string
  recorded: boolean
  livePlanned: boolean
  notice: string
}
export interface UrlInfo {
  url: string
  connectorId: string
  connectorName: string
  notice: string
  kind: 'video' | 'live'
  title: string
  durationSec: number | null
  uploader: string | null
  thumbnail: string | null
  isLive: boolean
  extractor: string | null
  heights: number[]
  sizeBytesApprox: number | null
  downloadable: boolean
  blockReason: string | null
}
export interface DownloadRequest {
  projectId: string
  url: string
  /** 0 means the best quality offered. */
  maxHeight: number
  concurrency: number
  confirmedRights: boolean
}

/** Real video work: probing, downloading and rendering. Desktop app only. */
export interface MediaService {
  ffmpegStatus(): Promise<FfmpegStatus | null>
  probe(path: string): Promise<MediaInfo>
  exportClips(req: ExportRequest): Promise<string[]>
  cancelJob(id: string): Promise<boolean>
  reveal(path: string): Promise<void>
  ytdlpStatus(): Promise<ToolStatus | null>
  connectors(): Promise<ConnectorInfo[]>
  probeUrl(url: string): Promise<UrlInfo>
  startDownload(req: DownloadRequest): Promise<string>
  /** Loudness shape of part of a video, values 0..1. */
  audioPeaks(path: string, start: number, end: number, buckets: number): Promise<number[]>
}

export interface AiStatus {
  pythonFound: boolean
  pythonVersion: string | null
  ready: boolean
  fasterWhisper: string | null
  sherpaOnnx: string | null
  gpus: number
  models: string[]
  speakerModels: boolean
  faceReady: boolean
}
export interface AnalyzeRequest {
  projectId: string
  options: { minLen: number; maxLen: number; count: number; moments: string[]; sensitivity: number }
  aspect: Clip['aspect']
  target: Clip['target']
  captions: boolean
  model: string
  language: string
  speakers: boolean
  ollamaModel: string | null
  concurrency: number
}
export interface TranscriptDoc {
  language: string
  model: string
  segments: CaptionSegment[]
}
/** Local AI: setup, models, transcription and highlights. Desktop app only. */
export interface AiService {
  status(): Promise<AiStatus | null>
  setup(): Promise<string>
  downloadModel(model: string): Promise<string>
  downloadSpeakers(): Promise<string>
  analyze(req: AnalyzeRequest): Promise<string>
  getTranscript(projectId: string): Promise<TranscriptDoc | null>
  saveTranscript(projectId: string, segments: CaptionSegment[]): Promise<void>
  ollamaModels(): Promise<string[]>
  /** Write the clip's post text again. Saved by the backend. */
  writePost(clipId: string): Promise<string | null>
  setupFace(): Promise<string>
  trackFaces(clipId: string): Promise<[number, number][]>
  /** A first guess at the camera overlay: x, y, width, height. */
  guessCamera(clipId: string): Promise<[number, number, number, number]>
  findCuts(clipId: string): Promise<{ cuts: [number, number][]; pauses: number; fillers: number; seconds: number }>
  /** A cached frame for a card, or null when the video is not on this PC. */
  thumbnail(projectId: string, clipId?: string): Promise<string | null>
}

export interface LiveRequest {
  id: string
  url: string
  confirmedRights: boolean
  model: string
  language: string
  autoClip: boolean
  bufferMinutes: number
  minLen: number
  maxLen: number
  moments: string[]
  sensitivity: number
  aspect: Clip['aspect']
  target: Clip['target']
  maxHeight: number
}
export interface LiveUpdate {
  sessionId: string
  kind: 'connecting' | 'monitoring' | 'reconnecting' | 'tick' | 'found' | 'ready' | 'failed' | 'warning' | 'ended'
  message?: string | null
  uptimeSec?: number | null
  bufferedSec?: number | null
  thumbnail?: string | null
  transcribing?: boolean | null
  n?: number | null
  atSec?: number | null
  score?: number | null
  label?: string | null
  title?: string | null
  projectId?: string | null
}
/** Live monitoring. Desktop app only; updates arrive as `live-update` events. */
export interface LiveService {
  start(req: LiveRequest): Promise<void>
  stop(id: string): Promise<boolean>
  clipNow(id: string, seconds: number): Promise<void>
  running(): Promise<string[]>
}

/** App-level services: config, files, logging. */
export interface SystemService {
  info(): Promise<AppInfo | null>
  loadSettings(): Promise<Record<string, unknown>>
  patchSettings(patch: Record<string, unknown>): Promise<void>
  /** Windows file dialog for a program. Saved by the backend; null when cancelled. */
  chooseTool(tool: 'ffmpeg' | 'ytdlp'): Promise<string | null>
  storageUsage(): Promise<UsageItem[] | null>
  cleanStorage(target: 'cache' | 'temp'): Promise<number>
  log(level: 'info' | 'warn' | 'error', message: string): void
}
