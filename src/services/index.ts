import { tauriSounds } from './tauri'
import type { SoundService } from './types'
/*
 * Service boundary. Pages and stores talk to `api` only.
 * In the desktop app `api` is the Tauri backend (SQLite, settings file, logs).
 * In a plain browser it is the mock implementation with sample data.
 */
import { MOCK_CLIPS, MOCK_JOBS, MOCK_PROJECTS, MOCK_STREAMS, STORAGE_BREAKDOWN } from '@/mock/library'
import { isTauri } from '@/lib/utils'
import { tauriAi, tauriLive, tauriLibrary, tauriMedia, tauriSystem } from './tauri'
import type { AiService, LiveService, LibraryService, MediaService, SystemService } from './types'

export type { LiveRequest, LiveService, LiveUpdate, AiService, AiStatus, AnalyzeRequest, AppInfo, ClipPatch, TranscriptDoc, ConnectorInfo, DownloadRequest, ExportRequest, FfmpegStatus, LibraryService, MediaInfo, MediaService, SystemService, ToolStatus, UrlInfo, UsageItem } from './types'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const noop = async () => undefined

const mockLibrary: LibraryService = {
  async listProjects() { await wait(450); return structuredClone(MOCK_PROJECTS) },
  async listClips() { await wait(520); return structuredClone(MOCK_CLIPS) },
  async listJobs() { await wait(380); return structuredClone(MOCK_JOBS) },
  async listStreams() { await wait(300); return structuredClone(MOCK_STREAMS) },
  // The mock keeps changes in the stores only; nothing is stored.
  createProject: noop,
  setProjectStatus: noop,
  deleteProject: noop,
  createClips: noop,
  updateClip: noop,
  setCredit: async () => undefined,
  deleteClips: noop,
  saveJob: noop,
  clearFinishedJobs: noop,
}

const mockSystem: SystemService = {
  info: async () => null,
  loadSettings: async () => ({}),
  patchSettings: noop,
  chooseTool: async () => null,
  storageUsage: async () => null,
  cleanStorage: async () => 0,
  log: () => undefined,
}

const unavailable = async (): Promise<never> => {
  throw new Error('Video processing is only available in the desktop app.')
}
const mockMedia: MediaService = {
  ffmpegStatus: async () => null,
  probe: unavailable,
  exportClips: unavailable,
  cancelJob: async () => false,
  reveal: noop,
  ytdlpStatus: async () => null,
  connectors: async () => [],
  probeUrl: unavailable,
  startDownload: unavailable,
  audioPeaks: unavailable,
}

const mockAi: AiService = {
  status: async () => null,
  setup: unavailable,
  downloadModel: unavailable,
  downloadSpeakers: unavailable,
  analyze: unavailable,
  getTranscript: async () => null,
  saveTranscript: noop,
  ollamaModels: unavailable,
  writePost: unavailable,
  setupFace: unavailable,
  trackFaces: unavailable,
  guessCamera: unavailable,
  findCuts: unavailable,
  thumbnail: async () => null,
}

const mockLive: LiveService = {
  start: unavailable,
  stop: async () => false,
  clipNow: unavailable,
  running: async () => [],
}

export const IS_MOCK_BACKEND = !isTauri()
const mockSounds: SoundService = {
  list: async () => [],
  folder: async () => '',
  file: async () => '',
  suggest: async () => null,
}

export const api = IS_MOCK_BACKEND
  ? { library: mockLibrary, system: mockSystem, media: mockMedia, ai: mockAi, live: mockLive, sounds: mockSounds }
  : { library: tauriLibrary, system: tauriSystem, media: tauriMedia, ai: tauriAi, live: tauriLive, sounds: tauriSounds }

export const GB = 1024 ** 3
export const MOCK_USAGE = STORAGE_BREAKDOWN.map((s) => ({ id: s.id, label: s.label, bytes: s.gb * GB }))
