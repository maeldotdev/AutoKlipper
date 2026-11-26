import { Download, Film, Scissors, Upload, UserRound } from 'lucide-react'
import { StopJob } from '@/components/StopJob'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Page } from '@/components/Common'
import { PreviewStage } from '@/components/caption/CaptionPreview'
import { SegmentEditor } from '@/components/caption/SegmentEditor'
import { StylePanel } from '@/components/caption/StylePanel'
import { EditTimeline } from '@/components/caption/Timeline'
import { Transport, useSpaceToggle } from '@/components/caption/Transport'
import { Button } from '@/components/ui/Button'
import { Segmented, Select, Slider, Switch } from '@/components/ui/Controls'
import { Badge, EmptyState } from '@/components/ui/Display'
import { Input } from '@/components/ui/Input'
import { TabPanel, Tabs } from '@/components/ui/Overlays'
import { useLocalVideo } from '@/hooks/useLocalVideo'
import { IS_MOCK_BACKEND, api } from '@/services'
import { previewUrl } from '@/lib/native'
import { usePlaybackEngine } from '@/hooks/usePlaybackEngine'
import { ASPECT_DIMS, EXPORT_STATUS, TARGETS } from '@/lib/labels'
import { fmtDuration } from '@/lib/utils'
import { useCaptions } from '@/stores/captions'
import { useAi } from '@/stores/ai'
import { usePlayhead } from '@/stores/playhead'
import { useLibrary } from '@/stores/library'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { BUILT_IN_PRESETS } from '@/theme/captionPresets'
import type { AspectRatio, Filters, Split, TextLayout, TextPlace } from '@/types'
import { CameraBox } from '@/components/editor/SplitLayout'
import { FilterPanel } from '@/components/editor/FilterPanel'
import { PostPanel } from '@/components/editor/PostPanel'
import { NO_FILTERS } from '@/lib/filters'
import { DEFAULT_SPLIT } from '@/lib/split'

export function ClipEditor() {
  const { clipId } = useParams()
  const nav = useNavigate()
  const clips = useLibrary((s) => s.clips)
  const projects = useLibrary((s) => s.projects)
  const status = useLibrary((s) => s.status)
  const clip = clips.find((c) => c.id === clipId)

  if (!clipId) return clips.length ? <Navigate to={`/editor/${clips[0].id}`} replace /> : status === 'ready' ? (
    <Page><section className="panel"><EmptyState icon={Film} title="No clip to edit" body="Generate or import clips first, then open one here." action={<Button variant="primary" onClick={() => nav('/clips')}>Go to My Clips</Button>} /></section></Page>
  ) : null
  if (status !== 'ready') return null
  if (!clip) return (
    <Page><section className="panel"><EmptyState icon={Film} title="Clip not found" body="It may have been deleted. Pick another clip from your library." action={<Button variant="primary" onClick={() => nav('/clips')}>Go to My Clips</Button>} /></section></Page>
  )
  return <Editor key={clip.id} clipId={clip.id} projectDuration={projects.find((p) => p.id === clip.projectId)?.duration ?? clip.endSec + 30} />
}

