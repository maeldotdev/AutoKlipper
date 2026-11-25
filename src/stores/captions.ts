import { create } from 'zustand'
import { toast } from '@/stores/ui'
import { persist } from 'zustand/middleware'
import { BASE_STYLE, BUILT_IN_PRESETS } from '@/theme/captionPresets'
import { buildSampleTranscript } from '@/mock/transcript'
import { uid, clamp } from '@/lib/utils'
import { api, IS_MOCK_BACKEND } from '@/services'
import { mergeClipEdits, sliceTranscript, type ClipRange } from '@/lib/transcript'
import type { AspectRatio, CaptionPreset, CaptionSegment, CaptionStyle, CaptionWord, Template } from '@/types'

interface CaptionStore {
  segments: CaptionSegment[]
  /** 'real' when the words come from this clip's transcript, else the built-in sample. */
  source: 'sample' | 'real' | 'missing'
  bound: ClipRange | null
  bindClip: (range: ClipRange) => Promise<void>
  unbind: () => void
  past: CaptionSegment[][]
  future: CaptionSegment[][]
  style: CaptionStyle
  presetId: string | null
  aspect: AspectRatio
  customPresets: CaptionPreset[]
  customTemplates: Template[]

  setStyle: (patch: Partial<CaptionStyle>) => void
  applyPreset: (id: string) => void
  applyPatch: (patch: Partial<CaptionStyle>) => void
  saveCustomPreset: (name: string) => void
  deleteCustomPreset: (id: string) => void
  saveCustomTemplate: (name: string, blurb: string) => void
  deleteCustomTemplate: (id: string) => void
  setAspect: (a: AspectRatio) => void

  editWord: (segId: string, wordId: string, patch: Partial<CaptionWord>) => void
  toggleKeyword: (segId: string, wordId: string) => void
  shiftSegment: (segId: string, delta: number) => void
  splitSegment: (segId: string, atWordIndex: number) => void
  mergeNext: (segId: string) => void
  deleteSegment: (segId: string) => void
  replaceAll: (find: string, repl: string, matchCase: boolean) => number
  undo: () => void
  redo: () => void
  resetTranscript: () => void
}

const norm = (segs: CaptionSegment[]): CaptionSegment[] =>
  segs.map((s) => ({ ...s, start: s.words[0]?.start ?? s.start, end: s.words[s.words.length - 1]?.end ?? s.end }))

/* The whole project's transcript while a clip is open, and the pending save of edits to it. */
let full: CaptionSegment[] = []
let pending: ReturnType<typeof setTimeout> | undefined
let save: (() => Promise<void>) | undefined

async function flush() {
  clearTimeout(pending)
  const run = save
  save = undefined
  await run?.()
}

