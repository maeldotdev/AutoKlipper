import { create } from 'zustand'
import { IS_MOCK_BACKEND, api, type ClipPatch } from '@/services'
import { useSettings } from '@/stores/settings'
import { aiReady, useAi } from '@/stores/ai'
import { useCaptions } from '@/stores/captions'
import { uid } from '@/lib/utils'
import { toast, useUi } from '@/stores/ui'
import type { AspectRatio, Clip, Job, JobKind, PlatformId, Project, TargetPlatform } from '@/types'

type Status = 'idle' | 'loading' | 'ready'

/** Pushed by the backend while a real export runs. */
export interface JobEvent {
  job: Job
  clipId?: string | null
  exportStatus?: Clip['exportStatus'] | null
  exportPath?: string | null
  projectId?: string | null
  projectStatus?: Project['status'] | null
  sourcePath?: string | null
  duration?: number | null
  sizeBytes?: number | null
  clipsAdded?: number | null
  warning?: string | null
}

export interface GenerateOpts {
  count: number
  aspect: AspectRatio
  target: TargetPlatform
  withCaptions: boolean
  minLen: number
  maxLen: number
  moments?: string[]
}

export interface ExportOpts {
  resolution: number
  fps: number
  burnCaptions: boolean
  writeSrt: boolean
}

interface NewRun {
  title: string
  kind: JobKind
  source: string
  seconds?: number
  onDone?: () => void
}

interface LibraryStore {
  status: Status
  projects: Project[]
  clips: Clip[]
  jobs: Job[]
  load: () => Promise<void>
  /** Re-read projects and clips after the backend added some (live clips). */
  reload: () => Promise<void>
  deleteProject: (id: string) => void
  deleteClips: (ids: string[]) => void
  updateClip: (id: string, patch: Partial<Clip>) => void
  /** Cut one clip in two at `atSec` (seconds in the source). Returns the new clip's id. */
  splitClip: (id: string, atSec: number) => string | null
  runSimulated: (run: NewRun) => string
  retryJob: (id: string) => void
  clearHistory: () => void
  addGeneratedProject: (o: {
    title: string
    sourceLabel: string
    kind: Project['sourceKind']
    platform: PlatformId | 'local'
    duration: number
    sizeBytes: number
    count: number
    aspect: AspectRatio
    target: TargetPlatform
    withCaptions: boolean
    sourcePath?: string | null
    minLen: number
    maxLen: number
  }) => string
  exportClips: (ids: string[], opts?: Partial<ExportOpts>) => void
  applyJobEvent: (e: JobEvent) => void
  /** The latest job working on each project, so its card can show progress. */
  projectJob: Record<string, string>
  /** Transcribe a local file and create its clips with real highlight detection. */
  startFileAnalysis: (o: { path: string; title: string; duration: number; sizeBytes: number; gen: GenerateOpts }) => Promise<{ projectId: string; jobId: string } | null>
  startLinkImport: (o: {
    url: string
    title: string
    platform: PlatformId
    duration: number
    maxHeight: number
    gen: GenerateOpts
  }) => Promise<string | null>
  cancelJob: (id: string) => void
}

const timers = new Map<string, ReturnType<typeof setInterval>>()

/** Clip settings waiting for a download to finish, by project id. */
const pendingGen = new Map<string, GenerateOpts>()

const errorText = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : 'Unknown error')

function analyzeRequest(projectId: string, gen: GenerateOpts) {
  const s = useSettings.getState()
  return api.ai.analyze({
    projectId,
    options: { minLen: gen.minLen, maxLen: gen.maxLen, count: gen.count, moments: gen.moments ?? [], sensitivity: s.sensitivity },
    aspect: gen.aspect, target: gen.target, captions: gen.withCaptions, model: s.model, language: s.language,
    speakers: s.speakerDetection, ollamaModel: s.ollamaEnabled && s.ollamaModel ? s.ollamaModel : null, concurrency: s.concurrency,
  })
}

