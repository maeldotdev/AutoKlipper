import { FolderOpen, Play, Plus, Trash2, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Select, Slider } from '@/components/ui/Controls'
import { playSound } from '@/hooks/useSoundPreview'
import { fmtClock } from '@/lib/utils'
import { IS_MOCK_BACKEND, api } from '@/services'
import { useLibrary } from '@/stores/library'
import { usePlayhead } from '@/stores/playhead'
import { toast } from '@/stores/ui'
import type { Clip, Sfx } from '@/types'

/** Sound effects of one clip, from the user's own Sounds folder. */
export function SoundPanel({ clip }: { clip: Clip }) {
  const updateClip = useLibrary((s) => s.updateClip)
  const applySounds = useLibrary((s) => s.applySounds)
  const [names, setNames] = useState<string[]>([])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const effects = clip.sfx ?? []

  const refresh = useCallback(() => {
    void api.sounds.list().then(setNames).catch(() => setNames([]))
  }, [])
  useEffect(() => {
    refresh()
    // Files added in Explorer show up when the window is used again.
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const save = (next: Sfx[]) => updateClip(clip.id, { sfx: [...next].sort((a, b) => a.at - b.at) })
  const change = (i: number, patch: Partial<Sfx>) => save(effects.map((s, n) => (n === i ? { ...s, ...patch } : s)))
  const here = () => +(clip.startSec + usePlayhead.getState().time).toFixed(2)
  const file = pick && names.includes(pick) ? pick : names[0]

  const open = () => void api.sounds.folder().then((p) => api.media.reveal(p)).catch((e) => toast({ kind: 'warning', title: 'Sounds folder', body: String(e) }))

  const suggest = async () => {
    setBusy(true)
    try {
      const next = await api.sounds.suggest(clip.id)
      applySounds(clip.id, next)
      if (!next?.length) toast({ kind: 'info', title: 'No sound added', body: 'Nothing in this clip fits your files. Add one by hand.' })
    } catch (e) {
      toast({ kind: 'warning', title: 'Sound effects', body: String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-b border-line p-4">
      <p className="text-body font-medium">Sound effects</p>
      {names.length === 0 ? (
        <p className="text-meta text-t3">Your Sounds folder is empty. Open it, put in audio files you are allowed to use, and name them by what they are, such as laugh, boom, wow or applause.</p>
      ) : (
        <>
          {effects.length === 0 ? <p className="text-meta text-t3">No sounds on this clip.</p> : null}
          <ul className="flex flex-col gap-3">
            {effects.map((s, i) => (
              <li key={`${s.file}-${s.at}-${i}`} className="rounded-md border border-line bg-s2 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-label" title={s.file}>{s.file}</span>
                  <span className="font-mono text-meta text-t3">{s.at >= clip.startSec && s.at < clip.endSec ? fmtClock(s.at - clip.startSec) : 'outside'}</span>
                  <Button size="sm" variant="ghost" aria-label={`Play ${s.file}`} onClick={() => playSound(s.file, s.volume)}><Play size={13} /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${s.file}`} onClick={() => save(effects.filter((_, n) => n !== i))}><Trash2 size={13} /></Button>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <Slider label={`Volume of ${s.file}`} min={10} max={100} step={5} value={[Math.round(s.volume * 100)]} onChange={([v]) => change(i, { volume: v / 100 })} className="flex-1" />
                  <Button size="sm" onClick={() => change(i, { at: here() })}>Move here</Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1"><Select aria-label="Sound to add" value={file} onChange={setPick} options={names.map((n) => ({ value: n, label: n }))} /></div>
            <Button disabled={effects.length >= 20} onClick={() => save([...effects, { file, at: here(), volume: 0.6 }])}><Plus size={14} />Add here</Button>
          </div>
          <Button loading={busy} disabled={IS_MOCK_BACKEND} onClick={() => void suggest()}>{busy ? null : <Wand2 size={15} />}Choose for me</Button>
        </>
      )}
      <Button variant="ghost" disabled={IS_MOCK_BACKEND} onClick={open}><FolderOpen size={15} />Open Sounds folder</Button>
    </div>
  )
}
