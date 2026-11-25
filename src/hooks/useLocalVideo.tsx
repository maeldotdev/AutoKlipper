import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/stores/ui'

export interface LocalVideo {
  src: string
  name: string
  size: number
  duration: number
}

/** Loads a user-picked video into an object URL (real playback, no processing). */
export function useLocalVideo() {
  const [video, setVideo] = useState<LocalVideo | null>(null)
  const urlRef = useRef<string | null>(null)

  const clear = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    setVideo(null)
  }, [])

  const load = useCallback(
    (file: File) => {
      if (!file.type.startsWith('video/')) {
        toast({ kind: 'error', title: 'Not a video file', body: `${file.name} is ${file.type || 'an unknown type'}. Choose MP4, MOV, MKV or WebM.` })
        return
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      const src = URL.createObjectURL(file)
      urlRef.current = src
      const probe = document.createElement('video')
      probe.preload = 'metadata'
      probe.onloadedmetadata = () => setVideo({ src, name: file.name, size: file.size, duration: probe.duration })
      probe.onerror = () => {
        URL.revokeObjectURL(src)
        urlRef.current = null
        toast({ kind: 'error', title: 'Could not read this video', body: 'The codec may not be supported by the preview player. Exporting through FFmpeg can still work.' })
      }
      probe.src = src
    },
    [],
  )

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  return { video, load, clear }
}