/** Placeholder detection: evenly spaced windows, lengths spread across the chosen range. Real detection is Phase 5. */
function placeholderClips(pid: string, hue: number, duration: number, o: GenerateOpts): Clip[] {
  return Array.from({ length: o.count }, (_, i) => {
    const len = Math.min(duration, Math.round(o.minLen + ((o.maxLen - o.minLen) * i) / Math.max(1, o.count - 1)))
    const slot = duration / o.count
    const start = Math.max(0, Math.min(duration - len, Math.round(slot * i + (slot - len) / 2)))
    return {
      id: uid('c'), projectId: pid, title: `Clip ${i + 1}`, startSec: start, endSec: start + len,
      aspect: o.aspect, target: o.target,
      // Without a transcript there is nothing to caption (the browser preview still pretends, and says so).
      captions: o.withCaptions && IS_MOCK_BACKEND ? 'generated' : 'none',
      exportStatus: 'not-exported', score: 92 - i * 4, hue: (hue + i * 17) % 360, createdAt: new Date().toISOString(),
    } satisfies Clip
  })
}

/** Storage is write-through: the UI updates first, the backend follows. A failure is shown, not hidden. */
function persist(p: Promise<unknown>, what: string) {
  p.catch((e) => {
    const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : 'Unknown error'
    api.system.log('error', `${what} failed: ${msg}`)
    toast({ kind: 'error', title: `Could not save: ${what}`, body: msg })
  })
}

const PATCH_KEYS = ['title', 'startSec', 'endSec', 'aspect', 'target', 'captions', 'exportStatus', 'cropX', 'zoom', 'track'] as const
const toPatch = (c: Partial<Clip>): ClipPatch =>
  Object.fromEntries(PATCH_KEYS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]])) as ClipPatch

