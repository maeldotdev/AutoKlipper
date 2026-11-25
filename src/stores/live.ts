import { create } from 'zustand'
import { IS_MOCK_BACKEND, api, type LiveUpdate } from '@/services'
import { useLibrary } from '@/stores/library'
import { useSettings } from '@/stores/settings'
import { toast, useUi } from '@/stores/ui'
import { uid } from '@/lib/utils'
import type { LiveHighlight, LiveStream, PlatformId } from '@/types'

/*
 * Desktop app: real monitoring in the backend, reported through `live-update` events.
 * Browser preview: a clearly labelled SIMULATION, no connection is opened.
 */
const SAMPLE_LABELS = ['Loud reaction spike', 'Chat speed jump', 'Laughter detected', 'Sudden silence then shout', 'Score change on screen']

interface LiveStore {
  streams: LiveStream[]
  selectedId: string | null
  loaded: boolean
  load: () => Promise<void>
  select: (id: string) => void
  add: (platform: PlatformId, url: string) => void
  remove: (id: string) => void
  start: (id: string) => void
  stop: (id: string) => void
  clipNow: (id: string, seconds: number) => void
  applyUpdate: (u: LiveUpdate) => void
}

const timers = new Map<string, ReturnType<typeof setInterval>[]>()

const patch = (id: string, p: Partial<LiveStream> | ((s: LiveStream) => Partial<LiveStream>)) =>
  useLive.setState((st) => ({ streams: st.streams.map((s) => (s.id === id ? { ...s, ...(typeof p === 'function' ? p(s) : p) } : s)) }))

const errorText = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : 'Unknown error')

/** Stream addresses are kept in the settings file so they survive a restart. */
const remember = (streams: LiveStream[]) => {
  if (!IS_MOCK_BACKEND) useSettings.getState().set({ liveStreams: streams.map(({ id, platform, url, title }) => ({ id, platform, url, title })) })
}

const blank = (s: { id: string; platform: PlatformId; url: string; title: string }): LiveStream => ({ ...s, state: 'idle', uptimeSec: 0, highlights: [] })

