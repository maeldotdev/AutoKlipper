import { Captions, Check, Clapperboard, Download, Pencil, Play, Search, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Page, Thumb } from '@/components/Common'
import { Button } from '@/components/ui/Button'
import { Select, Switch } from '@/components/ui/Controls'
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog'
import { Badge, EmptyState, Skeleton } from '@/components/ui/Display'
import { Input } from '@/components/ui/Input'
import { ASPECT_DIMS, CAPTION_STATUS, EXPORT_STATUS, TARGETS } from '@/lib/labels'
import { cn, fmtDuration } from '@/lib/utils'
import { useLibrary } from '@/stores/library'
import { useSettings } from '@/stores/settings'
import { useAi } from '@/stores/ai'
import { IS_MOCK_BACKEND, api } from '@/services'
import { toast } from '@/stores/ui'
import type { AspectRatio, Clip, ExportStatus, TargetPlatform } from '@/types'
import { ReviewDialog } from '@/components/ReviewDialog'

export function MyClips() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const projectId = params.get('project')
  const { clips, projects, status, deleteClips, exportClips } = useLibrary()
  const folder = useSettings((s) => s.exportFolder)
  const [q, setQ] = useState('')
  const [target, setTarget] = useState<'all' | TargetPlatform>('all')
  const [aspect, setAspect] = useState<'all' | AspectRatio>('all')
  const [exp, setExp] = useState<'all' | ExportStatus>('all')
  const [sel, setSel] = useState<string[]>([])
  const [preview, setPreview] = useState<Clip | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [withSrt, setWithSrt] = useState(false)
  const [burn, setBurn] = useState(true)
  const [follow, setFollow] = useState(false)
  const [preparing, setPreparing] = useState('')
  const faceReady = useAi((s) => !!s.status?.faceReady)
  const updateClip = useLibrary((s) => s.updateClip)

  /** Track faces one clip at a time, then queue the whole batch. */
  const startBatch = async () => {
    const ids = [...sel]
    if (follow && faceReady) {
      const todo = ids.filter((id) => !clips.find((c) => c.id === id)?.track?.length)
      for (let i = 0; i < todo.length; i++) {
        setPreparing(`Following faces, ${i + 1} of ${todo.length}`)
        try {
          updateClip(todo[i], { track: await api.ai.trackFaces(todo[i]) })
        } catch (e) {
          toast({ kind: 'warning', title: clips.find((c) => c.id === todo[i])?.title ?? 'Clip', body: String(e) })
        }
      }
      setPreparing('')
    }
    exportClips(ids, { burnCaptions: burn, writeSrt: withSrt })
    if (IS_MOCK_BACKEND) toast({ kind: 'info', title: `Simulated export of ${ids.length}`, body: 'Follow progress in History.' })
    setBatchOpen(false)
    setSel([])
  }
  const [confirmDel, setConfirmDel] = useState(false)
  const [review, setReview] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const savedLayout = useSettings((s) => s.savedLayout)
  const [shape, setShape] = useState<'keep' | AspectRatio>('keep')
  const [captionsTo, setCaptionsTo] = useState<'keep' | 'on' | 'off'>('keep')
  const [layoutTo, setLayoutTo] = useState<'keep' | 'saved' | 'off'>('keep')
  const [hookTo, setHookTo] = useState<'keep' | 'title' | 'off'>('keep')

  /** Change the selected clips together. Only what was changed in the dialog is touched. */
  const applyEdit = () => {
    for (const id of sel) {
      const c = clips.find((x) => x.id === id)
      if (!c) continue
      const patch: Partial<Clip> = {}
      if (shape !== 'keep') patch.aspect = shape
      if (captionsTo !== 'keep') patch.captions = captionsTo === 'on' ? 'generated' : 'none'
      if (layoutTo === 'saved' && savedLayout) Object.assign(patch, { split: savedLayout.split, cropX: savedLayout.cropX, zoom: savedLayout.zoom, aspect: '9:16' })
      if (layoutTo === 'off' && c.split?.share) patch.split = { ...c.split, share: 0 }
      if (hookTo !== 'keep') patch.hook = hookTo === 'title' ? c.title.slice(0, 120) : ''
      if (Object.keys(patch).length) updateClip(id, patch)
    }
    toast({ kind: 'success', title: `Updated ${sel.length} clip${sel.length === 1 ? '' : 's'}` })
    setEditOpen(false)
  }

  const project = projects.find((p) => p.id === projectId)
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return clips.filter(
      (c) =>
        (!projectId || c.projectId === projectId) &&
        (target === 'all' || c.target === target) &&
        (aspect === 'all' || c.aspect === aspect) &&
        (exp === 'all' || c.exportStatus === exp) &&
        (!s || c.title.toLowerCase().includes(s)),
    )
  }, [clips, projectId, q, target, aspect, exp])

  const allSelected = shown.length > 0 && shown.every((c) => sel.includes(c.id))
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <Page className="flex flex-col gap-4">
      {project ? (
        <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/[0.07] px-4 py-2.5 text-body">
          <span>Showing clips from <strong className="font-semibold">{project.title}</strong></span>
          <Button size="sm" variant="primary" className="ml-auto" disabled={!shown.length} onClick={() => setReview(true)}><Play size={13} />Review picks</Button>
          <Button size="sm" onClick={() => setParams({})}><X size={13} />Show all clips</Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-t3" />
          <Input aria-label="Search clips" placeholder="Search clips" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div className="w-44"><Select aria-label="Platform" value={target} onChange={setTarget} options={[{ value: 'all', label: 'All platforms' }, ...(Object.keys(TARGETS) as TargetPlatform[]).map((t) => ({ value: t, label: TARGETS[t] }))]} /></div>
        <div className="w-36"><Select aria-label="Aspect ratio" value={aspect} onChange={setAspect} options={[{ value: 'all', label: 'All ratios' }, ...(Object.keys(ASPECT_DIMS) as AspectRatio[]).map((a) => ({ value: a, label: a }))]} /></div>
        <div className="w-44"><Select aria-label="Export status" value={exp} onChange={setExp} options={[{ value: 'all', label: 'Any export state' }, ...(Object.keys(EXPORT_STATUS) as ExportStatus[]).map((e) => ({ value: e, label: EXPORT_STATUS[e].label }))]} /></div>
        <label className="ml-auto flex items-center gap-2 text-body text-t2">
          <input type="checkbox" className="accent-[var(--accent)]" checked={allSelected} onChange={() => setSel(allSelected ? [] : shown.map((c) => c.id))} />
          Select all {shown.length}
        </label>
      </div>

      {status !== 'ready' ? (
        <div className="grid grid-cols-5 gap-4">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="aspect-[9/13]" />)}</div>
      ) : shown.length === 0 ? (
        <section className="panel">
          <EmptyState
            icon={Clapperboard}
            title={clips.length === 0 ? 'No clips yet' : 'No clips match these filters'}
            body={clips.length === 0 ? 'Generate clips from a video and they land here, ready to preview, edit and export.' : 'Widen the filters or clear the search.'}
            action={clips.length === 0 ? <Button variant="primary" onClick={() => nav('/auto-clipper')}>Open Auto Clipper</Button> : <Button onClick={() => { setQ(''); setTarget('all'); setAspect('all'); setExp('all'); setParams({}) }}>Clear filters</Button>}
          />
        </section>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4 pb-16">
          {shown.map((c) => {
            const on = sel.includes(c.id)
            const e = EXPORT_STATUS[c.exportStatus]
            const dims = ASPECT_DIMS[c.aspect]
            return (
              <li key={c.id} className={cn('panel group relative overflow-hidden transition-[border-color,box-shadow] duration-150', on ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'hover:border-line2')}>
                <button className="no-drag block w-full" onClick={() => setPreview(c)} aria-label={`Preview ${c.title}`}>
                  <Thumb hue={c.hue} of={{ projectId: c.projectId, clipId: c.id, at: c.startSec }} ratio={9 / 12} duration={c.endSec - c.startSec} className="w-full">
                    <span className="absolute left-2 top-2 z-[1] rounded bg-black/55 px-1.5 py-px font-mono text-meta text-white">{c.aspect}</span>
                    <span className="absolute inset-0 z-[1] flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-150 group-hover:opacity-100"><Play size={26} className="text-white" /></span>
                  </Thumb>
                </button>
                <label className={cn('absolute right-2 top-2 z-[2] flex h-6 w-6 items-center justify-center rounded-md border bg-black/55 transition-opacity duration-150', on ? 'border-accent bg-accent text-accent-fg opacity-100' : 'border-white/30 opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(c.id)} aria-label={`Select ${c.title}`} />
                  {on ? <Check size={14} /> : null}
                </label>
                <div className="p-3">
                  <p className="truncate text-body font-medium" title={c.title}>{c.title}</p>
                  <p className="mt-0.5 text-meta text-t3">{TARGETS[c.target]}, {dims.label}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone={e.tone}>{e.label}</Badge>
                    <Badge tone={c.captions === 'none' ? 'neutral' : 'cyan'}><Captions size={11} />{c.captions === 'none' ? 'None' : c.captions === 'styled' ? 'Styled' : 'Generated'}</Badge>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {sel.length > 0 ? (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-line2 bg-s2 py-2.5 pl-4 pr-2.5 shadow-[var(--shadow-pop)]">
          <span className="text-body font-medium">{sel.length} selected</span>
          <Button variant="primary" onClick={() => setBatchOpen(true)}><Download size={15} />Export</Button>
          <Button onClick={() => { setShape('keep'); setCaptionsTo('keep'); setLayoutTo('keep'); setHookTo('keep'); setEditOpen(true) }}><Pencil size={15} />Change</Button>
          <Button variant="danger" onClick={() => setConfirmDel(true)}><Trash2 size={15} />Delete</Button>
          <Button variant="ghost" size="icon" aria-label="Clear selection" onClick={() => setSel([])}><X size={16} /></Button>
        </div>
      ) : null}

      <Dialog
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title={preview?.title ?? ''}
        description={preview ? `${TARGETS[preview.target]}, ${preview.aspect}, ${fmtDuration(preview.endSec - preview.startSec)}` : undefined}
        width={560}
        footer={preview ? <><Button onClick={() => setPreview(null)}>Close</Button>{preview.exportPath ? <Button onClick={() => void api.media.reveal(preview.exportPath!).catch((e) => toast({ kind: 'error', title: 'Cannot open the file', body: String(e) }))}>Show file</Button> : null}<Button variant="primary" onClick={() => nav(`/editor/${preview.id}`)}><Pencil size={15} />Open in editor</Button></> : undefined}
      >
        {preview ? (
          <div className="flex flex-col items-center gap-4">
            <Thumb hue={preview.hue} of={{ projectId: preview.projectId, clipId: preview.id, at: preview.startSec }} ratio={preview.aspect === '16:9' ? 16 / 9 : preview.aspect === '1:1' ? 1 : preview.aspect === '4:5' ? 4 / 5 : 9 / 16} className="h-[360px] rounded-md ring-1 ring-line" />
            <p className="text-label text-t3">{preview.reason ? `Picked because: ${preview.reason}.` : 'Open the clip in the editor to play it.'}</p>
            <dl className="grid w-full grid-cols-3 gap-3 text-body">
              <div><dt className="text-meta text-t3">Highlight score</dt><dd className="font-mono">{preview.score}</dd></div>
              <div><dt className="text-meta text-t3">Captions</dt><dd>{CAPTION_STATUS[preview.captions]}</dd></div>
              <div><dt className="text-meta text-t3">Export</dt><dd>{EXPORT_STATUS[preview.exportStatus].label}</dd></div>
            </dl>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        title={`Export ${sel.length} clip${sel.length === 1 ? '' : 's'}`}
        description="Settings apply to every selected clip."
        width={460}
        footer={
          <>
            <Button onClick={() => setBatchOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={!!preparing} onClick={() => void startBatch()}>{preparing || (IS_MOCK_BACKEND ? 'Start simulated export' : 'Start export')}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3.5 text-body">
          <div className="flex justify-between"><span className="text-t2">Format</span><span>MP4, H.264, 1080p, 30 fps</span></div>
          <div className="flex justify-between gap-4"><span className="text-t2">Folder</span><span className="truncate font-mono text-label" title={folder}>{folder}</span></div>
          {IS_MOCK_BACKEND ? null : <div className="flex items-center justify-between"><span className="text-t2">Follow faces{faceReady ? '' : ' (set up in Settings, AI)'}</span><Switch label="Follow faces" checked={follow && faceReady} onChange={setFollow} disabled={!faceReady} /></div>}
          <div className="flex items-center justify-between"><span className="text-t2">Burn in captions</span><Switch label="Burn in captions" checked={burn} onChange={setBurn} /></div>
          <div className="flex items-center justify-between"><span className="text-t2">Include SRT subtitle file</span><Switch label="Include SRT subtitle file" checked={withSrt} onChange={setWithSrt} /></div>
          {IS_MOCK_BACKEND ? <p className="rounded-md border border-warn/25 bg-warn/10 px-3 py-2 text-label text-warn">Prototype: this simulates an export. No file is written.</p> : <p className="rounded-md border border-line bg-s2 px-3 py-2 text-label text-t2">Each clip is cut from its source video and reframed. Captions use your current Caption Studio style; clips with captions switched off stay clean. A clip with captions on but no transcript is refused.</p>}
        </div>
      </Dialog>

      {review && projectId ? <ReviewDialog projectId={projectId} onClose={() => setReview(false)} /> : null}

      <Dialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title={`Change ${sel.length} clip${sel.length === 1 ? '' : 's'}`}
        description="Anything left on Keep stays as it is."
        width={460}
        footer={<><Button onClick={() => setEditOpen(false)}>Cancel</Button><Button variant="primary" onClick={applyEdit}>Apply</Button></>}
      >
        <div className="flex flex-col gap-3.5 text-body">
          <div className="flex items-center justify-between gap-4"><span className="text-t2">Shape</span><div className="w-52"><Select aria-label="Shape" value={shape} onChange={setShape} options={[{ value: 'keep', label: 'Keep' }, ...(Object.keys(ASPECT_DIMS) as AspectRatio[]).map((a) => ({ value: a, label: a }))]} /></div></div>
          <div className="flex items-center justify-between gap-4"><span className="text-t2">Captions</span><div className="w-52"><Select aria-label="Captions" value={captionsTo} onChange={setCaptionsTo} options={[{ value: 'keep', label: 'Keep' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} /></div></div>
          <div className="flex items-center justify-between gap-4"><span className="text-t2">Gaming layout</span><div className="w-52"><Select aria-label="Gaming layout" value={layoutTo} onChange={setLayoutTo} options={[{ value: 'keep', label: 'Keep' }, ...(savedLayout ? [{ value: 'saved' as const, label: 'My saved layout' }] : []), { value: 'off', label: 'Off' }]} /></div></div>
          <div className="flex items-center justify-between gap-4"><span className="text-t2">Hook title</span><div className="w-52"><Select aria-label="Hook title" value={hookTo} onChange={setHookTo} options={[{ value: 'keep', label: 'Keep' }, { value: 'title', label: "Use each clip's title" }, { value: 'off', label: 'Off' }]} /></div></div>
          {savedLayout ? null : <p className="text-label text-t3">To put a gaming layout on many clips, save one first: open a clip, Frame tab, Save as my layout.</p>}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title={`Delete ${sel.length} clip${sel.length === 1 ? '' : 's'}?`}
        description="The clips are removed from AutoKlipper. Exported files on disk are not touched. This cannot be undone."
        confirmLabel="Delete clips"
        onConfirm={() => { deleteClips(sel); toast({ kind: 'success', title: `${sel.length} clip${sel.length === 1 ? '' : 's'} deleted` }); setSel([]); setConfirmDel(false) }}
      />
    </Page>
  )
}
