import { AudioLines, CircleStop, Loader2, Play, Plus, Radio, Scissors, Trash2, Wifi, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Page, PlatformMark } from '@/components/Common'
import { Button } from '@/components/ui/Button'
import { Select, Switch } from '@/components/ui/Controls'
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog'
import { Badge, EmptyState, SectionHeader } from '@/components/ui/Display'
import { Field, Input } from '@/components/ui/Input'
import { PLATFORMS, detectPlatform } from '@/lib/labels'
import { previewUrl } from '@/lib/native'
import { cn, fmtDuration } from '@/lib/utils'
import { IS_MOCK_BACKEND } from '@/services'
import { useAiReady } from '@/stores/ai'
import { useLibrary } from '@/stores/library'
import { useLive } from '@/stores/live'
import { useSettings } from '@/stores/settings'
import type { LiveStream, PlatformId, StreamState } from '@/types'

const CONNECTORS: { id: PlatformId; label: string }[] = [
  { id: 'youtube', label: 'YouTube Live' },
  { id: 'twitch', label: 'Twitch' },
  { id: 'kick', label: 'Kick' },
  { id: 'tiktok', label: 'TikTok Live' },
  { id: 'facebook', label: 'Facebook Live' },
  { id: 'generic', label: 'Generic HLS or RTMP' },
]

const STATE: Record<StreamState, { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' }> = {
  idle: { label: 'Not monitoring', tone: 'neutral' },
  connecting: { label: 'Connecting', tone: 'warning' },
  monitoring: { label: IS_MOCK_BACKEND ? 'Monitoring (simulated)' : 'Monitoring', tone: 'success' },
  reconnecting: { label: 'Reconnecting', tone: 'warning' },
  error: { label: 'Stopped with an error', tone: 'danger' },
}

const active = (s: StreamState) => s === 'connecting' || s === 'monitoring' || s === 'reconnecting'

/** RTMP addresses end in a secret stream key, so only the server part is shown. */
const shownUrl = (url: string) => (url.startsWith('rtmp') ? url.replace(/^(rtmps?:\/\/[^/]+).*/, '$1/…') : url)

function StreamRow({ s, selected, onSelect }: { s: LiveStream; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={cn('no-drag flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors duration-150', selected ? 'border-accent/60 bg-s3' : 'border-line bg-s2/40 hover:border-line2')}
    >
      <PlatformMark id={s.platform} size={30} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium">{s.title}</p>
        <p className="text-meta text-t3">{PLATFORMS[s.platform].name}</p>
      </div>
      {s.state === 'monitoring' ? <span className="live-pulse rounded bg-bad px-1.5 py-px text-meta font-semibold text-white">LIVE</span> : <Badge tone={STATE[s.state].tone}>{s.state === 'idle' ? 'Idle' : STATE[s.state].label}</Badge>}
    </button>
  )
}

function Preview({ s }: { s: LiveStream }) {
  const [src, setSrc] = useState<string | null>(null)
  // The thumbnail file is overwritten each segment; bust the cache with the segment number.
  const stamp = Math.floor(s.uptimeSec / 8)
  useEffect(() => {
    if (!s.thumbnail) return setSrc(null)
    void previewUrl(s.thumbnail).then((u) => setSrc(`${u}?v=${stamp}`))
  }, [s.thumbnail, stamp])
  return (
    <div className="thumb flex aspect-video items-center justify-center" style={{ ['--h' as string]: 222 }}>
      {src ? <img src={src} alt="Latest frame of the stream" className="absolute inset-0 z-[1] h-full w-full bg-black object-contain" /> : null}
      <div className="relative z-[2] flex flex-col items-center gap-2 text-center">
        {s.state === 'monitoring' && !src ? <span className="live-pulse rounded bg-bad px-2 py-0.5 text-label font-semibold text-white">LIVE</span> : null}
        {src ? null : (
          <span className="max-w-xs rounded bg-black/45 px-3 py-1.5 text-label text-white/80">
            {IS_MOCK_BACKEND ? 'This is a simulated session. Real monitoring runs in the desktop app.' : active(s.state) ? 'Waiting for the first segment' : 'Start monitoring to see the stream'}
          </span>
        )}
      </div>
    </div>
  )
}

