import { Cpu, Download, FileText, Film, Layers, Palette, SplitSquareHorizontal, Upload, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Page } from '@/components/Common'
import { PresetGallery } from '@/components/caption/PresetGallery'
import { PreviewStage } from '@/components/caption/CaptionPreview'
import { SegmentEditor } from '@/components/caption/SegmentEditor'
import { StylePanel } from '@/components/caption/StylePanel'
import { TranscriptTimeline } from '@/components/caption/Timeline'
import { Transport, useSpaceToggle } from '@/components/caption/Transport'
import { Button } from '@/components/ui/Button'
import { Chip, Segmented, Select, Switch } from '@/components/ui/Controls'
import { Badge } from '@/components/ui/Display'
import { TabPanel, Tabs } from '@/components/ui/Overlays'
import { useLocalVideo } from '@/hooks/useLocalVideo'
import { usePlaybackEngine } from '@/hooks/usePlaybackEngine'
import { ASPECT_DIMS } from '@/lib/labels'
import { toSrt } from '@/lib/srt'
import { download, fmtBytes, fmtDuration } from '@/lib/utils'
import { SAMPLE_DURATION } from '@/mock/transcript'
import { useCaptions } from '@/stores/captions'
import { useLibrary } from '@/stores/library'
import { usePlayhead } from '@/stores/playhead'
import { useSettings } from '@/stores/settings'
import { IS_MOCK_BACKEND, api } from '@/services'
import { previewUrl } from '@/lib/native'
import { Link } from 'react-router-dom'
import { toast } from '@/stores/ui'
import { BUILT_IN_PRESETS } from '@/theme/captionPresets'
import { LANGUAGES, WHISPER_MODELS } from '@/theme/models'
import type { AspectRatio } from '@/types'

type Output = 'burned' | 'none' | 'srt'

