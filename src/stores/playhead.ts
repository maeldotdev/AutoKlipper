import { create } from 'zustand'
import { clamp } from '@/lib/utils'

/*
 * Shared playhead. Time changes ~60x/s, so it lives outside React state of pages:
 * only leaf components (preview, timeline, clock) subscribe to `time`.
 */
interface Playhead {
  time: number
  playing: boolean
  duration: number
  rate: number
  videoSeek: ((t: number) => void) | null
  setDuration: (d: number) => void
  setTime: (t: number) => void
  seek: (t: number) => void
  toggle: () => void
  pause: () => void
  setRate: (r: number) => void
}

export const usePlayhead = create<Playhead>((set, get) => ({
  time: 0,
  playing: false,
  duration: 18,
  rate: 1,
  videoSeek: null,
  setDuration: (duration) => set({ duration }),
  setTime: (time) => set({ time }),
  seek: (t) => {
    const time = clamp(t, 0, get().duration)
    set({ time })
    get().videoSeek?.(time)
  },
  toggle: () => {
    const s = get()
    if (!s.playing && s.time >= s.duration - 0.05) s.seek(0)
    set({ playing: !s.playing })
  },
  pause: () => set({ playing: false }),
  setRate: (rate) => set({ rate }),
}))
