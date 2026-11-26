import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlatformId, Split } from '@/types'

export type ThemeId = 'midnight' | 'abyss' | 'slate'
export type Density = 'comfortable' | 'compact'
export type MotionPref = 'system' | 'reduced' | 'off'

export interface Settings {
  theme: ThemeId
  accent: string
  density: Density
  motion: MotionPref
  sidebarCollapsed: boolean
  exportFolder: string
  startup: 'dashboard' | 'last-page'
  notifications: boolean
  /** Write a caption, hashtags and credit for every new clip. */
  postCaptions: boolean
  /** Put sounds from the Sounds folder on new clips. */
  autoSounds: boolean
  /** Hashtags added to every post. */
  postTags: string
  device: 'auto' | 'cpu' | 'gpu'
  quality: 'fast' | 'balanced' | 'high'
  concurrency: number
  model: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'
  modelFolder: string
  language: string
  sensitivity: number
  autoCleanup: boolean
  cacheCapGb: number
  /** Optional ffmpeg.exe chosen by the user. Empty means auto-detect. */
  ffmpegPath: string
  /** Optional yt-dlp.exe chosen by the user. Empty means auto-detect. */
  ytdlpPath: string
  /** Browser whose sign-in yt-dlp may borrow. Empty means never. */
  cookiesBrowser: '' | 'chrome' | 'edge' | 'firefox' | 'brave'
  speakerDetection: boolean
  /** Folder for large files (downloads, exports, models, temp). Empty means app data. Applies after restart. */
  dataFolder: string
  /** Streams the user added to the Live Clipper (desktop app). */
  liveStreams: { id: string; platform: PlatformId; url: string; title: string }[]
  liveBufferMinutes: number
  liveAutoClip: boolean
  liveQuality: number
  ollamaEnabled: boolean
  ollamaModel: string
  /** The first-run setup was finished or skipped. */
  setupDone: boolean
  /** Look for a newer version when the app starts. */
  checkUpdates: boolean
  /** Closing the window keeps the app running in the system tray (desktop app). */
  closeToTray: boolean
  /** A gaming layout the user saved, to put on other clips. */
  savedLayout: { split: Split; cropX: number; zoom: number } | null
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'midnight',
  accent: '#4d8dff',
  density: 'comfortable',
  motion: 'system',
  sidebarCollapsed: false,
  exportFolder: 'C:\\Users\\Public\\Videos\\AutoKlipper',
  startup: 'dashboard',
  notifications: true,
  postCaptions: true,
  autoSounds: true,
  postTags: '#fyp #foryou #viral #shorts',
  device: 'auto',
  quality: 'balanced',
  concurrency: 2,
  model: 'small',
  modelFolder: '%APPDATA%\\AutoKlipper\\models',
  language: 'auto',
  sensitivity: 60,
  autoCleanup: true,
  cacheCapGb: 20,
  ffmpegPath: '',
  ytdlpPath: '',
  cookiesBrowser: '',
  speakerDetection: true,
  dataFolder: '',
  liveStreams: [],
  liveBufferMinutes: 10,
  liveAutoClip: true,
  liveQuality: 720,
  ollamaEnabled: false,
  ollamaModel: '',
  setupDone: false,
  checkUpdates: true,
  closeToTray: true,
  savedLayout: null,
}

/** Real folder paths from the backend, set once at startup in the desktop app. */
let runtimeDefaults: Partial<Settings> = {}
export const setRuntimeDefaults = (d: Partial<Settings>) => {
  runtimeDefaults = d
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void
  reset: () => void
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      reset: () => set((s) => ({ ...DEFAULT_SETTINGS, ...runtimeDefaults, setupDone: s.setupDone })),
    }),
    { name: 'clipit.settings', version: 1 },
  ),
)

export const ACCENTS = [
  { id: 'blue', label: 'Electric blue', value: '#4d8dff' },
  { id: 'cyan', label: 'Cyan', value: '#22d3ee' },
  { id: 'violet', label: 'Violet', value: '#8b7bff' },
  { id: 'emerald', label: 'Emerald', value: '#34d399' },
  { id: 'amber', label: 'Amber', value: '#f5b942' },
  { id: 'rose', label: 'Rose', value: '#fb7185' },
]

/** Pick dark or light foreground for a given accent so buttons stay readable. */
export function accentForeground(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return L > 0.3 ? '#06101f' : '#ffffff'
}