function ExportPanel({ clipId }: { clipId: string | null }) {
  const source = useCaptions((s) => s.source)
  const real = source === 'real'
  const segments = useCaptions((s) => s.segments)
  const aspect = useCaptions((s) => s.aspect)
  const clips = useLibrary((s) => s.clips)
  const exportClips = useLibrary((s) => s.exportClips)
  const folder = useSettings((s) => s.exportFolder)
  const [mode, setMode] = useState<Output>('burned')
  const [alsoSrt, setAlsoSrt] = useState(true)
  const [batch, setBatch] = useState<string[]>([])
  const eligible = clips.filter((c) => c.captions !== 'none')
  const d = ASPECT_DIMS[aspect]

  return (
    <div className="flex flex-col gap-5 p-4">
      <section>
        <h3 className="mb-2 text-label font-semibold">Output</h3>
        <Segmented<Output>
          label="Output mode"
          value={mode}
          onChange={setMode}
          className="w-full [&>button]:flex-1"
          options={[
            { value: 'burned', label: 'Burned-in' },
            { value: 'none', label: 'No captions' },
            { value: 'srt', label: 'SRT only' },
          ]}
        />
        <p className="mt-2 text-meta text-t3">
          {mode === 'burned' ? 'Captions are drawn into the video with your style.' : mode === 'none' ? 'Video is exported without any subtitles.' : 'Only the subtitle file is written.'}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-body text-t2">Also write an SRT file</span>
          <Switch label="Also write an SRT file" checked={alsoSrt} onChange={setAlsoSrt} />
        </div>
        <div className="mt-3 flex items-center justify-between text-body">
          <span className="text-t2">Resolution</span>
          <span className="font-mono text-t1">{d.px}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-body">
          <span className="text-t2">Folder</span>
          <span className="max-w-[200px] truncate font-mono text-meta text-t1" title={folder}>{folder}</span>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            download('captions.srt', toSrt(segments), 'application/x-subrip')
            toast({ kind: 'success', title: 'SRT downloaded', body: real ? 'Written from this clip\'s transcript.' : 'Written from the sample transcript.' })
          }}
        >
          <FileText size={15} />
          Download SRT now
        </Button>
        {IS_MOCK_BACKEND || (real && clipId) ? null : <p className="rounded-md border border-line bg-s2 px-3 py-2 text-meta text-t2">Choose a clip with a transcript above to export it with these captions.</p>}
        <Button
          variant="primary"
          disabled={!IS_MOCK_BACKEND && !(real && clipId)}
          onClick={() => {
            if (IS_MOCK_BACKEND) {
              exportClips(eligible.slice(0, 1).map((c) => c.id))
              toast({ kind: 'info', title: 'Simulated export started', body: 'No file is written in the browser preview.' })
            } else if (clipId) exportClips([clipId], { burnCaptions: mode === 'burned', writeSrt: alsoSrt || mode === 'srt' })
          }}
        >
          <Download size={15} />
          {IS_MOCK_BACKEND ? 'Export video (simulated)' : 'Export this clip'}
        </Button>
      </section>

      <section>
        <h3 className="mb-1 text-label font-semibold">Batch export</h3>
        <p className="mb-2 text-meta text-t3">Apply the current style to several clips that already have captions.</p>
        {eligible.length === 0 ? (
          <p className="text-body text-t2">No clips with captions yet.</p>
        ) : (
          <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-md border border-line p-1.5">
            {eligible.map((c) => (
              <li key={c.id}>
                <label className="flex h-8 cursor-default items-center gap-2.5 rounded px-2 text-body hover:bg-s2">
                  <input
                    type="checkbox"
                    checked={batch.includes(c.id)}
                    onChange={(e) => setBatch((b) => (e.target.checked ? [...b, c.id] : b.filter((x) => x !== c.id)))}
                    className="accent-[var(--accent)]"
                  />
                  <span className="truncate">{c.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <Button
          className="mt-2 w-full"
          disabled={batch.length === 0}
          onClick={() => {
            exportClips(batch, { burnCaptions: mode === 'burned', writeSrt: alsoSrt || mode === 'srt' })
            toast({ kind: 'info', title: `${IS_MOCK_BACKEND ? 'Simulated batch' : 'Batch'} of ${batch.length}`, body: 'Watch progress in History.' })
            setBatch([])
          }}
        >
          Export {batch.length || ''} selected{IS_MOCK_BACKEND ? ' (simulated)' : ''}
        </Button>
      </section>
    </div>
  )
}

export function CaptionStudio() {
  const { segments, style, aspect, setAspect } = useCaptions()
  const model = useSettings((s) => s.model)
  const language = useSettings((s) => s.language)
  const setSettings = useSettings((s) => s.set)
  const runSimulated = useLibrary((s) => s.runSimulated)
  const { video, load, clear } = useLocalVideo()
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState('presets')
  const [selected, setSelected] = useState<{ segId: string; wordId: string } | null>(null)
  const [compare, setCompare] = useState(false)
  const [cmpId, setCmpId] = useState('minimal')
  const [busy, setBusy] = useState(false)
  // Desktop app: pick a real clip; its words and footage replace the sample.
  const clips = useLibrary((s) => s.clips)
  const projects = useLibrary((s) => s.projects)
  const [clipId, setClipId] = useState<string | null>(null)
  const clip = clips.find((c) => c.id === clipId) ?? null
  const source = useCaptions((s) => s.source)
  const bindClip = useCaptions((s) => s.bindClip)
  const unbind = useCaptions((s) => s.unbind)
  const sourcePath = projects.find((p) => p.id === clip?.projectId)?.sourcePath ?? null
  const [realSrc, setRealSrc] = useState<string | null>(null)
  useEffect(() => {
    if (IS_MOCK_BACKEND) return
    if (!clip) return unbind()
    void bindClip({ projectId: clip.projectId, startSec: clip.startSec, endSec: clip.endSec })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id, bindClip, unbind])
  useEffect(() => () => {
    if (!IS_MOCK_BACKEND) unbind()
  }, [unbind])
  useEffect(() => {
    setRealSrc(null)
    if (IS_MOCK_BACKEND || !sourcePath) return
    let live = true
    void api.media.probe(sourcePath).then(() => previewUrl(sourcePath)).then((u) => live && setRealSrc(u)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [sourcePath])
  const offset = realSrc && clip ? clip.startSec : 0
  const stageSrc = realSrc ?? video?.src ?? null
  const duration = clip ? clip.endSec - clip.startSec : (video?.duration ?? SAMPLE_DURATION)

  usePlaybackEngine(duration, videoRef, stageSrc, offset)
  useSpaceToggle()
  const activeSegId = usePlayhead((s) => segments.find((x) => s.time >= x.start - 0.05 && s.time <= x.end + 0.2)?.id)
  const m = WHISPER_MODELS.find((x) => x.id === model)!
  const cmp = BUILT_IN_PRESETS.find((p) => p.id === cmpId)!

  const transcribe = () => {
    setBusy(true)
    runSimulated({
      title: 'Simulated: transcribe with Faster-Whisper',
      kind: 'transcribe',
      source: video?.name ?? 'Sample transcript',
      seconds: 4,
      onDone: () => setBusy(false),
    })
    toast({ kind: 'info', title: 'Simulated transcription', body: 'The sample transcript stays in place. Real transcription runs in the desktop app.' })
  }

  return (
    <Page className="grid grid-cols-[minmax(0,1fr)_388px] items-start gap-5">
      <div className="flex min-w-0 flex-col gap-5">
        {IS_MOCK_BACKEND ? null : (
          <section className="panel flex items-center gap-3 px-4 py-3">
            <span className="text-label font-medium text-t2">Clip</span>
            <div className="w-80">
              <Select aria-label="Clip to caption" value={clipId ?? 'sample'} onChange={(v) => setClipId(v === 'sample' ? null : v)} options={[{ value: 'sample', label: 'Sample transcript' }, ...clips.map((c) => ({ value: c.id, label: c.title }))]} />
            </div>
            <span className="text-meta text-t3">{!clip ? 'Style changes apply to every clip.' : source === 'real' ? 'Real transcript. Edits are saved.' : source === 'missing' ? 'This video has no transcript yet.' : ''}</span>
          </section>
        )}
        {/* Preview */}
        <section className="panel overflow-hidden" aria-label="Caption preview">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
            <Segmented<AspectRatio>
              label="Preview aspect ratio"
              value={aspect}
              onChange={setAspect}
              options={(Object.keys(ASPECT_DIMS) as AspectRatio[]).map((a) => ({ value: a, label: a }))}
            />
            <Chip active={compare} onClick={() => setCompare((c) => !c)}>
              <span className="inline-flex items-center gap-1.5"><SplitSquareHorizontal size={13} />Compare styles</span>
            </Chip>
            {compare ? (
              <div className="w-40">
                <Select aria-label="Compare against preset" value={cmpId} onChange={setCmpId} options={BUILT_IN_PRESETS.map((p) => ({ value: p.id, label: p.name }))} />
              </div>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) load(f)
                  e.target.value = ''
                }}
              />
              {video ? (
                <Button variant="ghost" onClick={clear}>Remove video</Button>
              ) : null}
              <Button onClick={() => fileRef.current?.click()}>
                <Upload size={15} />
                {video ? 'Change video' : IS_MOCK_BACKEND ? 'Load test video' : 'Preview over a video'}
              </Button>
            </div>
          </div>

          <div className="flex h-[440px] items-center justify-center gap-4 bg-app/60 p-4">
            <div className="h-full min-w-0 flex-1">
              <PreviewStage
                aspect={aspect}
                segments={segments}
                style={style}
                videoSrc={stageSrc}
                videoRef={videoRef}
                onWordClick={(segId, wordId) => {
                  setSelected({ segId, wordId })
                  setTab('presets')
                }}
              />
            </div>
            {compare ? (
              <div className="h-full min-w-0 flex-1">
                <PreviewStage aspect={aspect} segments={segments} style={cmp.style} hue={262} />
              </div>
            ) : null}
          </div>

          <div className="border-t border-line px-4 py-3">
            <Transport />
            <p className="mt-2 text-meta text-t3">
              {clip
                ? `${clip.title}, ${fmtDuration(duration)}.`
                : video
                ? `Playing ${video.name}, ${fmtDuration(video.duration)}, ${fmtBytes(video.size)}. The sample transcript is laid over it; open a clip to see its real captions.`
                : `Sample transcript, ${fmtDuration(SAMPLE_DURATION)}. Load any video to see captions over real footage. Click a caption word to edit it.`}
            </p>
          </div>
        </section>

        {/* Generation */}
        {IS_MOCK_BACKEND ? null : (
          <p className="panel px-4 py-3 text-label text-t2">
            Captions are made automatically when you clip a video with local AI. <Link to="/auto-clipper" className="text-accent underline">Open Auto Clipper</Link> or <Link to="/settings?tab=ai" className="text-accent underline">set up local AI</Link>.
          </p>
        )}
        <section className={IS_MOCK_BACKEND ? 'panel flex flex-wrap items-center gap-4 px-4 py-3.5' : 'hidden'}>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/12 text-accent"><Wand2 size={18} /></div>
          <div className="min-w-[200px] flex-1">
            <p className="text-body font-medium">Local transcription, no cloud</p>
            <p className="text-label text-t2">
              Faster-Whisper {m.label}: {m.download} download, {m.memory} memory, {m.speed.toLowerCase()}. Works offline after the model is installed.
            </p>
          </div>
          <div className="w-44">
            <Select aria-label="Model" value={model} onChange={(v) => setSettings({ model: v })} options={WHISPER_MODELS.map((x) => ({ value: x.id, label: `${x.label}, ${x.download}` }))} />
          </div>
          <div className="w-36">
            <Select aria-label="Spoken language" value={language} onChange={(v) => setSettings({ language: v })} options={LANGUAGES} />
          </div>
          <Button variant="primary" onClick={transcribe} loading={busy}>
            {busy ? null : <Cpu size={15} />}
            Generate captions
          </Button>
        </section>

        {/* Transcript */}
        <section className="panel overflow-hidden" aria-label="Transcript editor">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-section font-semibold">Transcript</h2>
            <Badge tone={source === 'real' ? 'success' : 'warning'}>{source === 'real' ? 'Real transcript' : source === 'missing' ? 'No transcript' : 'Sample transcript'}</Badge>
          </div>
          <div className="border-b border-line p-4">
            <TranscriptTimeline segments={segments} duration={duration > 0 ? Math.max(duration, segments[segments.length - 1]?.end ?? 1) : SAMPLE_DURATION} activeId={activeSegId} onPick={(id) => setSelected((s) => (s?.segId === id ? s : null))} />
          </div>
          <SegmentEditor selected={selected} onSelect={setSelected} />
        </section>
      </div>

      {/* Right rail */}
      <aside className="panel sticky top-5 flex h-[calc(100vh-var(--titlebar-h)-var(--header-h)-40px)] min-h-[480px] flex-col overflow-hidden" aria-label="Style and export">
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="h-full"
          tabs={[
            { value: 'presets', label: 'Presets', icon: <Layers size={14} /> },
            { value: 'style', label: 'Customize', icon: <Palette size={14} /> },
            { value: 'export', label: 'Export', icon: <Film size={14} /> },
          ]}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TabPanel value="presets"><PresetGallery /></TabPanel>
            <TabPanel value="style"><StylePanel /></TabPanel>
            <TabPanel value="export"><ExportPanel clipId={clipId} /></TabPanel>
          </div>
        </Tabs>
      </aside>
    </Page>
  )
}
