import { useState, useEffect, type CSSProperties, type ReactNode } from 'react'
import { previewUrl } from '@/lib/native'
import { api } from '@/services'
import { Film } from 'lucide-react'
import { PLATFORMS } from '@/lib/labels'
import { cn, fmtDuration } from '@/lib/utils'
import type { PlatformId } from '@/types'

export function Page({ children, className, full }: { children: ReactNode; className?: string; full?: boolean }) {
  return (
    <div className={cn('mx-auto w-full max-w-[1480px] px-6 py-5', full && 'flex h-full min-h-0 flex-col', className)}>{children}</div>
  )
}

export function PlatformMark({ id, size = 24 }: { id: PlatformId | 'local'; size?: number }) {
  const p = PLATFORMS[id]
  return (
    <span
      title={p.name}
      className="inline-flex shrink-0 items-center justify-center rounded-md border border-line bg-s2 font-mono font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.34, color: p.tint }}
    >
      {p.mark}
    </span>
  )
}

const stills = new Map<string, Promise<string | null>>()

/** A real frame from the source video. Nothing is invented: no video, no picture. */
function useStill(of?: { projectId: string; clipId?: string; at?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  const key = of ? `${of.projectId}|${of.clipId ?? ''}|${of.at ?? ''}` : ''
  useEffect(() => {
    setSrc(null)
    if (!of) return
    let live = true
    let got = stills.get(key)
    if (!got) {
      got = api.ai.thumbnail(of.projectId, of.clipId).then((path) => (path ? previewUrl(path) : null)).catch(() => null)
      stills.set(key, got)
      // A video that is not there yet may arrive later (a download): ask again next time.
      void got.then((u) => u ?? stills.delete(key))
    }
    void got.then((u) => live && setSrc(u))
    return () => {
      live = false
    }
  }, [key])
  return src
}

/** A frame from the video, over a generated gradient that stays when there is none. */
export function Thumb({
  hue, ratio = 16 / 9, duration, className, children, of,
}: {
  /** What to show a frame of. `at` changes when the frame should. */
  of?: { projectId: string; clipId?: string; at?: number }
  hue: number
  ratio?: number
  duration?: number
  className?: string
  children?: ReactNode
}) {
  const still = useStill(of)
  return (
    <div className={cn('thumb flex items-center justify-center', className)} style={{ ['--h' as string]: hue, aspectRatio: ratio } as CSSProperties}>
      {still ? <img src={still} alt="" className="absolute inset-0 z-[1] h-full w-full object-cover" /> : <Film size={22} className="relative z-[1] text-white/35" aria-hidden />}
      {duration !== undefined ? (
        <span className="absolute bottom-1.5 right-1.5 z-[1] rounded bg-black/60 px-1.5 py-px font-mono text-meta text-white">{fmtDuration(duration)}</span>
      ) : null}
      {children}
    </div>
  )
}

export function StatTile({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: ReactNode }) {
  return (
    <div className="panel flex items-center gap-3.5 px-4 py-3.5">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/12 text-accent">{icon}</div>
      <div className="min-w-0">
        <p className="text-label text-t2">{label}</p>
        <p className="text-title font-semibold leading-tight tabular-nums">{value}</p>
        {sub ? <p className="truncate text-meta text-t3">{sub}</p> : null}
      </div>
    </div>
  )
}

export function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-body text-t2">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
