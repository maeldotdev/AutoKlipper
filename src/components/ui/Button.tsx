import type { ButtonHTMLAttributes, Ref } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg font-medium hover:brightness-110 active:brightness-95 shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent)_70%,white_10%)_inset,0_8px_22px_-10px_var(--accent)]',
  secondary: 'bg-s3 text-t1 hover:bg-sh border border-line',
  outline: 'border border-line2 text-t1 hover:bg-s2',
  ghost: 'text-t2 hover:text-t1 hover:bg-s2',
  danger: 'bg-bad/12 text-bad border border-bad/30 hover:bg-bad/20',
}
const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-label gap-1.5 rounded-md',
  md: 'h-[var(--control-h)] px-3.5 text-body gap-2 rounded-md',
  lg: 'h-10 px-5 text-section gap-2 rounded-md',
  icon: 'h-[var(--control-h)] w-[var(--control-h)] rounded-md justify-center',
  'icon-sm': 'h-7 w-7 rounded-md justify-center',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ref, type = 'button', ...rest }: Props) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'no-drag inline-flex shrink-0 items-center whitespace-nowrap transition-[background-color,color,filter,border-color,opacity] duration-150 disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="spin" aria-hidden /> : null}
      {children}
    </button>
  )
}
