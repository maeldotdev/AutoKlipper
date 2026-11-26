import { CheckCircle2, FileVideo, Link2, Sparkles, Upload, X } from 'lucide-react'
import { StopJob } from '@/components/StopJob'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Page, PlatformMark } from '@/components/Common'
import { Button } from '@/components/ui/Button'
import { Chip, Select, Slider, Switch } from '@/components/ui/Controls'
import { Badge, Progress } from '@/components/ui/Display'
import { Field, Input } from '@/components/ui/Input'
import { useLocalVideo } from '@/hooks/useLocalVideo'
import { IS_MOCK_BACKEND, api, type MediaInfo, type UrlInfo } from '@/services'
import { fileNameOf, hasVideoExtension, pickVideoPath, previewUrl } from '@/lib/native'
import { ASPECT_DIMS, PLATFORMS, TARGETS, detectPlatform } from '@/lib/labels'
import { cn, fmtBytes, fmtDuration } from '@/lib/utils'
import { useCaptions } from '@/stores/captions'
import { useAiReady } from '@/stores/ai'
import { useLive } from '@/stores/live'
import { useLibrary } from '@/stores/library'
import { useSettings } from '@/stores/settings'
import { toast, useUi } from '@/stores/ui'
import { BUILT_IN_PRESETS } from '@/theme/captionPresets'
import { LANGUAGES } from '@/theme/models'
import type { AspectRatio, PlatformId, TargetPlatform } from '@/types'

const MOMENTS = ['Funny moments', 'Big reactions', 'Key insights', 'Questions and answers', 'High energy', 'Story beats']

interface NativeSource {
  path: string
  info: MediaInfo
  preview: string
}

