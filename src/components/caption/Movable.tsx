import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { clamp } from '@/lib/utils'
import type { TextPlace } from '@/types'

const SNAP = 2

const tidy = (p: TextPlace): TextPlace => ({
  x: +clamp(p.x, 5, 95).toFixed(1),
  y: +clamp(p.y, 3, 95).toFixed(1),
  scale: +clamp(p.scale, 0.4, 2.5).toFixed(2),
})

/**
 * A block of on-screen text the user can drag and resize. It must be a direct child of the video frame,
 * so that positions are percentages of that frame, as in the export.
 */
export function Movable({
  place, onChange, label, anchor, className, style, children,
}: {
  place: TextPlace | null
  /** Absent in read-only previews. */
  onChange?: (p: TextPlace) => void
  label: string
  /** Which part of the block `y` refers to. */
  anchor: 'middle' | 'top'
  className?: string
  style: CSSProperties
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  /** Where the block is now, read from the screen so a first drag does not make it jump. */
  const current = (): TextPlace => {
    if (place) return place
    const el = box.current!
    const frame = el.closest('[data-frame]')!.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return { x: ((r.left + r.width / 2 - frame.left) / frame.width) * 100, y: (((anchor === 'top' ? r.top : r.top + r.height / 2) - frame.top) / frame.height) * 100, scale: 1 }
  }

  // The window is followed, not the block: a quick drag or a resize leaves the text at once.
  const down = (resize: boolean) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !onChange) return
    e.stopPropagation()
    const el = box.current!
    const r = el.getBoundingClientRect()
    const frame = el.closest('[data-frame]')!.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const from = { x: e.clientX, y: e.clientY }
    const start = current()
    const dist = Math.max(8, Math.hypot(from.x - cx, from.y - cy))
    let moved = false

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - from.x
      const dy = ev.clientY - from.y
      // A plain click still reaches the word under the pointer.
      if (!moved && Math.hypot(dx, dy) < 4) return
      if (!moved) {
        moved = true
        setDragging(true)
      }
      if (resize) {
        onChange(tidy({ ...start, scale: (start.scale * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / dist }))
        return
      }
      let x = start.x + (dx / frame.width) * 100
      let y = start.y + (dy / frame.height) * 100
      if (Math.abs(x - 50) < SNAP) x = 50
      if (Math.abs(y - 50) < SNAP) y = 50
      onChange(tidy({ ...start, x, y }))
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      setDragging(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const key = (e: KeyboardEvent) => {
    if (!onChange) return
    const step = e.shiftKey ? 5 : 1
    const p = current()
    const next =
      e.key === 'ArrowLeft' ? { ...p, x: p.x - step }
        : e.key === 'ArrowRight' ? { ...p, x: p.x + step }
          : e.key === 'ArrowUp' ? { ...p, y: p.y - step }
            : e.key === 'ArrowDown' ? { ...p, y: p.y + step }
              : e.key === '+' || e.key === '=' ? { ...p, scale: p.scale + 0.05 }
                : e.key === '-' ? { ...p, scale: p.scale - 0.05 }
                  : null
    if (!next) return
    e.preventDefault()
    e.stopPropagation()
    onChange(tidy(next))
  }

  return (
    <>
      {dragging && place?.x === 50 ? <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-[3] w-px bg-cyan" /> : null}
      {dragging && place?.y === 50 ? <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 z-[3] h-px bg-cyan" /> : null}
      <div className={`pointer-events-none absolute z-[2] ${className ?? ''}`} style={style}>
        <div
          ref={box}
          role={onChange ? 'group' : undefined}
          tabIndex={onChange ? 0 : undefined}
          aria-label={onChange ? `${label}. Drag to move, drag the corner to resize. Arrow keys move, plus and minus resize.` : undefined}
          onPointerDown={onChange ? down(false) : undefined}
          onKeyDown={key}
          className={onChange ? 'group pointer-events-auto relative max-w-full cursor-move touch-none select-none rounded-sm outline-1 outline-dashed outline-transparent hover:outline-cyan focus-visible:outline-cyan' : 'relative max-w-full'}
        >
          {children}
          {onChange ? (
            <span
              aria-hidden
              data-resize
              onPointerDown={down(true)}
              className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-full border border-app bg-cyan opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          ) : null}
        </div>
      </div>
    </>
  )
}
