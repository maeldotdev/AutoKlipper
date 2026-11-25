import * as S from '@radix-ui/react-select'
import * as SW from '@radix-ui/react-switch'
import * as SL from '@radix-ui/react-slider'
import * as TG from '@radix-ui/react-toggle-group'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/* ---------------- Select ---------------- */
export interface Option<T extends string = string> {
  value: T
  label: string
  hint?: string
}

export function Select<T extends string>({
  value, onChange, options, placeholder, id, className, 'aria-label': ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: Option<T>[]
  placeholder?: string
  id?: string
  className?: string
  'aria-label'?: string
}) {
  return (
    <S.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <S.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn('field no-drag flex w-full items-center justify-between gap-2 text-left data-[placeholder]:text-t3', className)}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon>
          <ChevronDown size={15} className="text-t3" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={6}
          className="z-[90] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line2 bg-s2 shadow-[var(--shadow-pop)]"
        >
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="relative flex h-8 cursor-default select-none items-center gap-2 rounded-sm pl-7 pr-3 text-body text-t1 outline-none data-[highlighted]:bg-sh"
              >
                <S.ItemIndicator className="absolute left-2">
                  <Check size={14} className="text-accent" />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
                {o.hint ? <span className="ml-auto text-meta text-t3">{o.hint}</span> : null}
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}

/* ---------------- Switch ---------------- */
export function Switch({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; id?: string; disabled?: boolean }) {
  return (
    <SW.Root
      id={id}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      className="no-drag relative h-[20px] w-[36px] shrink-0 rounded-full border border-line2 bg-s3 transition-colors duration-150 data-[state=checked]:border-transparent data-[state=checked]:bg-accent disabled:opacity-45"
    >
      <SW.Thumb className="block h-[14px] w-[14px] translate-x-[2px] rounded-full bg-t1 transition-transform duration-150 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-fg" />
    </SW.Root>
  )
}

/* ---------------- Slider (single or range) ---------------- */
export function Slider({
  value, onChange, min, max, step = 1, label, className,
}: {
  value: number[]
  onChange: (v: number[]) => void
  min: number
  max: number
  step?: number
  label: string
  className?: string
}) {
  return (
    <SL.Root
      value={value}
      onValueChange={onChange}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      className={cn('no-drag relative flex h-5 w-full touch-none select-none items-center', className)}
    >
      <SL.Track className="relative h-[4px] grow rounded-full bg-s3">
        <SL.Range className="absolute h-full rounded-full bg-accent" />
      </SL.Track>
      {value.map((_, i) => (
        <SL.Thumb
          key={i}
          aria-label={value.length > 1 ? `${label} ${i === 0 ? 'minimum' : 'maximum'}` : label}
          className="block h-4 w-4 rounded-full border-2 border-accent bg-t1 shadow-[0_2px_8px_rgb(0_0_0/0.5)] transition-transform duration-100 hover:scale-110"
        />
      ))}
    </SL.Root>
  )
}

/* ---------------- Segmented (single select) ---------------- */
export function Segmented<T extends string>({
  value, onChange, options, label, className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; title?: string }[]
  label: string
  className?: string
}) {
  return (
    <TG.Root
      type="single"
      value={value}
      aria-label={label}
      onValueChange={(v) => v && onChange(v as T)}
      className={cn('no-drag inline-flex rounded-md border border-line bg-s2 p-0.5', className)}
    >
      {options.map((o) => (
        <TG.Item
          key={o.value}
          value={o.value}
          title={o.title}
          className="flex h-[calc(var(--control-h)-6px)] min-w-8 items-center justify-center gap-1.5 rounded-[5px] px-3 text-label text-t2 transition-colors duration-150 hover:text-t1 data-[state=on]:bg-s3 data-[state=on]:text-t1 data-[state=on]:shadow-[0_0_0_1px_var(--line-strong)]"
        >
          {o.label}
        </TG.Item>
      ))}
    </TG.Root>
  )
}

/* ---------------- Chip toggle (multi) ---------------- */
export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'no-drag h-7 rounded-full border px-3 text-label transition-colors duration-150',
        active ? 'border-accent/60 bg-accent/15 text-t1' : 'border-line text-t2 hover:border-line2 hover:text-t1',
      )}
    >
      {children}
    </button>
  )
}
