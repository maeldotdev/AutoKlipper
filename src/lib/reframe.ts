/* Mirrors `src-tauri/src/ai/reframe.rs` so the preview frames a clip exactly as the export will. */

/** [seconds in the source video, face centre as a fraction of its width] */
export type TrackPoint = [number, number]

/** Face centre at a moment, interpolated along the path. */
export function centreAt(track: TrackPoint[], sec: number): number {
  if (sec <= track[0][0]) return track[0][1]
  for (let i = 1; i < track.length; i++) {
    const [t1, c1] = track[i]
    if (sec < t1) {
      const [t0, c0] = track[i - 1]
      return c0 + (c1 - c0) * ((sec - t0) / Math.max(0.001, t1 - t0))
    }
  }
  return track[track.length - 1][1]
}

/** Where the crop window goes (0 left, 1 right) so that `cx` sits in its middle. */
export function cropPosition(cx: number, srcW: number, srcH: number, targetRatio: number, zoom: number): number {
  const window = Math.min(srcW, srcH * targetRatio) / Math.max(1, zoom)
  const room = srcW - window
  if (room <= 0.5) return 0.5
  return Math.min(room, Math.max(0, cx * srcW - window / 2)) / room
}
