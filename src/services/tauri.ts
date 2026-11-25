import { invoke } from '@tauri-apps/api/core'
import type { LiveRequest, LiveService, AiService, AnalyzeRequest, AppInfo, TranscriptDoc, ConnectorInfo, DownloadRequest, FfmpegStatus, LibraryService, MediaInfo, MediaService, SystemService, ToolStatus, UrlInfo, UsageItem } from './types'
import type { CaptionSegment, Clip, Job, Project } from '@/types'

/** Real backend. Each method is one Tauri command; errors arrive as plain strings. */
export const tauriLibrary: LibraryService = {
  listProjects: () => invoke<Project[]>('list_projects'),
  listClips: () => invoke<Clip[]>('list_clips'),
  listJobs: () => invoke<Job[]>('list_jobs'),
  // The Live Clipper keeps its stream list in settings; there is no table for it.
  listStreams: async () => [],
  createProject: (project) => invoke('create_project', { project }),
  setProjectStatus: (id, status) => invoke('set_project_status', { id, status }),
  deleteProject: (id) => invoke('delete_project', { id }),
  createClips: (clips) => invoke('create_clips', { clips }),
  updateClip: (id, patch) => invoke('update_clip', { id, patch }).then(() => undefined),
  deleteClips: (ids) => invoke<number>('delete_clips', { ids }).then(() => undefined),
  saveJob: (job) => invoke('save_job', { job }),
  clearFinishedJobs: () => invoke<number>('clear_finished_jobs').then(() => undefined),
}

export const tauriMedia: MediaService = {
  ffmpegStatus: () => invoke<FfmpegStatus>('ffmpeg_status'),
  probe: (path) => invoke<MediaInfo>('probe_media', { path }),
  exportClips: (request) => invoke<string[]>('export_clips', { request }),
  cancelJob: (id) => invoke<boolean>('cancel_job', { id }),
  reveal: (path) => invoke('reveal_path', { path }),
  ytdlpStatus: () => invoke<ToolStatus>('ytdlp_status'),
  connectors: () => invoke<ConnectorInfo[]>('list_connectors'),
  probeUrl: (url) => invoke<UrlInfo>('probe_url', { url }),
  startDownload: (request: DownloadRequest) => invoke<string>('start_download', { request }),
  audioPeaks: (path, start, end, buckets) => invoke<number[]>('audio_peaks', { path, start, end, buckets }),
}

export const tauriAi: AiService = {
  status: () => invoke('ai_status'),
  setup: () => invoke<string>('ai_setup'),
  downloadModel: (model) => invoke<string>('ai_download_model', { model }),
  downloadSpeakers: () => invoke<string>('ai_download_speakers'),
  analyze: (request: AnalyzeRequest) => invoke<string>('analyze_project', { request }),
  getTranscript: (projectId) => invoke<TranscriptDoc | null>('get_transcript', { projectId }),
  saveTranscript: (projectId, segments: CaptionSegment[]) => invoke('save_transcript', { projectId, segments }),
  ollamaModels: () => invoke<string[]>('ollama_models'),
  setupFace: () => invoke<string>('ai_setup_face'),
  trackFaces: (clipId) => invoke<[number, number][]>('track_faces', { clipId }),
}

export const tauriLive: LiveService = {
  start: (request: LiveRequest) => invoke('live_start', { request }),
  stop: (id) => invoke<boolean>('live_stop', { id }),
  clipNow: (id, seconds) => invoke('live_clip_now', { id, seconds }),
  running: () => invoke<string[]>('live_running'),
}

export const tauriSystem: SystemService = {
  info: () => invoke<AppInfo>('app_info'),
  loadSettings: () => invoke<Record<string, unknown>>('load_settings'),
  patchSettings: (patch) => invoke('patch_settings', { patch }).then(() => undefined),
  storageUsage: () => invoke<UsageItem[]>('storage_usage'),
  cleanStorage: (target) => invoke<number>('clean_storage', { target }),
  log: (level, message) => void invoke('frontend_log', { level, message }).catch(() => undefined),
}