interface UrlSource {
  platform: PlatformId
  url: string
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-[var(--pad-panel)]">
      <h2 className="mb-3.5 flex items-center gap-2.5 text-section font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-s3 font-mono text-label text-t2">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Setting({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-label font-medium text-t2">{label}</span>
        {value ? <span className="font-mono text-label text-t1">{value}</span> : null}
      </div>
      {children}
    </div>
  )
}

export function AutoClipper() {
  const nav = useNavigate()
  const draft = useUi((s) => s.draft)
  const setDraft = useUi((s) => s.setDraft)
  const { video, load, clear } = useLocalVideo()
  const fileRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [urlText, setUrlText] = useState('')
  const [urlErr, setUrlErr] = useState<string | null>(null)
  const [urlSource, setUrlSource] = useState<UrlSource | null>(null)
  const [native, setNative] = useState<NativeSource | null>(null)
  const [linkInfo, setLinkInfo] = useState<UrlInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [rights, setRights] = useState(false)
  const [maxHeight, setMaxHeight] = useState(1080)
  const [probing, setProbing] = useState(false)
  const [probeErr, setProbeErr] = useState<string | null>(null)

  const sens = useSettings((s) => s.sensitivity)
  const setSettings = useSettings((s) => s.set)
  const language = useSettings((s) => s.language)
  const customPresets = useCaptions((s) => s.customPresets)
  const presetId = useCaptions((s) => s.presetId)
  const applyPreset = useCaptions((s) => s.applyPreset)

  const [range, setRange] = useState([20, 60])
  const [count, setCount] = useState(6)
  const [moments, setMoments] = useState<string[]>(['Funny moments', 'Big reactions'])
  const [target, setTarget] = useState<TargetPlatform>('tiktok')
  const [aspect, setAspect] = useState<AspectRatio>('9:16')
  const [captions, setCaptions] = useState(true)
  const [jobId, setJobId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)

  const addGenerated = useLibrary((s) => s.addGeneratedProject)
  const job = useLibrary((s) => s.jobs.find((j) => j.id === jobId))
  const startLinkImport = useLibrary((s) => s.startLinkImport)
  const startFileAnalysis = useLibrary((s) => s.startFileAnalysis)
  const ready = useAiReady()
  const useAnalysis = !IS_MOCK_BACKEND && ready

  /** Desktop app: read the real file with FFmpeg, then show it. */
  const openNative = useCallback(async (path: string) => {
    if (!hasVideoExtension(path)) {
      setProbeErr(`${fileNameOf(path)} does not look like a video. Choose MP4, MOV, MKV, WebM or AVI.`)
      return
    }
    setProbing(true)
    setProbeErr(null)
    try {
      const info = await api.media.probe(path)
      setNative({ path, info, preview: await previewUrl(path) })
      setUrlSource(null)
    } catch (e) {
      setProbeErr(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Could not read this file.')
    } finally {
      setProbing(false)
    }
  }, [])

  const browse = async () => {
    if (IS_MOCK_BACKEND) return fileRef.current?.click()
    const p = await pickVideoPath()
    if (p) void openNative(p)
  }

  // Desktop app: files dropped on the window arrive as paths, not DOM files.
  useEffect(() => {
    if (IS_MOCK_BACKEND) return
    let off: (() => void) | undefined
    let cancelled = false
    void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
      const un = await getCurrentWebview().onDragDropEvent((e) => {
        const t = e.payload.type
        if (t === 'enter' || t === 'over') setOver(true)
        else if (t === 'leave') setOver(false)
        else if (t === 'drop') {
          setOver(false)
          const p = e.payload.paths[0]
          if (p) void openNative(p)
        }
      })
      if (cancelled) un()
      else off = un
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [openNative])

  // Pick up a source handed over from the Dashboard.
  useEffect(() => {
    if (!draft) return
    if (draft.path) {
      void openNative(draft.path)
    } else if (draft.kind === 'url' && draft.url) {
      setUrlText(draft.url)
      checkUrl(draft.url)
    } else if (draft.kind === 'file' && draft.objectUrl) {
      void fetch(draft.objectUrl)
        .then((r) => r.blob())
        .then((b) => load(new File([b], draft.name, { type: b.type })))
    }
    setDraft(null)
  }, [draft, load, setDraft, openNative])

  const hasSource = !!video || !!urlSource || !!native
  // Links need the downloader (Phase 4), so in the desktop app only real local files can be clipped.
  const canGenerate = IS_MOCK_BACKEND ? hasSource : !!native || (!!linkInfo && linkInfo.downloadable && rights)
  const source = useMemo(
    () =>
      native
        ? { title: fileNameOf(native.path), label: native.path, kind: 'file' as const, platform: 'local' as const, duration: native.info.durationSec, size: native.info.sizeBytes, path: native.path }
        : video
        ? { title: video.name, label: video.name, kind: 'file' as const, platform: 'local' as const, duration: video.duration, size: video.size, path: null as string | null }
        : urlSource
          ? { title: linkInfo?.title ?? urlSource.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 56), label: urlSource.url, kind: 'url' as const, platform: urlSource.platform, duration: linkInfo?.durationSec ?? 3600, size: 0, path: null as string | null }
          : null,
    [video, urlSource, native, linkInfo],
  )

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (!IS_MOCK_BACKEND) return // the desktop window delivers drops as file paths instead
    const f = e.dataTransfer.files?.[0]
    if (f) {
      setUrlSource(null)
      load(f)
    }
  }

  function checkUrl(raw: string = urlText) {
    const d = detectPlatform(raw)
    if (!d) {
      setUrlErr('This is not a valid link. Paste a full address starting with http:// or https://')
      return
    }
    setUrlErr(null)
    clear()
    setNative(null)
    setLinkInfo(null)
    setRights(false)
    if (IS_MOCK_BACKEND) return setUrlSource(d)
    // Desktop app: ask yt-dlp what this link is, without downloading it.
    setChecking(true)
    setUrlSource(null)
    api.media
      .probeUrl(d.url)
      .then((info) => {
        setLinkInfo(info)
        setUrlSource({ platform: info.connectorId as PlatformId, url: info.url })
        const best = [...info.heights].reverse().find((h) => h <= 1080)
        setMaxHeight(best ?? 0)
      })
      .catch((e) => setUrlErr(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Could not read this link.'))
      .finally(() => setChecking(false))
  }

  /** A live link cannot be downloaded: hand it to the Live Clipper instead. */
  const openInLive = () => {
    if (!linkInfo) return
    const live = useLive.getState()
    const known = live.streams.find((s) => s.url === linkInfo.url)
    if (known) live.select(known.id)
    else live.add(linkInfo.connectorId as PlatformId, linkInfo.url)
    nav('/live')
  }

  const generate = async () => {
    if (!source) return
    if (!IS_MOCK_BACKEND && linkInfo && !native) {
      const id = await startLinkImport({
        url: linkInfo.url, title: linkInfo.title, platform: linkInfo.connectorId as PlatformId, duration: linkInfo.durationSec ?? 0, maxHeight, uploader: linkInfo.uploader,
        gen: { count, aspect, target, withCaptions: captions, minLen: range[0], maxLen: range[1], moments },
      })
      if (id) {
        setJobId(id)
        setProjectId(useLibrary.getState().projects[0]?.id ?? null)
        toast({ kind: 'info', title: 'Download started', body: 'Follow progress here or in History. Clips appear when it finishes.' })
      }
      return
    }
    if (useAnalysis && native) {
      const r = await startFileAnalysis({
        path: native.path, title: fileNameOf(native.path), duration: native.info.durationSec, sizeBytes: native.info.sizeBytes,
        gen: { count, aspect, target, withCaptions: captions, minLen: range[0], maxLen: range[1], moments },
      })
      if (r) {
        setJobId(r.jobId)
        setProjectId(r.projectId)
        toast({ kind: 'info', title: 'Transcribing on this computer', body: 'Clips appear when it finishes. Follow progress here or in History.' })
      }
      return
    }
    const pid = addGenerated({
      title: source.title, sourceLabel: source.label, kind: source.kind, platform: source.platform,
      duration: source.duration, sizeBytes: source.size, count, aspect, target, withCaptions: captions,
      sourcePath: source.path, minLen: range[0], maxLen: range[1],
    })
    setProjectId(pid)
    const jobs = useLibrary.getState().jobs
    setJobId(jobs[0]?.id ?? null)
    toast({ kind: 'info', title: IS_MOCK_BACKEND ? 'Simulated run started' : 'Splitting into clips', body: IS_MOCK_BACKEND ? `Generating ${count} sample clips. No video is analysed in this build.` : `Clips are spaced evenly for now. Set up local AI in Settings to detect highlights.` })
  }

  const done = job?.status === 'completed'
  const running = job?.status === 'running' || job?.status === 'queued'

  return (
    <Page className="grid grid-cols-12 gap-5">
      <div className="col-span-7 flex flex-col gap-5">
        <Section n={1} title="Choose a source">
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setUrlSource(null); load(f) } e.target.value = '' }} />
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={cn(
              'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-9 text-center transition-colors duration-150',
              over ? 'border-accent bg-accent/10' : 'border-line2 bg-s2/50',
            )}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-s3 text-t1"><Upload size={20} /></div>
            <div>
              <p className="text-section font-semibold">Drop a video here</p>
              <p className="text-body text-t2">MP4, MOV, MKV or WebM. The file stays on this computer.</p>
            </div>
            <Button onClick={browse} loading={probing}>{probing ? null : <FileVideo size={15} />}{probing ? 'Reading video' : 'Browse files'}</Button>
            {probeErr ? <p role="alert" className="max-w-md rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-label text-bad">{probeErr}</p> : null}
          </div>

          <div className="my-4 flex items-center gap-3 text-meta text-t3"><span className="h-px flex-1 bg-line" />or paste a link<span className="h-px flex-1 bg-line" /></div>

          <Field label="Video or livestream URL" error={urlErr} hint="YouTube, Twitch, Kick, TikTok, Facebook or a direct stream link.">
            {(id, desc) => (
              <div className="flex gap-2">
                <Input id={id} aria-describedby={desc} aria-invalid={!!urlErr} value={urlText} onChange={(e) => { setUrlText(e.target.value); setUrlErr(null) }} onKeyDown={(e) => e.key === 'Enter' && checkUrl()} placeholder="https://" />
                <Button onClick={() => checkUrl()} loading={checking}>{checking ? null : <Link2 size={15} />}{checking ? 'Checking' : 'Check link'}</Button>
              </div>
            )}
          </Field>
        </Section>

        <Section n={2} title="Video information">
          {!source ? (
            <p className="rounded-md border border-line bg-s2/50 px-4 py-7 text-center text-body text-t2">Nothing selected yet. Add a file or link above to see its details.</p>
          ) : (
            <div className="flex gap-4">
              {native ? (
                <video src={native.preview} controls preload="metadata" className="aspect-video w-60 shrink-0 rounded-md bg-black" />
              ) : video ? (
                <video src={video.src} controls className="aspect-video w-60 shrink-0 rounded-md bg-black" />
              ) : linkInfo?.thumbnail ? (
                <img src={linkInfo.thumbnail} alt="" referrerPolicy="no-referrer" className="aspect-video w-60 shrink-0 rounded-md bg-black object-cover" />
              ) : (
                <div className="thumb flex aspect-video w-60 shrink-0 items-center justify-center rounded-md" style={{ ['--h' as string]: 222 }}>
                  <span className="relative z-[1] px-4 text-center text-label text-white/70">{IS_MOCK_BACKEND ? 'Preview needs the downloader' : 'No preview image from this site'}</span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-section font-semibold" title={source.title}>{source.title}</p>
                  <Button variant="ghost" size="icon-sm" aria-label="Remove source" onClick={() => { clear(); setUrlSource(null); setNative(null); setLinkInfo(null); setRights(false); setUrlText('') }}><X size={15} /></Button>
                </div>
                <dl className="mt-2 grid grid-cols-[88px_1fr] gap-y-1.5 text-body">
                  <dt className="text-t3">Source</dt>
                  <dd className="flex items-center gap-2"><PlatformMark id={source.platform} size={20} />{PLATFORMS[source.platform].name}</dd>
                  <dt className="text-t3">Duration</dt>
                  <dd>{native ? fmtDuration(native.info.durationSec) : video ? fmtDuration(video.duration) : linkInfo?.durationSec ? fmtDuration(linkInfo.durationSec) : 'Read after download'}</dd>
                  {linkInfo?.uploader ? (<><dt className="text-t3">Uploader</dt><dd className="truncate">{linkInfo.uploader}</dd></>) : null}
                  {linkInfo?.sizeBytesApprox ? (<><dt className="text-t3">Size</dt><dd>about {fmtBytes(linkInfo.sizeBytesApprox)}</dd></>) : null}
                  {video || native ? (<><dt className="text-t3">Size</dt><dd>{fmtBytes(native ? native.info.sizeBytes : video!.size)}</dd></>) : null}
                  {native ? (<><dt className="text-t3">Picture</dt><dd>{native.info.width} × {native.info.height}, {native.info.fps} fps, {native.info.videoCodec}</dd><dt className="text-t3">Audio</dt><dd>{native.info.audioCodec ?? 'No audio track'}</dd></>) : null}
                  <dt className="text-t3">Access</dt>
                  <dd>{video || native ? <Badge tone="success"><CheckCircle2 size={11} />{native ? 'Read by FFmpeg' : 'Local file readable'}</Badge> : linkInfo ? (linkInfo.downloadable ? <Badge tone="success"><CheckCircle2 size={11} />Found by yt-dlp</Badge> : <Badge tone="danger">Cannot import</Badge>) : <Badge tone="warning">Not checked, mock</Badge>}</dd>
                </dl>
                {!video && !native && IS_MOCK_BACKEND ? <p className="mt-3 text-meta text-t3">Link format is valid. Whether the video is public or needs a sign-in is checked by the desktop app.</p> : null}
                {linkInfo && !linkInfo.downloadable ? <p role="alert" className="mt-3 rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-label text-bad">{linkInfo.blockReason}</p> : null}
                {linkInfo?.isLive ? <Button variant="primary" className="mt-3" onClick={openInLive}>Monitor in Live Clipper</Button> : null}
                {linkInfo?.downloadable ? (
                  <div className="mt-3 flex flex-col gap-2.5">
                    <div className="flex items-center gap-3">
                      <span className="text-label text-t2">Download quality</span>
                      <div className="w-40"><Select aria-label="Download quality" value={String(maxHeight)} onChange={(v) => setMaxHeight(Number(v))} options={[{ value: '0', label: 'Best available' }, ...linkInfo.heights.filter((h) => h >= 240).map((h) => ({ value: String(h), label: `${h}p` }))]} /></div>
                    </div>
                    <p className="text-meta text-t3">{linkInfo.notice}</p>
                    <label className="flex cursor-default items-start gap-2.5 text-body">
                      <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
                      <span>I own this video or have permission to use it.</span>
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </Section>
      </div>

      <div className="col-span-5 flex flex-col gap-5">
        <Section n={3} title="Clip settings">
          <div className="flex flex-col gap-5">
            <Setting label="Clip length" value={`${range[0]} to ${range[1]} s`}>
              <Slider label="Clip length range" min={10} max={180} step={5} value={range} onChange={setRange} />
            </Setting>
            <Setting label="Number of clips" value={String(count)}>
              <Slider label="Number of clips" min={1} max={20} value={[count]} onChange={([v]) => setCount(v)} />
            </Setting>
            <Setting label="Look for">
              <div className="flex flex-wrap gap-1.5">
                {MOMENTS.map((m) => (
                  <Chip key={m} active={moments.includes(m)} onClick={() => setMoments((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}>{m}</Chip>
                ))}
              </div>
              {moments.length === 0 ? <p className="text-meta text-warn">With nothing selected, all moment types are considered.</p> : null}
            </Setting>
            <Setting label="Detection sensitivity" value={`${sens}%`}>
              <Slider label="Detection sensitivity" min={10} max={100} step={5} value={[sens]} onChange={([v]) => setSettings({ sensitivity: v })} />
              <p className="text-meta text-t3">Higher finds more candidates and keeps weaker ones.</p>
            </Setting>
          </div>
        </Section>

        <Section n={4} title="Output">
          <div className="flex flex-col gap-5">
            <Setting label="Target platform">
              <Select aria-label="Target platform" value={target} onChange={setTarget} options={(Object.keys(TARGETS) as TargetPlatform[]).map((t) => ({ value: t, label: TARGETS[t] }))} />
            </Setting>
            <Setting label="Aspect ratio">
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Aspect ratio">
                {(Object.keys(ASPECT_DIMS) as AspectRatio[]).map((a) => {
                  const d = ASPECT_DIMS[a]
                  const r = d.w / d.h
                  return (
                    <button
                      key={a}
                      role="radio"
                      aria-checked={aspect === a}
                      onClick={() => setAspect(a)}
                      className={cn('no-drag flex flex-col items-center gap-2 rounded-lg border px-2 py-3 transition-colors duration-150', aspect === a ? 'border-accent bg-accent/10' : 'border-line hover:border-line2')}
                    >
                      <span className="flex h-9 items-center"><span className="rounded-[3px] border-2 border-t2" style={{ width: r >= 1 ? 30 : 30 * r, height: r >= 1 ? 30 / r : 30 }} /></span>
                      <span className="text-label font-medium">{a}</span>
                    </button>
                  )
                })}
              </div>
            </Setting>
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-s2/50 p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-body font-medium">Generate captions</p>
                  <p className="text-meta text-t3">{IS_MOCK_BACKEND || ready ? 'Local Faster-Whisper, no cloud.' : 'Needs local AI to be set up.'}</p>
                </div>
                <Switch label="Generate captions" checked={captions} onChange={setCaptions} />
              </div>
              {captions ? (
                <div className="grid grid-cols-2 gap-2">
                  <Select aria-label="Caption preset" value={presetId ?? 'bold-creator'} onChange={applyPreset} options={[...BUILT_IN_PRESETS, ...customPresets].map((p) => ({ value: p.id, label: p.name }))} />
                  <Select aria-label="Spoken language" value={language} onChange={(v) => setSettings({ language: v })} options={LANGUAGES} />
                </div>
              ) : null}
            </div>
          </div>
        </Section>

        <div className="panel sticky bottom-0 flex flex-col gap-3 border-accent/25 p-[var(--pad-panel)]">
          {job && projectId ? (
            <div>
              <div className="mb-1.5 flex justify-between text-body"><span>{job.kind === 'transcribe' && !job.simulated ? (running ? 'Transcribing and finding highlights' : done ? 'Done' : job.status === 'failed' ? 'Transcription failed' : 'Waiting') : job.kind === 'download' ? (running ? 'Downloading the video' : done ? 'Download finished' : job.status === 'failed' ? 'Download failed' : 'Waiting to download') : running ? 'Simulating clip generation' : done ? 'Simulation finished' : job.title}</span><span className="font-mono text-label">{Math.round(job.progress)}%</span></div>
              <Progress value={job.progress} tone={done ? 'success' : 'accent'} label="Generation progress" />
              <div className="mt-2 flex justify-end empty:hidden"><StopJob jobId={job.id} /></div>
            </div>
          ) : null}
          {done ? (
            <Button variant="primary" size="lg" onClick={() => nav(`/clips?project=${projectId}`)}>{IS_MOCK_BACKEND ? `Open ${count} sample clips` : 'Open the clips'}</Button>
          ) : (
            <Button variant="primary" size="lg" disabled={!canGenerate || running} loading={running} onClick={() => void generate()}>
              {running ? null : <Sparkles size={16} />}
              {!IS_MOCK_BACKEND && linkInfo && !native ? `Download and make up to ${count} clips` : useAnalysis ? `Find up to ${count} highlights` : `Generate ${count} clips`}
            </Button>
          )}
          <p className="text-center text-meta text-t3">{job?.status === 'failed' && job.error ? job.error : !canGenerate ? (linkInfo && !linkInfo.downloadable ? 'This link cannot be imported.' : linkInfo ? 'Confirm you may use this video to continue.' : hasSource ? 'Choose a video file or check a link.' : 'Add a source to enable generation.') : IS_MOCK_BACKEND ? 'This build simulates the run and creates sample clips. Nothing is analysed or rendered.' : useAnalysis ? 'Speech is transcribed on this computer, then moments are scored. The first run can take a while.' : 'Local AI is not set up, so clips are spaced evenly with no captions. Set it up in Settings, AI.'}</p>
          {!IS_MOCK_BACKEND && !ready ? <Button size="sm" onClick={() => nav('/settings?tab=ai')}>Set up local AI</Button> : null}
        </div>
      </div>
    </Page>
  )
}
