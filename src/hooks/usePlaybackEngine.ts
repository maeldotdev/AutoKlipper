import { useEffect, type RefObject } from 'react'
import { usePlayhead } from '@/stores/playhead'

/**
 * Drives the shared playhead. With a loaded <video> the video clock is the source of truth,
 * otherwise a requestAnimationFrame clock plays the mock timeline.
 * `offset` is where the clip starts inside the video, so a clip of a long source plays from its own start.
 */
export function usePlaybackEngine(duration: number, videoRef?: RefObject<HTMLVideoElement | null>, videoKey?: string | null, offset = 0) {
  const playing = usePlayhead((s) => s.playing)

  // Trimming or splitting changes the length: keep the playhead where it is, inside the new range.
  useEffect(() => {
    const ph = usePlayhead.getState()
    ph.setDuration(duration)
    ph.pause()
    if (ph.time > duration) ph.seek(duration)
  }, [duration])

  // Leaving the page starts the next one from zero.
  useEffect(() => () => usePlayhead.setState({ playing: false, time: 0, videoSeek: null }), [])

  useEffect(() => {
    const v = videoRef?.current
    usePlayhead.setState({
      videoSeek: v && videoKey ? (t) => { v.currentTime = t + offset } : null,
    })
    // Show the first frame of the clip, not the start of the whole video.
    if (v && videoKey) v.currentTime = offset + usePlayhead.getState().time
  }, [videoRef, videoKey, offset])

  useEffect(() => {
    const v = videoRef?.current
    const useVideo = !!(v && videoKey)
    if (useVideo) {
      v.playbackRate = usePlayhead.getState().rate
      if (playing) {
        const want = offset + usePlayhead.getState().time
        if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want
        void v.play().catch(() => usePlayhead.getState().pause())
      } else v.pause()
    }
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const st = usePlayhead.getState()
      let t: number
      if (useVideo) t = v.currentTime - offset
      else {
        t = st.time + ((now - last) / 1000) * st.rate
        last = now
      }
      if (t >= st.duration) {
        st.setTime(st.duration)
        st.pause()
        return
      }
      st.setTime(Math.max(0, t))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, videoRef, videoKey, offset])
}
