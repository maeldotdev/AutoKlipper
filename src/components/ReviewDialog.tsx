import { Check, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { previewUrl } from '@/lib/native'
import { fmtDuration } from '@/lib/utils'
import { api, IS_MOCK_BACKEND } from '@/services'
import { useLibrary } from '@/stores/library'
import type { Clip } from '@/types'

const UNDO_MS = 8000

/** Watch each suggested clip and keep or discard it. A discard waits a few seconds so it can be undone. */
export function ReviewDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const project = useLibrary((s) => s.projects.find((p) => p.id === projectId))
  const deleteClips = useLibrary((s) => s.deleteClips)
  // The list is fixed when the review starts, so positions do not shift while discarding.
  const [clips] = useState<Clip[]>(() => useLibrary.getState().clips.filter((c) => c.projectId === projectId).sort((a, b) => a.startSec - b.startSec))
  const [index, setIndex] = useState(0)
  const [pending, setPending] = useState<Clip | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const waiting = useRef<string | null>(null)
  const clip = clips[index]

  useEffect(() => {
    const path = project?.sourcePath
    if (!path || IS_MOCK_BACKEND) return
    let live = true
    void api.media.probe(path).then(() => previewUrl(path)).then((u) => live && setSrc(u)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [project?.sourcePath])

  useEffect(() => {
    const v = video.current
    if (!v || !clip) return
    v.currentTime = clip.startSec
    void v.play().catch(() => undefined)
  }, [clip, src])

  /** Really delete the clip that is waiting, if any. */
  const commit = () => {
    clearTimeout(timer.current)
    if (waiting.current) deleteClips([waiting.current])
    waiting.current = null
    setPending(null)
  }
  const commitNow = useRef(commit)
  useEffect(() => {
    commitNow.current = commit
  })
  // Closing the review finishes the discard.
  useEffect(() => () => commitNow.current(), [])

  const discard = () => {
    commit()
    waiting.current = clip.id
    setPending(clip)
    timer.current = setTimeout(() => commitNow.current(), UNDO_MS)
    setIndex((i) => i + 1)
  }
  const undo = () => {
    clearTimeout(timer.current)
    const back = clips.findIndex((c) => c.id === waiting.current)
    waiting.current = null
    setPending(null)
    if (back >= 0) setIndex(back)
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Review picks"
      description={clip ? `Clip ${index + 1} of ${clips.length}. ${project?.title ?? ''}` : 'You have seen every clip.'}
      width={640}
      footer={
        <>
          {pending ? <Button variant="ghost" className="mr-auto" onClick={undo}><Undo2 size={15} />Undo discard</Button> : null}
          {clip ? (
            <>
              <Button variant="danger" onClick={discard}><Trash2 size={15} />Discard</Button>
              <Button variant="primary" onClick={() => setIndex((i) => i + 1)}><Check size={15} />Keep</Button>
            </>
          ) : <Button variant="primary" onClick={onClose}>Done</Button>}
        </>
      }
    >
      {clip ? (
        <div className="flex flex-col gap-3">
          {src ? (
            <video
              ref={video}
              src={src}
              controls
              playsInline
              aria-label={clip.title}
              onTimeUpdate={(e) => {
                const v = e.currentTarget
                if (v.currentTime >= clip.endSec || v.currentTime < clip.startSec - 0.5) v.currentTime = clip.startSec
              }}
              className="max-h-[360px] w-full rounded-md bg-black"
            />
          ) : <p className="rounded-md border border-line bg-s2 px-3 py-8 text-center text-label text-t2">The source video cannot be played here.</p>}
          <p className="text-body font-medium">{clip.title}</p>
          <p className="text-label text-t3">{fmtDuration(clip.endSec - clip.startSec)}, score {clip.score}{clip.reason ? `. Picked because: ${clip.reason}.` : '.'}</p>
        </div>
      ) : <p className="text-body text-t2">Discarded clips are removed from AutoKlipper. Your source video is not touched.</p>}
    </Dialog>
  )
}
