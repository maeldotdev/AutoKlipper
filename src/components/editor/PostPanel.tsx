import { Copy, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { IS_MOCK_BACKEND, api } from '@/services'
import { useLibrary } from '@/stores/library'
import { toast } from '@/stores/ui'
import type { Clip } from '@/types'

/** The caption, hashtags and credit to paste when posting this clip. */
export function PostPanel({ clip }: { clip: Clip }) {
  const credit = useLibrary((s) => s.projects.find((p) => p.id === clip.projectId)?.uploader ?? '')
  const updateClip = useLibrary((s) => s.updateClip)
  const setCredit = useLibrary((s) => s.setCredit)
  const applyPost = useLibrary((s) => s.applyPost)
  const [text, setText] = useState(clip.post ?? '')
  const [name, setName] = useState(credit)
  const [busy, setBusy] = useState(false)
  // Text written in the background arrives after the editor is open.
  useEffect(() => setText(clip.post ?? ''), [clip.post])

  const write = async () => {
    setBusy(true)
    try {
      await setCredit(clip.projectId, name)
      const next = await api.ai.writePost(clip.id)
      applyPost(clip.id, next)
      setText(next ?? '')
    } catch (e) {
      toast({ kind: 'warning', title: 'Post text', body: String(e) })
    } finally {
      setBusy(false)
    }
  }

  const copy = () =>
    void navigator.clipboard.writeText(text).then(
      () => toast({ kind: 'success', title: 'Copied', body: 'Paste it where you post the clip.' }),
      () => toast({ kind: 'warning', title: 'Could not copy', body: 'Select the text and press Ctrl+C.' }),
    )

  return (
    <div className="flex flex-col gap-4 p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-t2">Caption, hashtags and credit</span>
        <textarea
          aria-label="Post text"
          value={text}
          rows={10}
          maxLength={3000}
          placeholder={IS_MOCK_BACKEND ? 'Post text is written in the desktop app.' : 'Nothing written yet. Press Write it.'}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== (clip.post ?? '') && updateClip(clip.id, { post: text })}
          className="w-full resize-y rounded-md border border-line bg-s2 px-3 py-2 text-body text-t1 placeholder:text-t3"
        />
      </label>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" disabled={!text.trim()} onClick={copy}><Copy size={15} />Copy</Button>
        <Button className="flex-1" loading={busy} disabled={IS_MOCK_BACKEND} onClick={() => void write()}>{busy ? null : <RefreshCw size={15} />}{text ? 'Write again' : 'Write it'}</Button>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-t2">Credit to</span>
        <Input aria-label="Credit to" maxLength={200} value={name} placeholder="Channel or creator name" onChange={(e) => setName(e.target.value)} onBlur={() => name !== credit && void setCredit(clip.projectId, name)} />
      </label>
      <p className="text-meta text-t3">Written on this computer: by your Ollama model when it is running, otherwise from the words in the clip. Hashtags are not live trends. A credit is not permission, so post only what you may use.</p>
    </div>
  )
}