export const useLibrary = create<LibraryStore>((set, get) => ({
  status: 'idle',
  projects: [],
  clips: [],
  jobs: [],

  load: async () => {
    if (get().status !== 'idle') return
    set({ status: 'loading' })
    const [projects, clips, jobs] = await Promise.all([
      api.library.listProjects(),
      api.library.listClips(),
      api.library.listJobs(),
    ])
    if (IS_MOCK_BACKEND) {
      set({ projects, clips, jobs, status: 'ready' })
      // Resume the two sample "running" jobs so the processing UI is alive.
      jobs.filter((j) => j.status === 'running').forEach((j) => tick(j.id, 25 + Math.random() * 15, undefined, true))
      return
    }
    // Nothing survives a restart: a project still 'processing' lost its download. Mark it failed so it can be deleted or retried.
    const stuck = projects.filter((p) => p.status === 'processing')
    stuck.forEach((p) => persist(api.library.setProjectStatus(p.id, 'failed'), 'interrupted project'))
    const fixedProjects = projects.map((p) => (p.status === 'processing' ? { ...p, status: 'failed' as const } : p))
    // A job still marked running at startup was cut off when AutoKlipper closed. Say so instead of faking progress.
    const fixed = jobs.map((j) =>
      j.status === 'running' || j.status === 'queued'
        ? { ...j, status: 'failed' as const, error: 'AutoKlipper closed before this job finished. Retry it from History.' }
        : j,
    )
    fixed.forEach((j, i) => j !== jobs[i] && persist(api.library.saveJob(j), 'interrupted job'))
    set({ projects: fixedProjects, clips, jobs: fixed, status: 'ready' })
  },

  reload: async () => {
    const [projects, clips] = await Promise.all([api.library.listProjects(), api.library.listClips()])
    set({ projects, clips })
  },

  deleteProject: (id) => {
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id), clips: s.clips.filter((c) => c.projectId !== id) }))
    persist(api.library.deleteProject(id), 'delete project')
  },

  deleteClips: (ids) => {
    set((s) => ({
      clips: s.clips.filter((c) => !ids.includes(c.id)),
      projects: s.projects.map((p) => ({
        ...p,
        clipCount: s.clips.filter((c) => c.projectId === p.id && !ids.includes(c.id)).length,
      })),
    }))
    persist(api.library.deleteClips(ids), 'delete clips')
  },

  updateClip: (id, patch) => {
    set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
    persist(api.library.updateClip(id, toPatch(patch)), 'update clip')
  },

  splitClip: (id, atSec) => {
    const c = get().clips.find((x) => x.id === id)
    const at = Math.round(atSec * 10) / 10
    // Both halves must be long enough to be a clip.
    if (!c || at < c.startSec + 1 || at > c.endSec - 1) return null
    const second: Clip = {
      ...c, id: uid('c'), title: `${c.title} (2)`, startSec: at, exportStatus: 'not-exported', exportPath: null, createdAt: new Date().toISOString(),
      // An empty path means "no path" to the backend.
      track: c.track ?? undefined,
    }
    get().updateClip(id, { endSec: at })
    set((s) => ({ clips: [second, ...s.clips], projects: s.projects.map((p) => (p.id === c.projectId ? { ...p, clipCount: p.clipCount + 1 } : p)) }))
    persist(api.library.createClips([second]), 'split clip')
    return second.id
  },

  runSimulated: ({ title, kind, source, seconds = 6, onDone }) => {
    const id = uid('j')
    const job: Job = {
      id, title, kind, source, status: 'running', progress: 0, simulated: true,
      startedAt: new Date().toISOString(), durationSec: 0,
    }
    set((s) => ({ jobs: [job, ...s.jobs] }))
    persist(api.library.saveJob(job), 'save job')
    tick(id, seconds, onDone)
    return id
  },

  retryJob: (id) => {
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, status: 'running', progress: 0, error: undefined, startedAt: new Date().toISOString() } : j)),
    }))
    const j = get().jobs.find((x) => x.id === id)
    if (j) persist(api.library.saveJob(j), 'retry job')
    tick(id, 5)
  },

  clearHistory: () => {
    set((s) => ({ jobs: s.jobs.filter((j) => j.status === 'running' || j.status === 'queued') }))
    persist(api.library.clearFinishedJobs(), 'clear history')
  },

  addGeneratedProject: (o) => {
    const pid = uid('p')
    const hue = Math.floor(Math.random() * 360)
    const project: Project = {
      id: pid, title: o.title, sourceKind: o.kind, sourceLabel: o.sourceLabel, platform: o.platform,
      duration: o.duration, status: 'processing', createdAt: new Date().toISOString(), clipCount: 0, hue, sizeBytes: o.sizeBytes,
      sourcePath: o.sourcePath ?? null,
    }
    set((s) => ({ projects: [project, ...s.projects] }))
    const created = api.library.createProject(project)
    persist(created, 'save project')
    get().runSimulated({
      title: `Split into ${o.count} clips (placeholder detection)`,
      kind: 'detect',
      source: o.title,
      seconds: 7,
      onDone: () => {
        const clips = placeholderClips(pid, hue, o.duration, o)
        set((s) => ({
          clips: [...clips, ...s.clips],
          projects: s.projects.map((p) => (p.id === pid ? { ...p, status: 'ready', clipCount: o.count } : p)),
        }))
        // Clips need their project row first, so wait for it.
        persist(created.then(() => api.library.createClips(clips)).then(() => api.library.setProjectStatus(pid, 'ready')), 'save clips')
      },
    })
    return pid
  },

  projectJob: {},

  applyJobEvent: (e) => {
    const { job, clipId, exportStatus, exportPath, projectId, projectStatus, sourcePath, duration, sizeBytes } = e
    const prev = get().jobs.find((j) => j.id === job.id)
    set((s) => ({
      jobs: prev ? s.jobs.map((j) => (j.id === job.id ? job : j)) : [job, ...s.jobs],
      projectJob: projectId ? { ...s.projectJob, [projectId]: job.id } : s.projectJob,
      clips: clipId && exportStatus ? s.clips.map((c) => (c.id === clipId ? { ...c, exportStatus, exportPath: exportPath ?? c.exportPath } : c)) : s.clips,
      projects: projectId && projectStatus
        ? s.projects.map((p) => (p.id === projectId ? { ...p, status: projectStatus, sourcePath: sourcePath ?? p.sourcePath, duration: duration ?? p.duration, sizeBytes: sizeBytes ?? p.sizeBytes } : p))
        : s.projects,
    }))

    // A download finished: create the clips the user asked for, now that the real length is known.
    if (projectId && projectStatus === 'ready' && pendingGen.has(projectId)) {
      const gen = pendingGen.get(projectId)!
      pendingGen.delete(projectId)
      const p = get().projects.find((x) => x.id === projectId)
      if (p && aiReady()) {
        analyzeRequest(projectId, gen).catch((err) => toast({ kind: 'error', title: 'Could not start transcription', body: errorText(err) }))
      } else if (p) {
        const clips = placeholderClips(projectId, p.hue, duration ?? p.duration, gen)
        set((s) => ({ clips: [...clips, ...s.clips], projects: s.projects.map((x) => (x.id === projectId ? { ...x, clipCount: clips.length } : x)) }))
        persist(api.library.createClips(clips), 'save clips')
      }
    }
    if (projectId && projectStatus === 'failed') pendingGen.delete(projectId)

    // Analysis added clips in the database: load them.
    if (projectId && e.clipsAdded != null) {
      void api.library.listClips().then((all) => {
        set((s) => {
          const mine = all.filter((c) => c.projectId === projectId)
          return {
            clips: [...mine, ...s.clips.filter((c) => c.projectId !== projectId)],
            projects: s.projects.map((p) => (p.id === projectId ? { ...p, clipCount: mine.length } : p)),
          }
        })
      })
      if (e.warning) toast({ kind: 'warning', title: 'Analysis finished with a note', body: e.warning })
    }
    // Setup and model downloads change what the AI can do.
    if (job.status === 'completed' && job.kind === 'download' && !projectId) {
      const fetched = job.title.startsWith('Download Whisper model ') ? job.title.slice('Download Whisper model '.length) : null
      void useAi.getState().refresh().then(() => {
        // If the chosen model is still missing, use the one that was just downloaded.
        const installed = useAi.getState().status?.models ?? []
        if (fetched && installed.includes(fetched) && !installed.includes(useSettings.getState().model)) {
          useSettings.getState().set({ model: fetched as ReturnType<typeof useSettings.getState>['model'] })
        }
      })
    }

    const wasOpen = !prev || prev.status === 'queued' || prev.status === 'running'
    if (!wasOpen || (job.status !== 'completed' && job.status !== 'failed')) return
    const isDownload = job.kind === 'download'
    const isAnalysis = job.kind === 'transcribe'
    if (job.status === 'completed') {
      const title = isAnalysis ? `Found ${e.clipsAdded ?? 0} clips` : isDownload ? 'Download finished' : 'Export finished'
      const msg = { kind: 'success' as const, title, body: isDownload || isAnalysis ? job.title : (exportPath ?? job.title) }
      useUi.getState().notify(msg)
      toast(msg)
    } else if (job.error !== 'Cancelled.') {
      const msg = { kind: 'error' as const, title: isAnalysis ? 'Transcription failed' : isDownload ? 'Download failed' : 'Export failed', body: job.error ?? job.title }
      useUi.getState().notify(msg)
      toast(msg)
    }
  },

  startFileAnalysis: async ({ path, title, duration, sizeBytes, gen }) => {
    const pid = uid('p')
    const project: Project = {
      id: pid, title, sourceKind: 'file', sourceLabel: path, platform: 'local', duration, status: 'processing',
      createdAt: new Date().toISOString(), clipCount: 0, hue: Math.floor(Math.random() * 360), sizeBytes, sourcePath: path,
    }
    try {
      await api.library.createProject(project)
      set((s) => ({ projects: [project, ...s.projects] }))
      return { projectId: pid, jobId: await analyzeRequest(pid, gen) }
    } catch (e) {
      set((s) => ({ projects: s.projects.filter((p) => p.id !== pid) }))
      void api.library.deleteProject(pid).catch(() => undefined)
      toast({ kind: 'error', title: 'Could not start transcription', body: errorText(e) })
      return null
    }
  },

  startLinkImport: async ({ url, title, platform, duration, maxHeight, gen }) => {
    const pid = uid('p')
    const hue = Math.floor(Math.random() * 360)
    const project: Project = {
      id: pid, title, sourceKind: 'url', sourceLabel: url, platform, duration, status: 'processing',
      createdAt: new Date().toISOString(), clipCount: 0, hue, sizeBytes: 0, sourcePath: null,
    }
    try {
      await api.library.createProject(project)
      set((s) => ({ projects: [project, ...s.projects] }))
      pendingGen.set(pid, gen)
      const st = useSettings.getState()
      return await api.media.startDownload({ projectId: pid, url, maxHeight, concurrency: st.concurrency, confirmedRights: true })
    } catch (e) {
      // Nothing was downloaded: remove the empty project again.
      pendingGen.delete(pid)
      set((s) => ({ projects: s.projects.filter((p) => p.id !== pid) }))
      void api.library.deleteProject(pid).catch(() => undefined)
      toast({ kind: 'error', title: 'Could not start the download', body: typeof e === 'string' ? e : e instanceof Error ? e.message : 'Unknown error' })
      return null
    }
  },

  cancelJob: (id) => {
    persist(api.media.cancelJob(id), 'cancel job')
  },

  exportClips: (ids, opts) => {
    if (!IS_MOCK_BACKEND) {
      // Real render in the backend. Progress and results come back as job events.
      const s = useSettings.getState()
      api.media
        .exportClips({
          // Captions are on by default; the backend leaves clips with captions switched off alone.
          clipIds: ids, resolution: 1080, fps: 30, burnCaptions: true, writeSrt: false, style: useCaptions.getState().style, ...opts,
          quality: s.quality, device: s.device, outDir: s.exportFolder, concurrency: s.concurrency,
        })
        .then(() => toast({ kind: 'info', title: `Export started for ${ids.length} clip${ids.length === 1 ? '' : 's'}`, body: 'Follow progress in History.' }))
        .catch((e) => toast({ kind: 'error', title: 'Could not start the export', body: typeof e === 'string' ? e : e instanceof Error ? e.message : 'Unknown error' }))
      return
    }
    const set1 = (status: Clip['exportStatus']) => {
      set((s) => ({ clips: s.clips.map((c) => (ids.includes(c.id) ? { ...c, exportStatus: status } : c)) }))
      ids.forEach((id) => persist(api.library.updateClip(id, { exportStatus: status }), 'export status'))
    }
    set1('queued')
    setTimeout(() => set1('exporting'), 700)
    get().runSimulated({
      title: `Simulated: export ${ids.length} clip${ids.length === 1 ? '' : 's'}`,
      kind: 'export',
      source: 'My Clips',
      seconds: 4 + ids.length,
      onDone: () => set1('exported'),
    })
  },
}))

