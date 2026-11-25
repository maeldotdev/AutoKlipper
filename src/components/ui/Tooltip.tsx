import * as T from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={350} skipDelayDuration={150}>
    {children}
  </T.Provider>
)

export function Tip({ label, children, side = 'top', kbd }: { label: string; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left'; kbd?: string }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={7}
          className="z-[80] flex items-center gap-2 rounded-md border border-line2 bg-s3 px-2.5 py-1.5 text-label text-t1 shadow-[var(--shadow-pop)]"
        >
          {label}
          {kbd ? <kbd className="rounded bg-s1 px-1.5 py-px font-mono text-meta text-t2">{kbd}</kbd> : null}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
