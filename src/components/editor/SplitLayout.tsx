import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { fitBox, isFitted, moveBox, resizeBox, seam, snap, splitSources } from '@/lib/split'
import type { Split } from '@/types'

/** Redraw a canvas from the video every frame, so both halves stay exactly in step with it. */
function useVideoPaint(videoRef: RefObject<HTMLVideoElement | null>, paint: (g: CanvasRenderingContext2D, v: HTMLVideoElement, canvas: HTMLCanvasElement) => void) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const painter = useRef(paint)
  useEffect(() => {
    painter.current = paint
  })
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const canvas = canvasRef.current
      const v = videoRef.current
      const g = canvas?.getContext('2d')
      if (canvas && g && v && v.videoWidth && v.readyState >= 2) painter.current(g, v, canvas)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [videoRef])
  return canvasRef
}

/** Follow the pointer until it is let go. `move` gets the distance from where the drag began. */
function startDrag(e: ReactPointerEvent, move: (dx: number, dy: number) => void, done: () => void) {
  e.preventDefault()
  e.stopPropagation()
  const x = e.clientX
  const y = e.clientY
  const onMove = (ev: PointerEvent) => move(ev.clientX - x, ev.clientY - y)
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    done()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/** Lines shown while a dragged part sits on a middle snap point. */
function Guides({ x, y }: { x: boolean; y: boolean }) {
  return (
    <>
      {x ? <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-cyan" /> : null}
      {y ? <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-cyan" /> : null}
    </>
  )
}

const at = (n: number, point: number) => Math.abs(n - point) < 0.001

export interface FrameChange {
  split?: Split
  cropX?: number
}

/** The gaming layout as it will be exported: game on top, camera below, or swapped. With `onChange`, each half
    can be dragged to move what it shows. */
export function SplitPicture({ videoRef, split, cropX, zoom, onChange }: { videoRef: RefObject<HTMLVideoElement | null>; split: Split; cropX: number; zoom: number; onChange?: (c: FrameChange) => void }) {
  const ref = useVideoPaint(videoRef, (g, v, c) => {
    const { game, face, gameHeight } = splitSources(v.videoWidth, v.videoHeight, c.width, c.height, split, cropX, zoom)
    const faceHeight = c.height - gameHeight
    g.drawImage(v, ...game, 0, split.top ? faceHeight : 0, c.width, gameHeight)
    g.drawImage(v, ...face, 0, split.top ? 0 : gameHeight, c.width, faceHeight)
  })
  const [dragging, setDragging] = useState<'game' | 'camera' | null>(null)

  const drag = (part: 'game' | 'camera') => (e: ReactPointerEvent<HTMLDivElement>) => {
    const v = videoRef.current
    if (!v?.videoWidth || !onChange) return
    const zone = e.currentTarget.getBoundingClientRect()
    const from = { split, cropX }
    const { game } = splitSources(v.videoWidth, v.videoHeight, 540, 960, split, cropX, zoom)
    setDragging(part)
    startDrag(
      e,
      (dx, dy) => {
        // The picture follows the pointer, so the part of the source shown moves the other way.
        if (part === 'camera') return onChange({ split: moveBox(from.split, (-dx / zone.width) * from.split.w, (-dy / zone.height) * from.split.h) })
        const spareX = v.videoWidth - game[2]
        const spareY = v.videoHeight - game[3]
        const nextX = spareX > 1 ? snap(Math.min(1, Math.max(0, from.cropX / 100 - ((dx / zone.width) * game[2]) / spareX)), [0, 0.5, 1]) : from.cropX / 100
        const gy = from.split.gy ?? 0.5
        const nextY = spareY > 1 ? snap(Math.min(1, Math.max(0, gy - ((dy / zone.height) * game[3]) / spareY)), [0, 0.5, 1]) : gy
        onChange({ cropX: Math.round(nextX * 100), split: { ...from.split, gy: nextY } })
      },
      () => setDragging(null),
    )
  }

  const zone = 'no-drag absolute inset-x-0 z-[1] cursor-grab touch-none active:cursor-grabbing'
  const cut = seam(split)
  // Each picture's area to drag: the one on top ends at the seam, the other starts there.
  const gameArea = split.top ? { top: `${cut}%`, bottom: 0 } : { top: 0, height: `${cut}%` }
  const cameraArea = split.top ? { top: 0, height: `${cut}%` } : { top: `${cut}%`, bottom: 0 }
  return (
    <>
      <canvas ref={ref} width={540} height={960} aria-hidden className="absolute inset-0 h-full w-full" />
      {onChange ? (
        <>
          <div title="Drag to move the game" onPointerDown={drag('game')} className={zone} style={gameArea}>
            {dragging === 'game' ? <Guides x={cropX === 50} y={false} /> : null}
          </div>
          <div title="Drag to move the camera" onPointerDown={drag('camera')} className={`${zone} border-white/25 ${split.top ? 'border-b' : 'border-t'}`} style={cameraArea}>
            {dragging === 'camera' ? <Guides x={at(split.x, (1 - split.w) / 2)} y={at(split.y, (1 - split.h) / 2)} /> : null}
          </div>
        </>
      ) : null}
    </>
  )
}

/** The whole source picture with the camera box on it: drag to move, drag the corner to resize. */
export function CameraBox({ videoRef, split, onChange }: { videoRef: RefObject<HTMLVideoElement | null>; split: Split; onChange: (s: Split) => void }) {
  const ref = useVideoPaint(videoRef, (g, v, c) => {
    const height = Math.round((c.width * v.videoHeight) / v.videoWidth)
    if (c.height !== height) c.height = height
    g.drawImage(v, 0, 0, c.width, c.height)
    // Keep the box in the shape of the camera area, whatever changed it.
    const source = v.videoWidth / v.videoHeight
    if (!isFitted(split, source)) onChange(fitBox(split, source))
  })
  const [dragging, setDragging] = useState(false)
  const sourceAspect = () => {
    const v = videoRef.current
    return v?.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9
  }

  const drag = (mode: 'move' | 'resize') => (e: ReactPointerEvent) => {
    const area = ref.current!.getBoundingClientRect()
    const from = split
    setDragging(true)
    startDrag(
      e,
      (dx, dy) => onChange(mode === 'move' ? moveBox(from, dx / area.width, dy / area.height) : resizeBox(from, dx / area.width, sourceAspect())),
      () => setDragging(false),
    )
  }

  const key = (e: ReactKeyboardEvent) => {
    const step = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] }[e.key]
    if (!step) return
    e.preventDefault()
    e.stopPropagation()
    // Arrow keys are for fine moves, so they do not snap.
    onChange(e.shiftKey ? resizeBox(split, step[0] || step[1], sourceAspect()) : moveBox(split, step[0], step[1], false))
  }

  const pct = (n: number) => `${n * 100}%`
  return (
    <div className="relative select-none overflow-hidden rounded-md border border-line bg-s2">
      <canvas ref={ref} width={344} height={194} aria-hidden className="block w-full" />
      {dragging ? <Guides x={at(split.x, (1 - split.w) / 2)} y={at(split.y, (1 - split.h) / 2)} /> : null}
      <div
        role="group"
        tabIndex={0}
        aria-label="Camera box. Arrow keys move it, Shift with arrows resizes it."
        onPointerDown={drag('move')}
        onKeyDown={key}
        className="no-drag absolute cursor-move touch-none border-2 border-accent bg-accent/10"
        style={{ left: pct(split.x), top: pct(split.y), width: pct(split.w), height: pct(split.h) }}
      >
        <span onPointerDown={drag('resize')} className="absolute -bottom-1.5 -right-1.5 size-3.5 cursor-nwse-resize rounded-sm bg-accent" />
      </div>
    </div>
  )
}
