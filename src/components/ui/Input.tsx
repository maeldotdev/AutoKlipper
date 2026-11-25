import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ref, ...p }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn('field w-full', className)} {...p} />
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('field h-auto w-full resize-none py-2', className)} {...p} />
}

/** Label above input, hint or error below. Passes the generated id to its child. */
export function Field({
  label, hint, error, children, className,
}: {
  label: string
  hint?: string
  error?: string | null
  className?: string
  children: (id: string, describedBy: string | undefined) => ReactNode
}) {
  const id = useId()
  const msgId = `${id}-msg`
  const msg = error || hint
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-label font-medium text-t2">
        {label}
      </label>
      {children(id, msg ? msgId : undefined)}
      {msg ? (
        <p id={msgId} className={cn('text-meta', error ? 'text-bad' : 'text-t3')} role={error ? 'alert' : undefined}>
          {msg}
        </p>
      ) : null}
    </div>
  )
}