export const useLive = create<LiveStore>((set, get) => ({
  streams: [],
  selectedId: null,
  loaded: false,
  load: async () => {
    if (get().loaded) return
    const streams = IS_MOCK_BACKEND ? await api.library.listStreams() : useSettings.getState().liveStreams.map(blank)
    set({ streams, selectedId: streams[0]?.id ?? null, loaded: true })
  },
  select: (selectedId) => set({ selectedId }),
  add: (platform, url) => {
    const id = uid('s')
    const host = url.replace(/^[a-z]+:\/\/(www\.)?/, '').split('/')[0]
    set((s) => ({ streams: [...s.streams, blank({ id, platform, url, title: host })], selectedId: id }))
    remember(get().streams)
  },
  remove: (id) => {
    get().stop(id)
    set((s) => {
      const streams = s.streams.filter((x) => x.id !== id)
      return { streams, selectedId: s.selectedId === id ? (streams[0]?.id ?? null) : s.selectedId }
    })
    remember(get().streams)
  },
  start: (id) => {
    const stream = get().streams.find((s) => s.id === id)
    if (!stream) return
    patch(id, { state: 'connecting', uptimeSec: 0, bufferedSec: 0, highlights: [], message: undefined, thumbnail: undefined })
    if (IS_MOCK_BACKEND) return simulate(id)
    const s = useSettings.getState()
    api.live
      .start({
        id, url: stream.url, confirmedRights: true, model: s.model, language: s.language, autoClip: s.liveAutoClip,
        bufferMinutes: s.liveBufferMinutes, minLen: 10, maxLen: 45, moments: [], sensitivity: s.sensitivity,
        aspect: '9:16', target: 'tiktok', maxHeight: s.liveQuality,
      })
      .catch((e) => {
        patch(id, { state: 'error', message: errorText(e) })
        toast({ kind: 'error', title: 'Could not start monitoring', body: errorText(e) })
      })
  },
  stop: (id) => {
    if (!IS_MOCK_BACKEND) {
      void api.live.stop(id).then((was) => {
        if (!was) patch(id, { state: 'idle' })
      })
      return
    }
    timers.get(id)?.forEach((x) => {
      clearInterval(x)
      clearTimeout(x)
    })
    timers.delete(id)
    patch(id, { state: 'idle' })
  },
  clipNow: (id, seconds) => {
    api.live
      .clipNow(id, seconds)
      .then(() => toast({ kind: 'info', title: `Clipping the last ${seconds} seconds` }))
      .catch((e) => toast({ kind: 'error', title: 'Could not clip', body: errorText(e) }))
  },
  applyUpdate: (u) => {
    const id = u.sessionId
    const hid = `${id}-${u.n}`
    switch (u.kind) {
      case 'connecting':
        return patch(id, { state: 'connecting' })
      case 'monitoring':
        return patch(id, { state: 'monitoring', transcribing: !!u.transcribing, message: undefined })
      case 'reconnecting':
        return patch(id, { state: 'reconnecting', message: u.message ?? undefined })
      case 'tick':
        return patch(id, (s) => ({ uptimeSec: Math.round(u.uptimeSec ?? s.uptimeSec), bufferedSec: u.bufferedSec ?? 0, thumbnail: u.thumbnail ?? s.thumbnail }))
      case 'warning':
        patch(id, { message: u.message ?? undefined })
        return toast({ kind: 'warning', title: 'Live monitoring', body: u.message ?? '' })
      case 'found': {
        const h: LiveHighlight = { id: hid, atSec: Math.round(u.atSec ?? 0), label: u.label ?? 'Moment', score: u.score ?? 0, title: u.title ?? undefined, clipState: 'rendering' }
        return patch(id, (s) => ({ highlights: [h, ...s.highlights].slice(0, 30) }))
      }
      case 'ready': {
        patch(id, (s) => ({ highlights: s.highlights.map((h) => (h.id === hid ? { ...h, clipState: 'ready', projectId: u.projectId ?? undefined } : h)) }))
        void useLibrary.getState().reload()
        const msg = { kind: 'success' as const, title: 'Live clip saved', body: 'It is in My Clips.' }
        useUi.getState().notify(msg)
        return toast(msg)
      }
      case 'failed':
        patch(id, (s) => ({ highlights: s.highlights.map((h) => (h.id === hid ? { ...h, clipState: 'failed' } : h)) }))
        return toast({ kind: 'error', title: 'Could not save a live clip', body: u.message ?? '' })
      case 'ended':
        patch(id, { state: u.message ? 'error' : 'idle', message: u.message ?? undefined, thumbnail: undefined })
        if (u.message) toast({ kind: 'error', title: 'Monitoring stopped', body: u.message })
    }
  },
}))

/** Browser preview only. */
function simulate(id: string) {
  const connect = setTimeout(() => {
    patch(id, { state: 'monitoring', transcribing: true })
    toast({ kind: 'info', title: 'Simulated monitoring started', body: 'No real stream is connected in this preview.' })
    const up = setInterval(() => patch(id, (s) => ({ uptimeSec: s.uptimeSec + 1 })), 1000)
    const hl = setInterval(() => {
      const h: LiveHighlight = {
        id: uid('h'), atSec: 0, label: SAMPLE_LABELS[Math.floor(Math.random() * SAMPLE_LABELS.length)],
        score: 70 + Math.floor(Math.random() * 28), clipState: 'queued',
      }
      patch(id, (s) => ({ highlights: [{ ...h, atSec: s.uptimeSec }, ...s.highlights].slice(0, 12) }))
      setTimeout(() => patch(id, (s) => ({ highlights: s.highlights.map((x) => (x.id === h.id ? { ...x, clipState: 'rendering' } : x)) })), 1500)
      setTimeout(() => patch(id, (s) => ({ highlights: s.highlights.map((x) => (x.id === h.id ? { ...x, clipState: 'ready' } : x)) })), 4500)
    }, 7000)
    timers.set(id, [up, hl])
  }, 1500)
  timers.set(id, [connect as unknown as ReturnType<typeof setInterval>])
}