export const useCaptions = create<CaptionStore>()(
  persist(
    (set, get) => {
      const commit = (next: CaptionSegment[]) =>
        set((s) => ({ past: [...s.past.slice(-99), s.segments], future: [], segments: norm(next) }))

      return {
        segments: buildSampleTranscript(),
        past: [],
        future: [],
        source: 'sample',
        bound: null,
        bindClip: async (range) => {
          await flush()
          if (IS_MOCK_BACKEND) return
          const doc = await api.ai.getTranscript(range.projectId).catch(() => null)
          full = doc?.segments ?? []
          set({ bound: range, source: doc ? 'real' : 'missing', segments: doc ? sliceTranscript(full, range) : [], past: [], future: [] })
        },
        unbind: () => {
          void flush()
          set({ bound: null, source: 'sample', segments: buildSampleTranscript(), past: [], future: [] })
        },
        style: BUILT_IN_PRESETS[0].style,
        presetId: 'bold-creator',
        aspect: '9:16',
        customPresets: [],
        customTemplates: [],

        setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
        applyPreset: (id) => {
          const p = [...BUILT_IN_PRESETS, ...get().customPresets].find((x) => x.id === id)
          if (p) set({ style: { ...p.style }, presetId: id })
        },
        applyPatch: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
        saveCustomPreset: (name) => {
          const id = uid('preset')
          set((s) => ({
            customPresets: [...s.customPresets, { id, name, blurb: 'Saved from your settings.', style: { ...s.style }, builtIn: false }],
            presetId: id,
          }))
        },
        deleteCustomPreset: (id) =>
          set((s) => ({ customPresets: s.customPresets.filter((p) => p.id !== id), presetId: s.presetId === id ? null : s.presetId })),
        saveCustomTemplate: (name, blurb) =>
          set((s) => ({
            customTemplates: [...s.customTemplates, { id: uid('tpl'), kind: 'caption', name, blurb, patch: { ...s.style }, builtIn: false }],
          })),
        deleteCustomTemplate: (id) => set((s) => ({ customTemplates: s.customTemplates.filter((t) => t.id !== id) })),
        setAspect: (aspect) => set({ aspect }),

        editWord: (segId, wordId, patch) =>
          commit(
            get().segments.map((s) =>
              s.id !== segId ? s : { ...s, words: s.words.map((w) => (w.id === wordId ? { ...w, ...patch } : w)) },
            ),
          ),
        toggleKeyword: (segId, wordId) =>
          commit(
            get().segments.map((s) =>
              s.id !== segId ? s : { ...s, words: s.words.map((w) => (w.id === wordId ? { ...w, keyword: w.keyword ? undefined : true } : w)) },
            ),
          ),
        shiftSegment: (segId, delta) =>
          commit(
            get().segments.map((s) =>
              s.id !== segId
                ? s
                : {
                    ...s,
                    words: s.words.map((w) => ({
                      ...w,
                      start: +clamp(w.start + delta, 0, 600).toFixed(2),
                      end: +clamp(w.end + delta, 0, 600).toFixed(2),
                    })),
                  },
            ),
          ),
        splitSegment: (segId, at) => {
          const out: CaptionSegment[] = []
          for (const s of get().segments) {
            if (s.id === segId && at > 0 && at < s.words.length) {
              out.push({ ...s, id: uid('s'), words: s.words.slice(0, at) }, { ...s, id: uid('s'), words: s.words.slice(at) })
            } else out.push(s)
          }
          commit(out)
        },
        mergeNext: (segId) => {
          const segs = get().segments
          const i = segs.findIndex((s) => s.id === segId)
          if (i < 0 || i >= segs.length - 1) return
          const merged: CaptionSegment = { ...segs[i], words: [...segs[i].words, ...segs[i + 1].words] }
          commit([...segs.slice(0, i), merged, ...segs.slice(i + 2)])
        },
        deleteSegment: (segId) => commit(get().segments.filter((s) => s.id !== segId)),
        replaceAll: (find, repl, matchCase) => {
          if (!find) return 0
          let count = 0
          const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const re = new RegExp(esc, matchCase ? 'g' : 'gi')
          const next = get().segments.map((s) => ({
            ...s,
            words: s.words.map((w) => {
              const t = w.text.replace(re, () => {
                count++
                return repl
              })
              return t === w.text ? w : { ...w, text: t }
            }),
          }))
          if (count) commit(next)
          return count
        },
        undo: () =>
          set((s) => {
            const prev = s.past[s.past.length - 1]
            return prev ? { segments: prev, past: s.past.slice(0, -1), future: [s.segments, ...s.future] } : s
          }),
        redo: () =>
          set((s) => {
            const nxt = s.future[0]
            return nxt ? { segments: nxt, future: s.future.slice(1), past: [...s.past, s.segments] } : s
          }),
        resetTranscript: () => commit(get().bound ? sliceTranscript(full, get().bound!) : buildSampleTranscript()),
      }
    },
    {
      name: 'clipit.captions',
      version: 1,
      partialize: (s) => ({
        style: s.style, presetId: s.presetId, aspect: s.aspect, customPresets: s.customPresets, customTemplates: s.customTemplates,
      }),
    },
  ),
)

// Corrections to a real transcript are saved back, shortly after the user stops editing.
useCaptions.subscribe((s, prev) => {
  if (s.source !== 'real' || !s.bound || s.bound !== prev.bound || s.segments === prev.segments) return
  const range = s.bound
  const segments = s.segments
  save = async () => {
    full = mergeClipEdits(full, range, segments)
    await api.ai.saveTranscript(range.projectId, full).catch((e) => toast({ kind: 'error', title: 'Could not save the transcript', body: String(e) }))
  }
  clearTimeout(pending)
  pending = setTimeout(() => void flush(), 700)
})

export const styleEquals = (a: CaptionStyle, b: CaptionStyle) =>
  (Object.keys(BASE_STYLE) as (keyof CaptionStyle)[]).every((k) => a[k] === b[k])
