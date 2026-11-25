import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'cyan'
const tones: Record<Tone, string> = {
  neutral: 'bg-s3 text-t2 border-line',
  accent: 'bg-accent/14 text-accent border-accent/30',
  success: 'bg-ok/12 text-ok border-ok/25',
  warning: 'bg-warn/12 text-warn border-warn/25',
  danger: 'bg-bad/12 text-bad border-bad/25',
  cyan: 'bg-cyan/12 text-cyan border-cyan/25',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-meta font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}

export function Progress({ value, tone = 'accent', className, label }: { value: number; tone?: 'accent' | 'success' | 'danger'; className?: string; label?: string }) {
  const bar = tone === 'success' ? 'bg-ok' : tone === 'danger' ? 'bg-bad' : 'bg-accent'
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={cn('h-1.5 overflow-hidden rounded-full bg-s3', className)}
    >
      <div className={cn('h-full rounded-full transition-[transform] duration-300 ease-out origin-left', bar)} style={{ transform: `scaleX(${Math.min(100, value) / 100})` }} />
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />
}

export function EmptyState({
  icon: Icon, title, body, action,
}: {
  icon: LucideIcon
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-s2 text-t2">
        <Icon size={20} />
      </div>
      <div>
        <p className="text-section font-semibold">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-body text-t2">{body}</p>
      </div>
      {action}
    </div>
  )
}

export function SectionHeader({ title, action, hint }: { title: string; action?: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-section font-semibold">{title}</h2>
        {hint ? <p className="mt-0.5 text-label text-t3">{hint}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-s2 px-1.5 py-px font-mono text-meta text-t2">{children}</kbd>
}