function tick(id: string, seconds = 8, onDone?: () => void, quiet = false) {
  if (timers.has(id)) return
  const started = Date.now()
  const h = setInterval(() => {
    const st = useLibrary.getState()
    const job = st.jobs.find((j) => j.id === id)
    if (!job) {
      clearInterval(h)
      timers.delete(id)
      return
    }
    const step = 100 / (seconds * 4) + Math.random() * 2
    const next = Math.min(100, job.progress + step)
    if (next >= 100) {
      clearInterval(h)
      timers.delete(id)
      useLibrary.setState((s) => ({
        jobs: s.jobs.map((j) =>
          j.id === id ? { ...j, progress: 100, status: 'completed', durationSec: Math.max(1, Math.round((Date.now() - started) / 1000)) } : j,
        ),
      }))
      const done = useLibrary.getState().jobs.find((j) => j.id === id)
      if (done) persist(api.library.saveJob(done), 'save job')
      onDone?.()
      if (quiet) return
      useUi.getState().notify({ kind: 'success', title: 'Simulated job finished', body: `${job.title}. No real video was processed.` })
      toast({ kind: 'success', title: 'Simulated job finished', body: `${job.title}. No real video was processed.` })
    } else {
      useLibrary.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, progress: next } : j)) }))
    }
  }, 250)
  timers.set(id, h)
}
