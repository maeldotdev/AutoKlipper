import * as DM from '@radix-ui/react-dropdown-menu'
import * as P from '@radix-ui/react-popover'
import * as TB from '@radix-ui/react-tabs'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useUi, type ToastKind } from '@/stores/ui'
import { cn } from '@/lib/utils'

/* ---------------- Dropdown menu ---------------- */
export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}
export function Menu({ trigger, items, align = 'end' }: { trigger: ReactNode; items: MenuItem[]; align?: 'start' | 'end' }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content
          align={align}
          sideOffset={6}
          className="z-[90] min-w-44 rounded-md border border-line2 bg-s2 p-1 shadow-[var(--shadow-pop)]"
        >
          {items.map((it) => (
            <div key={it.label}>
              {it.separatorBefore ? <DM.Separator className="my-1 h-px bg-line" /> : null}
              <DM.Item
                disabled={it.disabled}
                onSelect={it.onSelect}
                className={cn(
                  'flex h-8 cursor-default items-center gap-2 rounded-sm px-2.5 text-body outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-sh',
                  it.danger ? 'text-bad' : 'text-t1',
                )}
              >
                {it.icon}
                {it.label}
              </DM.Item>
            </div>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

/* ---------------- Popover ---------------- */
export function Popover({ trigger, children, align = 'end', width = 320 }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' | 'center'; width?: number }) {
  return (
    <P.Root>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          align={align}
          sideOffset={8}
          style={{ width }}
          className="z-[90] rounded-lg border border-line2 bg-s2 shadow-[var(--shadow-pop)]"
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

/* ---------------- Tabs ---------------- */
export function Tabs({
  value, onValueChange, tabs, children, className,
}: {
  value: string
  onValueChange: (v: string) => void
  tabs: { value: string; label: string; icon?: ReactNode }[]
  children: ReactNode
  className?: string
}) {
  return (
    <TB.Root value={value} onValueChange={onValueChange} className={cn('flex min-h-0 flex-col', className)}>
      <TB.List className="no-drag flex shrink-0 gap-1 border-b border-line">
        {tabs.map((t) => (
          <TB.Trigger
            key={t.value}
            value={t.value}
            className="relative flex h-9 items-center gap-1.5 px-3 text-body text-t2 transition-colors duration-150 hover:text-t1 data-[state=active]:text-t1 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent after:opacity-0 data-[state=active]:after:opacity-100"
          >
            {t.icon}
            {t.label}
          </TB.Trigger>
        ))}
      </TB.List>
      {children}
    </TB.Root>
  )
}
export const TabPanel = ({ value, children, className }: { value: string; children: ReactNode; className?: string }) => (
  <TB.Content value={value} className={cn('min-h-0 outline-none', className)}>
    {children}
  </TB.Content>
)

/* ---------------- Toasts ---------------- */
const toastIcon: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={17} className="text-ok" />,
  error: <CircleAlert size={17} className="text-bad" />,
  warning: <TriangleAlert size={17} className="text-warn" />,
  info: <Info size={17} className="text-accent" />,
}

export function ToastViewport() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[360px] flex-col gap-2" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto flex gap-3 rounded-lg border border-line2 bg-s2 p-3.5 shadow-[var(--shadow-pop)]"
          >
            <span className="mt-0.5">{toastIcon[t.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium">{t.title}</p>
              {t.body ? <p className="mt-0.5 text-label text-t2">{t.body}</p> : null}
            </div>
            <button
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
              className="no-drag h-6 w-6 rounded text-t3 transition-colors duration-150 hover:bg-s3 hover:text-t1"
            >
              <X size={14} className="mx-auto" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
