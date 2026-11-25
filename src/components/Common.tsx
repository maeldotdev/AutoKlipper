import type { CSSProperties, ReactNode } from 'react'
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

/** Placeholder thumbnail. Generated gradient, never a fake still from a video. */
export function Thumb({
  hue, ratio = 16 / 9, duration, className, children,
}: {
  hue: number
  ratio?: number
  duration?: number
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn('thumb flex items-center justify-center', className)} style={{ ['--h' as string]: hue, aspectRatio: ratio } as CSSProperties}>
      <Film size={22} className="relative z-[1] text-white/35" aria-hidden />
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
