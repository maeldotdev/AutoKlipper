/* Gaming layout geometry. `splitSources` mirrors `split_graph` in `src-tauri/src/media/render.rs`,
   so the preview shows what the export will contain. */
import type { Split } from '@/types'

export const DEFAULT_SPLIT: Split = { x: 0, y: 0.65, w: 0.28, h: 0.35, share: 0.35, gy: 0.5 }

const MIN = 0.05
/** How close, as a part of the whole travel, a dragged value must be to jump onto a snap point. */
const SNAP = 0.03
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Pull `n` onto the nearest point when it is close. */
export const snap = (n: number, points: number[]) => points.find((p) => Math.abs(n - p) <= SNAP) ?? n

/** Box width over box height (both as parts of the source) that fills the camera area exactly. */
const boxRatio = (share: number, sourceAspect: number) => 9 / (16 * share) / sourceAspect

/** Give the box the shape of the camera area, keeping its centre and width, so nothing is trimmed
    and what is inside the box lands in the middle below the game. */
export function fitBox(s: Split, sourceAspect: number): Split {
  const k = boxRatio(s.share, sourceAspect)
  const w = clamp(s.w, MIN, Math.min(1, k))
  const h = w / k
  const x = clamp(s.x + s.w / 2 - w / 2, 0, 1 - w)
  const y = clamp(s.y + s.h / 2 - h / 2, 0, 1 - h)
  return { ...s, x, y, w, h }
}

export const isFitted = (s: Split, sourceAspect: number) => Math.abs(s.w / s.h / boxRatio(s.share, sourceAspect) - 1) < 0.01

/** Move the box; with `snapping` it jumps to the edges and the middle of the source. */
export function moveBox(s: Split, dx: number, dy: number, snapping = true): Split {
  const to = (at: number, room: number) => {
    const v = clamp(at, 0, room)
    return snapping ? snap(v, [0, room / 2, room]) : v
  }
  return { ...s, x: to(s.x + dx, 1 - s.w), y: to(s.y + dy, 1 - s.h) }
}

/** Resize from the bottom right corner, keeping the shape. */
export function resizeBox(s: Split, dw: number, sourceAspect: number): Split {
  const k = boxRatio(s.share, sourceAspect)
  const w = clamp(s.w + dw, MIN, Math.min(1 - s.x, (1 - s.y) * k))
  return { ...s, w, h: w / k }
}

type Rect = [number, number, number, number]

/** The source rectangles for each half of an `outW` by `outH` picture. */
export function splitSources(iw: number, ih: number, outW: number, outH: number, s: Split, cropX: number, zoom: number): { game: Rect; face: Rect; gameHeight: number } {
  const faceHeight = Math.round((outH * s.share) / 2) * 2
  const gameHeight = outH - faceHeight
  const rg = outW / gameHeight
  const gw = Math.min(iw, ih * rg) / zoom
  const gh = Math.min(ih, iw / rg) / zoom
  const game: Rect = [(iw - gw) * (cropX / 100), (ih - gh) * (s.gy ?? 0.5), gw, gh]
  // The camera box fills its half; whatever does not fit its shape is trimmed evenly.
  const bw = iw * s.w
  const bh = ih * s.h
  const rf = outW / faceHeight
  const fw = bw / bh > rf ? bh * rf : bw
  const fh = bw / bh > rf ? bh : bw / rf
  const face: Rect = [iw * s.x + (bw - fw) / 2, ih * s.y + (bh - fh) / 2, fw, fh]
  return { game, face, gameHeight }
}

/** Where the two pictures meet, 0..100 down the video. Mirrors `Split::seam` in the backend. */
export const seam = (s: Split) => (s.top ? s.share : 1 - s.share) * 100
