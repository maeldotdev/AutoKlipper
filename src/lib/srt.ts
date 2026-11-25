import type { CaptionSegment } from '@/types'
import { fmtSrtTime } from './utils'

/** Standard SRT: one cue per segment, timings from its first and last word. */
export function toSrt(segments: CaptionSegment[]): string {
  return (
    segments
      .filter((s) => s.words.length)
      .map((s, i) => `${i + 1}\n${fmtSrtTime(s.start)} --> ${fmtSrtTime(s.end)}\n${s.words.map((w) => w.text).join(' ')}\n`)
      .join('\n')
  )
}
