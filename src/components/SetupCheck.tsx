import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { IS_MOCK_BACKEND, api } from '@/services'
import { useSettings } from '@/stores/settings'

export interface Tool {
  name: string
  why: string
  command: string
  found: boolean
  /** Settings key for a hand-picked program file. */
  setting?: 'ffmpegPath' | 'ytdlpPath'
}

/** Which free programs are on this PC. */
export function useToolCheck() {
  const [tools, setTools] = useState<Tool[]>([])
  const [aiReady, setAiReady] = useState(true)
  const [busy, setBusy] = useState(false)
  const check = useCallback(async () => {
    setBusy(true)
    const [ff, yt, ai] = await Promise.all([
      api.media.ffmpegStatus().catch(() => null),
      api.media.ytdlpStatus().catch(() => null),
      api.ai.status().catch(() => null),
    ])
    setTools([
      { name: 'FFmpeg', why: 'needed to read and export video', command: 'winget install Gyan.FFmpeg', found: !!ff?.found, setting: 'ffmpegPath' },
      { name: 'yt-dlp', why: 'needed to import from links', command: 'winget install yt-dlp.yt-dlp', found: !!yt?.found, setting: 'ytdlpPath' },
      { name: 'Python', why: 'needed for captions and highlights', command: 'winget install Python.Python.3.12', found: !!ai?.pythonFound },
    ])
    setAiReady(!!ai?.ready)
    setBusy(false)
  }, [])
  useEffect(() => {
    if (!IS_MOCK_BACKEND) void check()
  }, [check])
  return { tools, aiReady, busy, check }
}

/** Dashboard reminder while something is still missing. Shows nothing when all is ready. */
export function SetupCheck() {
  const { tools, aiReady, busy, check } = useToolCheck()
  const set = useSettings((s) => s.set)
  const missing = tools.filter((t) => !t.found)
  if (!tools.length || (!missing.length && aiReady)) return null
  return (
    <section className="panel flex flex-wrap items-center gap-3 p-4" aria-label="Setup">
      <div className="mr-auto">
        <h2 className="text-section font-semibold">Setup is not finished</h2>
        <p className="mt-0.5 text-label text-t2">{missing.length ? `Not found: ${missing.map((t) => t.name).join(', ')}.` : 'Local AI is not set up, so there are no captions or highlights yet.'}</p>
      </div>
      <Button size="sm" loading={busy} onClick={() => void check()}>Check again</Button>
      <Button size="sm" variant="primary" onClick={() => set({ setupDone: false })}>Open setup</Button>
    </section>
  )
}
