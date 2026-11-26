import { useEffect } from 'react'
import { previewUrl } from '@/lib/native'
import { IS_MOCK_BACKEND, api } from '@/services'
import { usePlayhead } from '@/stores/playhead'
import { toast } from '@/stores/ui'
import type { Sfx } from '@/types'

const playing = new Set<HTMLAudioElement>()

/** Play one file from the Sounds folder. */
export function playSound(name: string, volume: number) {
  if (IS_MOCK_BACKEND) return
  void api.sounds
    .file(name)
    .then(previewUrl)
    .then((url) => {
      const a = new Audio(url)
      a.volume = volume
      playing.add(a)
      a.onended = () => playing.delete(a)
      // As long as the export lets an effect run.
      setTimeout(() => {
        a.pause()
        playing.delete(a)
      }, 6000)
      return a.play()
    })
    .catch(() => toast({ kind: 'warning', title: 'Sound not played', body: `${name} is missing from the Sounds folder, or cannot be played here.` }))
}

/** While the preview plays, start each effect when the playhead passes its moment. */
export function useSoundPreview(effects: Sfx[] | null | undefined, clipStart: number) {
  useEffect(() => {
    if (!effects?.length) return
    const stop = usePlayhead.subscribe((now, before) => {
      if (!now.playing) {
        playing.forEach((a) => a.pause())
        playing.clear()
        return
      }
      // A jump (seek or loop) is not playback.
      if (now.time <= before.time || now.time - before.time > 0.5) return
      for (const s of effects) {
        const at = s.at - clipStart
        if (at >= before.time && at < now.time) playSound(s.file, s.volume)
      }
    })
    return () => {
      stop()
      playing.forEach((a) => a.pause())
      playing.clear()
    }
  }, [effects, clipStart])
}