function Editor({ clipId, projectDuration }: { clipId: string; projectDuration: number }) {
  const clip = useLibrary((s) => s.clips.find((c) => c.id === clipId))!
  const updateClip = useLibrary((s) => s.updateClip)
  const exportClips = useLibrary((s) => s.exportClips)
  const exportJob = useLibrary((s) => s.clipJob[clipId])
  const folder = useSettings((s) => s.exportFolder)
  const { segments, style, setAspect } = useCaptions()
  const source = useCaptions((s) => s.source)
  const bindClip = useCaptions((s) => s.bindClip)
  const unbind = useCaptions((s) => s.unbind)
  const real = source === 'real'
  const captionsOn = clip.captions !== 'none'
  // Desktop app: show this clip's own words. Re-slice after trimming settles.
  useEffect(() => {
    if (IS_MOCK_BACKEND) return
    const t = setTimeout(() => void bindClip({ projectId: clip.projectId, startSec: clip.startSec, endSec: clip.endSec }), 350)
    return () => clearTimeout(t)
  }, [clip.projectId, clip.startSec, clip.endSec, bindClip])
  useEffect(() => () => {
    if (!IS_MOCK_BACKEND) unbind()
  }, [unbind])
  const applyPreset = useCaptions((s) => s.applyPreset)
  const presetId = useCaptions((s) => s.presetId)
  const customPresets = useCaptions((s) => s.customPresets)
  const { video: testVideo, load, clear } = useLocalVideo()
  const sourcePath = useLibrary((s) => s.projects.find((p) => p.id === clip.projectId)?.sourcePath ?? null)
  const [realSrc, setRealSrc] = useState<string | null>(null)
  useEffect(() => {
    if (IS_MOCK_BACKEND || !sourcePath) return
    let live = true
    // The backend allows playback of a file once it has been probed. Probe again so this works after a restart.
    void api.media.probe(sourcePath).then(() => previewUrl(sourcePath)).then((u) => live && setRealSrc(u)).catch(() => live && setRealSrc(null))
    return () => { live = false }
  }, [sourcePath])
  // A real source plays the clip from its own start; a test video is just a backdrop for the sample transcript.
  const video = realSrc ? { src: realSrc, name: 'Source video', size: 0, duration: 0 } : testVideo
  const offset = realSrc ? clip.startSec : 0
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState(clip.title)
  const [tab, setTab] = useState('captions')
  const [cropX, setCropX] = useState(clip.cropX ?? 50)
  const [zoom, setZoom] = useState(clip.zoom ?? 1)
  const [tracking, setTracking] = useState(false)
  const [split, setSplit] = useState<Split | null>(clip.split?.share ? clip.split : null)
  const [guessing, setGuessing] = useState(false)
  const savedLayout = useSettings((s) => s.savedLayout)
  const saveSetting = useSettings((s) => s.set)
  const [hook, setHook] = useState(clip.hook ?? '')
  const [layout, setLayout] = useState<TextLayout>(clip.layout ?? {})
  const [filters, setFilters] = useState<Filters>(clip.filters ?? NO_FILTERS)
  // Saved shortly after dragging or sliding stops.
  useEffect(() => {
    if (JSON.stringify(layout) === JSON.stringify(clip.layout ?? {})) return
    const t = setTimeout(() => updateClip(clip.id, { layout }), 400)
    return () => clearTimeout(t)
  }, [layout, clip.id, clip.layout, updateClip])
  useEffect(() => {
    if (JSON.stringify(filters) === JSON.stringify(clip.filters ?? NO_FILTERS)) return
    const t = setTimeout(() => updateClip(clip.id, { filters }), 400)
    return () => clearTimeout(t)
  }, [filters, clip.id, clip.filters, updateClip])
  const sizeText = (key: 'cap' | 'hook', scale: number) => {
    const from: TextPlace = layout[key] ?? (key === 'hook' ? { x: 50, y: 7, scale: 1 } : { x: 50, y: gaming && split ? (1 - split.share) * 100 : style.posY, scale: 1 })
    setLayout({ ...layout, [key]: { ...from, scale } })
  }
  const [found, setFound] = useState<Awaited<ReturnType<typeof api.ai.findCuts>> | null>(null)
  const [finding, setFinding] = useState(false)
  const cut = clip.cuts?.length ? clip.cuts : null
  const cutSeconds = (cut ?? []).reduce((n, [a, b]) => n + Math.max(0, Math.min(b, clip.endSec) - Math.max(a, clip.startSec)), 0)
  const gaming = !!split && clip.aspect === '9:16'
  const [pad, setPad] = useState(15)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const splitClip = useLibrary((s) => s.splitClip)
  const faceReady = useAi((s) => !!s.status?.faceReady)
  const tracked = !!clip.track?.length
  // Save framing shortly after the sliders stop moving.
  useEffect(() => {
    if (cropX === (clip.cropX ?? 50) && zoom === (clip.zoom ?? 1)) return
    const t = setTimeout(() => updateClip(clip.id, { cropX, zoom }), 400)
    return () => clearTimeout(t)
  }, [cropX, zoom, clip.id, clip.cropX, clip.zoom, updateClip])
  // Playback jumps over the parts that were cut, as the export will.
  useEffect(() => {
    if (!cut) return
    return usePlayhead.subscribe((s) => {
      if (!s.playing) return
      const at = clip.startSec + s.time
      const hit = cut.find(([a, b]) => at >= a && at < b - 0.05)
      if (hit) s.seek(Math.min(s.duration, hit[1] - clip.startSec))
    })
  }, [cut, clip.startSec])

  const findCuts = async () => {
    setFinding(true)
    try {
      const f = await api.ai.findCuts(clip.id)
      setFound(f)
      if (!f.cuts.length) toast({ kind: 'info', title: 'Nothing to remove', body: 'No long pauses or filler words in this clip.' })
    } catch (e) {
      toast({ kind: 'warning', title: 'Pauses and filler words', body: String(e) })
    } finally {
      setFinding(false)
    }
  }

  // The camera box is saved shortly after dragging stops. A share of 0 switches the layout off.
  useEffect(() => {
    const saved = clip.split?.share ? clip.split : null
    if (JSON.stringify(split) === JSON.stringify(saved)) return
    const t = setTimeout(() => updateClip(clip.id, { split: split ?? { ...DEFAULT_SPLIT, share: 0 } }), 400)
    return () => clearTimeout(t)
  }, [split, clip.id, clip.split, updateClip])
  const [selected, setSelected] = useState<{ segId: string; wordId: string } | null>(null)
  const [quality, setQuality] = useState('1080')
  const [fps, setFps] = useState('30')
  const [burn, setBurn] = useState(true)
  const [srt, setSrt] = useState(false)

  const len = clip.endSec - clip.startSec
  // The visible window changes in whole steps, so trimming does not re-read the audio every move.
  const dStart = Math.max(0, Math.floor(clip.startSec / 5) * 5 - pad)
  const dEnd = Math.min(projectDuration, Math.ceil(clip.endSec / 5) * 5 + pad)
  useEffect(() => {
    setPeaks(null)
    if (IS_MOCK_BACKEND || !sourcePath || dEnd <= dStart) return
    let live = true
    void api.media.audioPeaks(sourcePath, dStart, dEnd, 160).then((p) => live && setPeaks(p)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [sourcePath, dStart, dEnd])
  const duration = realSrc ? len : testVideo ? testVideo.duration : len

  useEffect(() => {
    setAspect(clip.aspect)
  }, [clip.aspect, setAspect])
  usePlaybackEngine(duration, videoRef, video?.src ?? null, offset)
  useSpaceToggle()

  const doExport = () => {
    updateClip(clip.id, { cropX, zoom, hook: hook.trim(), layout, filters, ...(split ? { split } : {}) })
    exportClips([clip.id], { resolution: Number(quality), fps: Number(fps), burnCaptions: burn && real && captionsOn, writeSrt: srt && real && captionsOn })
    if (IS_MOCK_BACKEND) toast({ kind: 'info', title: 'Simulated export started', body: 'No file is written in the browser preview.' })
  }

  const trackFaces = async () => {
    setTracking(true)
    try {
      const path = await api.ai.trackFaces(clip.id)
      updateClip(clip.id, { track: path })
      toast({ kind: 'success', title: 'Following the face', body: 'The preview and the export now move with it.' })
    } catch (e) {
      toast({ kind: 'warning', title: 'Face tracking', body: String(e) })
    } finally {
      setTracking(false)
    }
  }

  const guessCamera = async () => {
    setGuessing(true)
    try {
      const [x, y, w, h] = await api.ai.guessCamera(clip.id)
      setSplit((s) => ({ ...(s ?? DEFAULT_SPLIT), x, y, w, h })) // CameraBox reshapes it around its centre
      toast({ kind: 'success', title: 'Camera box placed', body: 'Check it and drag it if needed.' })
    } catch (e) {
      toast({ kind: 'warning', title: 'Camera not found', body: String(e) })
    } finally {
      setGuessing(false)
    }
  }

  const setGaming = (on: boolean) => {
    if (!on) return setSplit(null)
    if (clip.aspect !== '9:16') updateClip(clip.id, { aspect: '9:16' })
    setSplit(DEFAULT_SPLIT)
    if (!IS_MOCK_BACKEND && faceReady && sourcePath) void guessCamera()
  }

  const splitInTwo = () => {
    const at = clip.startSec + usePlayhead.getState().time
    if (splitClip(clip.id, at)) toast({ kind: 'success', title: 'Clip split in two', body: 'The second part is a new clip in My Clips.' })
    else toast({ kind: 'warning', title: 'Move the playhead first', body: 'Each part needs at least one second.' })
  }

  // I and O set the start and end at the playhead, S splits, arrows step a frame (a second with Shift).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.getAttribute('role') === 'slider' || el.closest('[role=dialog]')) return
      const k = e.key.toLowerCase()
      const t = usePlayhead.getState().time
      const at = Math.round((clip.startSec + t) * 10) / 10
      if (k === 'i' && at <= clip.endSec - 1) {
        updateClip(clip.id, { startSec: at })
        usePlayhead.getState().setTime(0) // the same moment is now the start
      }
      else if (k === 'o' && at >= clip.startSec + 1) updateClip(clip.id, { endSec: at })
      else if (k === 's') splitInTwo()
      else if (e.key === 'ArrowLeft') usePlayhead.getState().seek(t - (e.shiftKey ? 1 : 1 / 30))
      else if (e.key === 'ArrowRight') usePlayhead.getState().seek(t + (e.shiftKey ? 1 : 1 / 30))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const tabs = useMemo(
    () => [
      { value: 'captions', label: 'Captions' },
      { value: 'style', label: 'Style' },
      { value: 'frame', label: 'Frame' },
      { value: 'filters', label: 'Filters' },
      { value: 'post', label: 'Post' },
      { value: 'export', label: 'Export' },
    ],
    [],
  )

  return (
    <Page full className="gap-4">
      <div className="flex shrink-0 items-center gap-3">
        <Input
          aria-label="Clip title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => (title.trim() ? updateClip(clip.id, { title: title.trim() }) : setTitle(clip.title))}
          className="w-80 font-medium"
        />
        <Badge tone={EXPORT_STATUS[clip.exportStatus].tone}>{EXPORT_STATUS[clip.exportStatus].label}</Badge>
        <StopJob jobId={exportJob} />
        <span className="text-label text-t3">{TARGETS[clip.target]}, {fmtDuration(len)}</span>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = '' }} />
          {testVideo && !realSrc ? <Button variant="ghost" onClick={clear}>Remove video</Button> : null}
          {realSrc ? null : <Button onClick={() => fileRef.current?.click()}><Upload size={15} />{testVideo ? 'Change video' : IS_MOCK_BACKEND ? 'Load test video' : 'Preview over a video'}</Button>}
          <Button variant="primary" onClick={doExport}><Download size={15} />Export</Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] gap-4">
        <div className="flex min-h-0 flex-col gap-3">
          <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Preview">
            <div className="min-h-0 flex-1 bg-app/60 p-4">
              <PreviewStage aspect={clip.aspect} segments={captionsOn ? segments : []} style={style} videoSrc={video?.src} videoRef={videoRef} cropX={cropX} zoom={zoom} split={split} hook={hook} layout={layout} onLayout={setLayout} filters={filters} onFrame={(c) => { if (c.split) setSplit(c.split); if (c.cropX !== undefined) setCropX(c.cropX) }} track={clip.track} trackOffset={clip.startSec} hue={clip.hue} onWordClick={(segId, wordId) => { setSelected({ segId, wordId }); setTab('captions') }} />
            </div>
            <div className="shrink-0 border-t border-line px-4 py-3"><Transport /></div>
          </section>

          <section className="panel shrink-0 p-4" aria-label="Timeline">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-label font-semibold">Timeline</h2>
              <span className="mr-auto ml-3 truncate text-meta text-t3">Drag the handles to trim. I start, O end, S split, arrows step.{IS_MOCK_BACKEND ? ' Captions use the 18 s sample transcript.' : ''}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={splitInTwo}><Scissors size={13} />Split here</Button>
                <Segmented label="Timeline zoom" value={String(pad)} onChange={(v) => setPad(Number(v))} options={[{ value: '5', label: 'Close' }, { value: '15', label: 'Normal' }, { value: '60', label: 'Wide' }]} />
              </div>
            </div>
            <EditTimeline
              domainStart={dStart}
              domainEnd={dEnd}
              inSec={clip.startSec}
              outSec={clip.endSec}
              onTrim={(i, o) => updateClip(clip.id, { startSec: i, endSec: o })}
              segments={segments}
              peaks={IS_MOCK_BACKEND ? null : (peaks ?? [])}
            />
          </section>
        </div>

        <aside className="panel flex min-h-0 flex-col overflow-hidden" aria-label="Clip settings">
          <Tabs value={tab} onValueChange={setTab} tabs={tabs} className="h-full [&_[role=tab]]:px-2">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <TabPanel value="captions">
                <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                  <div>
                    <p className="text-body font-medium">Captions on this clip</p>
                    <p className="text-meta text-t3">{IS_MOCK_BACKEND ? 'Sample transcript' : real ? 'Real transcript. Edits are saved.' : 'No transcript: transcribe the video first.'}</p>
                  </div>
                  <Switch label="Captions on this clip" checked={captionsOn} onChange={(on) => updateClip(clip.id, { captions: on ? 'generated' : 'none' })} />
                </div>
                <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-body font-medium">Hook title</span>
                    <Switch label="Hook title" checked={!!hook} onChange={(on) => { const next = on ? clip.title.slice(0, 120) : ''; setHook(next); updateClip(clip.id, { hook: next }) }} />
                  </div>
                  {hook ? <Input aria-label="Hook title text" maxLength={120} value={hook} onChange={(e) => setHook(e.target.value)} onBlur={() => updateClip(clip.id, { hook: hook.trim() })} /> : <p className="text-meta text-t3">A headline at the top of the video.</p>}
                </div>
                <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
                  <p className="text-body font-medium">Text on the video</p>
                  <p className="text-meta text-t3">Drag the captions or the title in the preview. Drag the dot at its corner to resize.</p>
                  {(['cap', 'hook'] as const).filter((k) => k === 'cap' || hook).map((k) => (
                    <div key={k}>
                      <div className="mb-2 flex justify-between text-label"><span className="font-medium text-t2">{k === 'cap' ? 'Caption size' : 'Title size'}</span><span className="font-mono">{Math.round((layout[k]?.scale ?? 1) * 100)}%</span></div>
                      <Slider label={k === 'cap' ? 'Caption size' : 'Title size'} min={40} max={250} step={5} value={[Math.round((layout[k]?.scale ?? 1) * 100)]} onChange={([v]) => sizeText(k, v / 100)} />
                    </div>
                  ))}
                  {layout.cap || layout.hook ? <Button variant="ghost" onClick={() => setLayout({})}>Put the text back</Button> : null}
                </div>
                <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
                  <p className="text-body font-medium">Pauses and filler words</p>
                  {cut ? (
                    <>
                      <p className="text-meta text-t3">{cutSeconds.toFixed(1)} s removed. The preview and the export skip those parts.</p>
                      <Button onClick={() => { updateClip(clip.id, { cuts: [] }); setFound(null) }}>Put them back</Button>
                    </>
                  ) : found?.cuts.length ? (
                    <>
                      <p className="text-meta text-t3">{found.pauses} long pause{found.pauses === 1 ? '' : 's'} and {found.fillers} filler word{found.fillers === 1 ? '' : 's'}: {found.seconds.toFixed(1)} s in all.</p>
                      <div className="flex gap-2">
                        <Button variant="primary" onClick={() => { updateClip(clip.id, { cuts: found.cuts }); setFound(null) }}>Remove them</Button>
                        <Button variant="ghost" onClick={() => setFound(null)}>Leave them</Button>
                      </div>
                    </>
                  ) : (
                    <Button loading={finding} disabled={IS_MOCK_BACKEND || !real} onClick={() => void findCuts()}>Find them</Button>
                  )}
                </div>
                <SegmentEditor selected={selected} onSelect={setSelected} />
              </TabPanel>
              <TabPanel value="style">
                <div className="border-b border-line p-4">
                  <p className="mb-1.5 text-label font-medium text-t2">Preset</p>
                  <Select aria-label="Caption preset" value={presetId ?? 'bold-creator'} onChange={applyPreset} options={[...BUILT_IN_PRESETS, ...customPresets].map((p) => ({ value: p.id, label: p.name }))} />
                  <p className="mt-2 text-meta text-t3">Style is shared with Caption Studio.</p>
                </div>
                <StylePanel />
              </TabPanel>
              <TabPanel value="frame">
                <div className="flex flex-col gap-5 p-4">
                  <div>
                    <p className="mb-2 text-label font-medium text-t2">Aspect ratio</p>
                    <Segmented<AspectRatio> label="Aspect ratio" value={clip.aspect} onChange={(a) => updateClip(clip.id, { aspect: a })} className="w-full [&>button]:flex-1" options={(Object.keys(ASPECT_DIMS) as AspectRatio[]).map((a) => ({ value: a, label: a }))} />
                    <p className="mt-1.5 text-meta text-t3">{ASPECT_DIMS[clip.aspect].px}</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-body font-medium">Gaming layout</span>
                      <Switch label="Gaming layout" checked={gaming} onChange={setGaming} />
                    </div>
                    <p className="mt-1.5 text-meta text-t3">Game on top, camera below, for 9:16 clips. Captions sit between them. Drag either picture in the preview to move it.</p>
                  </div>
                  {gaming || savedLayout ? (
                    <div className="flex gap-2">
                      {gaming && split ? <Button className="flex-1" onClick={() => { saveSetting({ savedLayout: { split, cropX, zoom } }); toast({ kind: 'success', title: 'Layout saved', body: 'Use it here, or on many clips from My Clips, Change.' }) }}>Save as my layout</Button> : null}
                      {savedLayout ? <Button className="flex-1" onClick={() => { if (clip.aspect !== '9:16') updateClip(clip.id, { aspect: '9:16' }); setSplit(savedLayout.split); setCropX(savedLayout.cropX); setZoom(savedLayout.zoom) }}>Use my layout</Button> : null}
                    </div>
                  ) : null}
                  {gaming && split ? (
                    <>
                      <div>
                        <p className="mb-2 text-label font-medium text-t2">Camera box</p>
                        <CameraBox videoRef={videoRef} split={split} onChange={setSplit} />
                        <Button className="mt-2 w-full" loading={guessing} disabled={IS_MOCK_BACKEND || !faceReady || !sourcePath} onClick={() => void guessCamera()}>
                          {guessing ? null : <UserRound size={15} />}{guessing ? 'Looking for the face' : 'Guess from the face'}
                        </Button>
                        <p className="mt-1.5 text-meta text-t3">{!faceReady && !IS_MOCK_BACKEND ? 'Set up face tracking in Settings, AI to guess the box. You can still drag it.' : 'Drag the box onto your camera; it snaps to the edges and middle. A smaller box zooms in.'}</p>
                      </div>
                      <div>
                        <div className="mb-2 flex justify-between text-label"><span className="font-medium text-t2">Camera height</span><span className="font-mono">{Math.round(split.share * 100)}%</span></div>
                        <Slider label="Camera height" min={20} max={50} step={1} value={[Math.round(split.share * 100)]} onChange={([v]) => setSplit({ ...split, share: v / 100 })} />
                      </div>
                      {zoom > 1 ? (
                        <div>
                          <div className="mb-2 flex justify-between text-label"><span className="font-medium text-t2">Game up and down</span><span className="font-mono">{Math.round((split.gy ?? 0.5) * 100)}%</span></div>
                          <Slider label="Game up and down" min={0} max={100} step={1} value={[Math.round((split.gy ?? 0.5) * 100)]} onChange={([v]) => setSplit({ ...split, gy: v / 100 })} />
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div>
                    <div className="mb-2 flex justify-between text-label"><span className="font-medium text-t2">{gaming ? 'Game position' : 'Crop position'}</span><span className="font-mono">{cropX}%</span></div>
                    {tracked && !gaming ? <p className="text-meta text-t3">The face path sets the position.</p> : <Slider label="Crop position" min={0} max={100} value={[cropX]} onChange={([v]) => setCropX(v)} />}
                  </div>
                  <div>
                    <div className="mb-2 flex justify-between text-label"><span className="font-medium text-t2">{gaming ? 'Game zoom' : 'Zoom'}</span><span className="font-mono">{zoom.toFixed(2)}x</span></div>
                    <Slider label="Zoom" min={1} max={2} step={0.05} value={[zoom]} onChange={([v]) => setZoom(v)} />
                  </div>
                  {gaming ? null : (
                  <div>
                    <Button className="w-full" loading={tracking} disabled={IS_MOCK_BACKEND || !faceReady || !sourcePath} onClick={() => void trackFaces()}>
                      {tracking ? null : <UserRound size={15} />}{tracking ? 'Looking for the face' : tracked ? 'Track the face again' : 'Follow the face'}
                    </Button>
                    {tracked ? <Button variant="ghost" className="mt-2 w-full" onClick={() => updateClip(clip.id, { track: [] })}>Stop following, use the slider</Button> : null}
                    <p className="mt-1.5 text-meta text-t3">
                      {IS_MOCK_BACKEND ? 'Face tracking runs in the desktop app.' : !faceReady ? 'Set up face tracking in Settings, AI.' : 'Follows the biggest, most steady face. It does not know who is speaking.'}
                    </p>
                  </div>
                  )}
                  {!video ? <p className="text-meta text-t3">Crop and zoom act on the footage. {IS_MOCK_BACKEND ? 'Load a test video to see them move.' : 'This clip has no source video on this PC.'}</p> : null}
                </div>
              </TabPanel>
              <TabPanel value="filters">
                <FilterPanel value={filters} onChange={setFilters} />
              </TabPanel>
              <TabPanel value="post">
                <PostPanel clip={clip} />
              </TabPanel>
              <TabPanel value="export">
                <div className="flex flex-col gap-4 p-4">
                  <p className="text-meta text-t3">Resolution is the short side. A vertical 1080 clip is 1080 × 1920.</p>
                  <div><p className="mb-1.5 text-label font-medium text-t2">Resolution</p><Select aria-label="Resolution" value={quality} onChange={setQuality} options={[{ value: '1080', label: '1080p' }, { value: '720', label: '720p' }, { value: '480', label: '480p, small file' }]} /></div>
                  <div><p className="mb-1.5 text-label font-medium text-t2">Frame rate</p><Select aria-label="Frame rate" value={fps} onChange={setFps} options={[{ value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }]} /></div>
                  <div className="flex items-center justify-between"><span className="text-body">Burn in captions</span><Switch label="Burn in captions" checked={burn && (IS_MOCK_BACKEND || (real && captionsOn))} onChange={setBurn} disabled={!IS_MOCK_BACKEND && !(real && captionsOn)} /></div>
                  <div className="flex items-center justify-between"><span className="text-body">Also write SRT</span><Switch label="Also write SRT" checked={srt && (IS_MOCK_BACKEND || (real && captionsOn))} onChange={setSrt} disabled={!IS_MOCK_BACKEND && !(real && captionsOn)} /></div>
                  {IS_MOCK_BACKEND ? null : <p className="text-meta text-t3">{!captionsOn ? 'Captions are off for this clip.' : real ? 'Burned-in captions use the closest Windows font to your preset.' : 'No transcript yet, so this export has no captions.'}</p>}
                  <div className="flex justify-between gap-4 text-body"><span className="text-t2">Folder</span><span className="truncate font-mono text-label" title={folder}>{folder}</span></div>
                  <Button variant="primary" onClick={doExport}><Download size={15} />{IS_MOCK_BACKEND ? 'Export clip (simulated)' : 'Export clip'}</Button>
                </div>
              </TabPanel>
            </div>
          </Tabs>
        </aside>
      </div>
    </Page>
  )
}