export function LiveClipper() {
  const nav = useNavigate()
  const { streams, selectedId, select, add, remove, start, stop, clipNow, loaded } = useLive()
  const settings = useSettings()
  const ai = useAiReady()
  const [addOpen, setAddOpen] = useState(false)
  const [plat, setPlat] = useState<PlatformId>('twitch')
  const [url, setUrl] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [rights, setRights] = useState<string[]>([])
  const cur = streams.find((s) => s.id === selectedId)
  /** Straight to the editor, where the subtitles can be checked and the video exported. */
  const openClip = (projectId: string) => {
    const clip = useLibrary.getState().clips.find((c) => c.projectId === projectId)
    nav(clip ? `/editor/${clip.id}` : `/clips?project=${projectId}`)
  }
  const confirmed = !!cur && (IS_MOCK_BACKEND || rights.includes(cur.id))

  const submit = () => {
    const rtmp = /^rtmps?:\/\/[^/\s]+\/\S*$/i.test(url.trim())
    const d = rtmp ? { platform: 'generic' as const, url: url.trim() } : detectPlatform(url)
    if (!d) return setErr('Enter a full stream address starting with https:// or rtmp://')
    if (d.platform !== 'generic' && d.platform !== plat) return setErr(`This looks like a ${PLATFORMS[d.platform].name} link, but ${PLATFORMS[plat].name} is selected.`)
    if (streams.some((s) => s.url === d.url)) return setErr('This stream is already in your list.')
    add(d.platform === 'generic' ? 'generic' : plat, d.url)
    setAddOpen(false)
    setUrl('')
    setErr(null)
  }

  return (
    <Page className="grid grid-cols-12 gap-5">
      <aside className="col-span-4 flex flex-col gap-4" aria-label="Streams">
        <section className="panel p-[var(--pad-panel)]">
          <SectionHeader title="Streams" action={<Button size="sm" onClick={() => setAddOpen(true)}><Plus size={14} />Add stream</Button>} />
          {!loaded ? (
            <p className="py-6 text-center text-body text-t2"><Loader2 className="spin mx-auto mb-2" size={18} />Loading streams</p>
          ) : streams.length === 0 ? (
            <EmptyState icon={Radio} title="No streams yet" body="Add a stream link to watch it for highlights." action={<Button variant="primary" onClick={() => setAddOpen(true)}>Add stream</Button>} />
          ) : (
            <ul className="flex flex-col gap-2">
              {streams.map((s) => (
                <li key={s.id}><StreamRow s={s} selected={s.id === selectedId} onSelect={() => select(s.id)} /></li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel p-[var(--pad-panel)]">
          <SectionHeader title="Monitoring options" hint="Apply when monitoring starts" />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-t2">Clip highlights automatically</span>
              <Switch label="Clip highlights automatically" checked={settings.liveAutoClip} onChange={(v) => settings.set({ liveAutoClip: v })} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-t2">Rolling buffer</span>
              <div className="w-32"><Select aria-label="Rolling buffer" value={String(settings.liveBufferMinutes)} onChange={(v) => settings.set({ liveBufferMinutes: Number(v) })} options={[5, 10, 20, 30].map((m) => ({ value: String(m), label: `${m} minutes` }))} /></div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-t2">Stream quality</span>
              <div className="w-32"><Select aria-label="Stream quality" value={String(settings.liveQuality)} onChange={(v) => settings.set({ liveQuality: Number(v) })} options={[480, 720, 1080].map((q) => ({ value: String(q), label: `${q}p` }))} /></div>
            </div>
            {!IS_MOCK_BACKEND && !ai ? (
              <div className="rounded-md border border-warn/25 bg-warn/10 px-3 py-2 text-label text-warn">
                Local AI is not ready, so nothing is detected automatically. You can still clip the last seconds by hand.
                <Button size="sm" className="mt-2" onClick={() => nav('/settings?tab=ai')}>Set up local AI</Button>
              </div>
            ) : null}
          </div>
        </section>
      </aside>

      <div className="col-span-8 flex flex-col gap-5">
        {!cur ? (
          <section className="panel"><EmptyState icon={Radio} title="Select a stream" body="Pick a stream on the left, or add one, to see its monitor." /></section>
        ) : (
          <>
            <section className="panel overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                <PlatformMark id={cur.platform} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-section font-semibold">{cur.title}</p>
                  <p className="truncate font-mono text-meta text-t3">{shownUrl(cur.url)}</p>
                </div>
                {active(cur.state) ? (
                  <Button variant="danger" onClick={() => stop(cur.id)}><CircleStop size={15} />Stop monitoring</Button>
                ) : (
                  <Button variant="primary" disabled={!confirmed} onClick={() => start(cur.id)}><Play size={15} />Start monitoring</Button>
                )}
                <Button variant="ghost" size="icon" aria-label="Remove stream" onClick={() => setRemoving(cur.id)}><Trash2 size={16} /></Button>
              </div>

              {IS_MOCK_BACKEND || active(cur.state) ? null : (
                <label className="flex cursor-default items-start gap-2.5 border-b border-line px-4 py-3 text-body">
                  <input
                    type="checkbox"
                    checked={rights.includes(cur.id)}
                    onChange={(e) => setRights((r) => (e.target.checked ? [...r, cur.id] : r.filter((x) => x !== cur.id)))}
                    className="mt-1 accent-[var(--accent)]"
                  />
                  <span>I have the right to record and clip this stream. <span className="text-t3">Only what your own access allows is recorded, and the platform's terms apply.</span></span>
                </label>
              )}
              {cur.message ? <p role="alert" className={cn('border-b border-line px-4 py-2.5 text-label', cur.state === 'error' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}>{cur.message}</p> : null}

              <div className="grid grid-cols-[1fr_260px]">
                <Preview s={cur} />
                <dl className="flex flex-col divide-y divide-line border-l border-line text-body">
                  {[
                    ['Connection', <span key="c" className="flex items-center gap-1.5">{cur.state === 'monitoring' ? <Wifi size={14} className="text-ok" /> : <WifiOff size={14} className="text-t3" />}{STATE[cur.state].label}</span>],
                    ['Monitoring time', <span key="d" className="font-mono">{fmtDuration(cur.uptimeSec)}</span>],
                    ['Buffered', <span key="b" className="font-mono">{fmtDuration(cur.bufferedSec ?? 0)}</span>],
                    ['AI detection', <span key="a" className="flex items-center gap-1.5"><AudioLines size={14} className={cur.state === 'monitoring' && cur.transcribing ? 'text-accent' : 'text-t3'} />{cur.state !== 'monitoring' ? 'Off' : cur.transcribing ? (IS_MOCK_BACKEND ? 'Listening, simulated' : 'Listening') : 'Off, manual clips only'}</span>],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex flex-1 flex-col justify-center px-4 py-3">
                      <dt className="text-meta text-t3">{k}</dt>
                      <dd className="mt-0.5">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              {IS_MOCK_BACKEND || cur.state !== 'monitoring' ? null : (
                <div className="flex items-center gap-2 border-t border-line px-4 py-3">
                  <span className="mr-auto text-label text-t2">Missed something? Cut it from the buffer.</span>
                  {[10, 15, 30, 60].map((sec) => (
                    <Button key={sec} onClick={() => clipNow(cur.id, sec)}><Scissors size={14} />Last {sec} s</Button>
                  ))}
                </div>
              )}
            </section>

            <section className="panel p-[var(--pad-panel)]" aria-label="Highlights">
              <SectionHeader title="Highlights" hint={IS_MOCK_BACKEND ? 'Simulated detections' : 'Found moments and your manual clips. Each becomes a clip in My Clips.'} />
              {cur.highlights.length === 0 ? (
                <p className="py-8 text-center text-body text-t2">{cur.state === 'monitoring' ? 'Listening. Good moments appear here once they are over.' : 'Start monitoring to see highlights here.'}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {cur.highlights.map((h) => (
                    <li key={h.id} className="flex items-center gap-3 py-2.5">
                      <span className="w-12 font-mono text-label text-t2">{fmtDuration(h.atSec)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body">{h.title ?? h.label}</p>
                        {h.title ? <p className="truncate text-meta text-t3">{h.label}</p> : null}
                      </div>
                      {h.score ? <span className="font-mono text-label text-accent">{h.score}</span> : null}
                      <Badge tone={h.clipState === 'ready' ? 'success' : h.clipState === 'failed' ? 'danger' : h.clipState === 'rendering' ? 'accent' : 'neutral'}>
                        {h.clipState === 'ready' ? 'Ready' : h.clipState === 'failed' ? 'Failed' : h.clipState === 'rendering' ? 'Cutting' : 'Queued'}
                      </Badge>
                      {h.projectId ? <Button size="sm" onClick={() => openClip(h.projectId!)}>Subtitles and export</Button> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <Dialog
        open={addOpen}
        onOpenChange={(o) => { setAddOpen(o); if (!o) setErr(null) }}
        title="Add a stream"
        description="Choose a platform and paste the stream link. Nothing connects until you start monitoring."
        width={480}
        footer={<><Button onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="primary" onClick={submit}>Add stream</Button></>}
      >
        <div className="flex flex-col gap-4">
          <Field label="Platform">{(id) => <Select id={id} value={plat} onChange={setPlat} options={CONNECTORS.map((c) => ({ value: c.id, label: c.label }))} />}</Field>
          <Field label="Stream URL" error={err} hint="RTMP addresses contain a secret key. It is stored only on this PC and never logged.">
            {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!err} autoFocus value={url} onChange={(e) => { setUrl(e.target.value); setErr(null) }} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="https://" />}
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this stream?"
        description="Monitoring stops and its buffer is discarded. Clips already saved stay in My Clips."
        confirmLabel="Remove stream"
        onConfirm={() => { if (removing) remove(removing); setRemoving(null) }}
      />
    </Page>
  )
}
