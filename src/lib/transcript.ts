import type { CaptionSegment, CaptionWord } from '@/types'

/** Where a clip sits inside its project's video. */
export interface ClipRange {
  projectId: string
  startSec: number
  endSec: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const inside = (w: CaptionWord, r: ClipRange) => {
  const mid = (w.start + w.end) / 2
  return mid >= r.startSec && mid < r.endSec
}
const bounds = (id: string, words: CaptionWord[], rest: CaptionSegment): CaptionSegment => ({
  ...rest, id, words, start: words[0].start, end: words[words.length - 1].end,
})

/** The clip's words with times measured from the clip start (matches the backend's slicing). */
export function sliceTranscript(full: CaptionSegment[], r: ClipRange): CaptionSegment[] {
  return full.flatMap((s) => {
    const words = s.words
      .filter((w) => inside(w, r))
      .map((w) => ({ ...w, start: r2(Math.max(0, w.start - r.startSec)), end: r2(Math.max(0, Math.min(w.end, r.endSec) - r.startSec)) }))
    return words.length ? [bounds(s.id, words, s)] : []
  })
}

/** Replace the words inside the clip with the edited ones; everything outside the clip is untouched. */
export function mergeClipEdits(full: CaptionSegment[], r: ClipRange, edited: CaptionSegment[]): CaptionSegment[] {
  const outside = full.flatMap((s) => {
    const words = s.words.filter((w) => !inside(w, r))
    return words.length ? [bounds(s.id, words, s)] : []
  })
  const back = edited.flatMap((s) => {
    const words = s.words.map((w) => ({ ...w, start: r2(w.start + r.startSec), end: r2(w.end + r.startSec) }))
    return words.length ? [bounds(s.id, words, s)] : []
  })
  const used = new Set<string>()
  return [...outside, ...back]
    .sort((a, b) => a.start - b.start)
    .map((s) => {
      // A segment cut by the clip edge appears twice with one id; keep ids unique.
      let id = s.id
      while (used.has(id)) id = `${id}b`
      used.add(id)
      return { ...s, id }
    })
}
