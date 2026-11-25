import { useRef, type PointerEvent as RPE } from 'react'
import { clamp, cn, fmtClock } from '@/lib/utils'
import { usePlayhead } from '@/stores/playhead'
import type { CaptionSegment } from '@/types'

/** Deterministic pseudo-waveform. It is decoration for the prototype, not decoded audio. */
const WAVE = Array.from({ length: 160 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 0.37) * 0.5 + Math.sin(i * 1.13 + 2) * 0.3 + Math.sin(i * 0.071) * 0.4)
  return clamp(0.14 + v * 0.7, 0.08, 1)
})

function Wave({ className, peaks }: { className?: string; peaks?: number[] | null }) {
  const bars = peaks ? peaks.map((p) => clamp(p, 0.03, 1)) : WAVE
  return (
    <div className={cn('pointer-events-none absolute inset-0 flex items-center gap-px px-px', className)} aria-hidden>
      {bars.map((h, i) => (
        <span key={i} className="flex-1 rounded-full bg-t3/35" style={{ height: `${h * 70}%` }} />
      ))}
    </div>
  )
}

function Playhead({ offset, domainStart, domainLen }: { offset: number; domainStart: number; domainLen: number }) {
  const t = usePlayhead((s) => s.time)
  const x = clamp(((offset + t - domainStart) / domainLen) * 100, 0, 100)
  return (
    <div className="pointer-events-none absolute inset-y-0 z-[4] w-px bg-t1" style={{ left: `${x}%` }}>
      <span className="absolute -left-[5px] -top-px h-2.5 w-[11px] rounded-b-sm bg-t1" />
    </div>
  )
}

/** Transcript timeline: segment blocks over a waveform. Click or drag to seek. */
export function TranscriptTimeline({ segments, duration, activeId, onPick }: { segments: CaptionSegment[]; duration: number; activeId?: string; onPick?: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const seek = usePlayhead((s) => s.seek)
  const drag = (e: RPE) => {
    const r = ref.current!.getBoundingClientRect()
    seek(clamp((e.clientX - r.left) / r.width, 0, 1) * duration)
  }
  return (
    <div className="select-none">
      <div
        ref={ref}
        role="slider"
        aria-label="Transcript timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag(e)
        }}
        onPointerMove={(e) => e.buttons === 1 && drag(e)}
        onKeyDown={(e) => {
          const t = usePlayhead.getState().time
          if (e.key === 'ArrowRight') seek(t + 0.5)
          if (e.key === 'ArrowLeft') seek(t - 0.5)
        }}
        className="no-drag relative h-[76px] cursor-pointer overflow-hidden rounded-md border border-line bg-s2"
      >
        <Wave />
        {segments.map((s) => (
          <button
            key={s.id}
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              seek(s.start)
              onPick?.(s.id)
            }}
            className={cn(
              'absolute bottom-2 top-2 overflow-hidden rounded border px-1.5 text-left text-meta leading-tight transition-colors duration-150',
              s.id === activeId ? 'border-accent bg-accent/30 text-t1' : 'border-accent/35 bg-accent/12 text-t2 hover:bg-accent/20',
            )}
            style={{ left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%` }}
          >
            <span className="line-clamp-2">{s.words.map((w) => w.text).join(' ')}</span>
          </button>
        ))}
        <Playhead offset={0} domainStart={0} domainLen={duration} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-meta text-t3">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{fmtClock(duration * f)}</span>
        ))}
      </div>
    </div>
  )
}

/**
 * Clip editor timeline. Domain is absolute source seconds; handles trim in/out.
 */
export function EditTimeline({
  domainStart, domainEnd, inSec, outSec, onTrim, segments, peaks,
}: {
  domainStart: number
  domainEnd: number
  inSec: number
  outSec: number
  onTrim: (i: number, o: number) => void
  segments: CaptionSegment[]
  /** Real audio shape of the visible range; a placeholder pattern without it. */
  peaks?: number[] | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const seek = usePlayhead((s) => s.seek)
  const len = domainEnd - domainStart
  const pct = (s: number) => ((s - domainStart) / len) * 100
  const toSec = (e: RPE) => {
    const r = ref.current!.getBoundingClientRect()
    return domainStart + clamp((e.clientX - r.left) / r.width, 0, 1) * len
  }
  const MIN = 3
  const trimTo = (which: 'in' | 'out', e: RPE) => {
    const s = toSec(e)
    if (which === 'in') onTrim(+clamp(s, domainStart, outSec - MIN).toFixed(1), outSec)
    else onTrim(inSec, +clamp(s, inSec + MIN, domainEnd).toFixed(1))
  }
  const nudge = (which: 'in' | 'out') => (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 0.5 : e.key === 'ArrowLeft' ? -0.5 : 0
    if (!d) return
    e.preventDefault()
    if (which === 'in') onTrim(+clamp(inSec + d, domainStart, outSec - MIN).toFixed(1), outSec)
    else onTrim(inSec, +clamp(outSec + d, inSec + MIN, domainEnd).toFixed(1))
  }

  return (
    <div className="select-none">
      <div className="mb-1 flex justify-between font-mono text-meta text-t3">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{fmtClock(domainStart + len * f)}</span>
        ))}
      </div>
      <div
        ref={ref}
        className="no-drag relative h-24 cursor-pointer overflow-hidden rounded-md border border-line bg-s2"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          seek(toSec(e) - inSec)
        }}
        onPointerMove={(e) => e.buttons === 1 && seek(toSec(e) - inSec)}
      >
        <Wave peaks={peaks} />
        <div className="absolute inset-y-0 left-0 bg-black/55" style={{ width: `${pct(inSec)}%` }} />
        <div className="absolute inset-y-0 right-0 bg-black/55" style={{ width: `${100 - pct(outSec)}%` }} />
        <div className="absolute inset-y-0 border-y-2 border-accent" style={{ left: `${pct(inSec)}%`, width: `${pct(outSec) - pct(inSec)}%` }} />
        {segments.map((s) => (
          <div
            key={s.id}
            className="pointer-events-none absolute bottom-2 h-5 overflow-hidden rounded-sm bg-cyan/25 px-1 text-meta leading-5 text-t1"
            style={{ left: `${pct(inSec + s.start)}%`, width: `${((s.end - s.start) / len) * 100}%` }}
          >
            <span className="line-clamp-1">{s.words.map((w) => w.text).join(' ')}</span>
          </div>
        ))}
        {(['in', 'out'] as const).map((w) => (
          <div
            key={w}
            role="slider"
            tabIndex={0}
            aria-label={w === 'in' ? 'Trim start' : 'Trim end'}
            aria-valuenow={w === 'in' ? inSec : outSec}
            aria-valuemin={domainStart}
            aria-valuemax={domainEnd}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => e.buttons === 1 && trimTo(w, e)}
            onKeyDown={nudge(w)}
            className="absolute inset-y-0 z-[5] flex w-3 cursor-ew-resize items-center justify-center bg-accent text-accent-fg"
            style={{ left: `calc(${pct(w === 'in' ? inSec : outSec)}% - ${w === 'in' ? 0 : 12}px)` }}
          >
            <span className="h-6 w-px bg-accent-fg/60" />
          </div>
        ))}
        <Playhead offset={inSec} domainStart={domainStart} domainLen={len} />
      </div>
    </div>
  )
}
