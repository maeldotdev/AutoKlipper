import * as D from '@radix-ui/react-dialog'
import * as A from '@radix-ui/react-alert-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { cn } from '@/lib/utils'

const overlay = 'fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_140ms_ease-out]'
const content =
  'fixed left-1/2 top-1/2 z-[61] w-[min(92vw,var(--w,520px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line2 bg-s1 shadow-[var(--shadow-pop)] max-h-[88vh] flex flex-col'

export function Dialog({
  open, onOpenChange, title, description, children, footer, width = 520,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content className={content} style={{ ['--w' as string]: `${width}px` }} aria-describedby={description ? undefined : undefined}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <D.Title className="text-section font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-body text-t2">{description}</D.Description> : null}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X size={16} />
              </Button>
            </D.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/** Required for every destructive action. */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = 'Delete', onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void
}) {
  return (
    <A.Root open={open} onOpenChange={onOpenChange}>
      <A.Portal>
        <A.Overlay className={overlay} />
        <A.Content className={cn(content, 'p-5')} style={{ ['--w' as string]: '440px' }}>
          <A.Title className="text-section font-semibold">{title}</A.Title>
          <A.Description className="mt-2 text-body text-t2">{description}</A.Description>
          <div className="mt-5 flex justify-end gap-2">
            <A.Cancel asChild>
              <Button variant="secondary">Cancel</Button>
            </A.Cancel>
            <A.Action asChild>
              <Button variant="danger" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </A.Action>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  )
}
