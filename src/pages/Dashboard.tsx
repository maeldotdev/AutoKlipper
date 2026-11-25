import { ArrowRight, Clapperboard, FolderKanban, HardDrive, Link2, Radio, Timer, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Page, PlatformMark, StatTile, Thumb } from '@/components/Common'
import { SetupCheck } from '@/components/SetupCheck'
import { Button } from '@/components/ui/Button'
import { Badge, EmptyState, Progress, SectionHeader, Skeleton } from '@/components/ui/Display'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input } from '@/components/ui/Input'
import { PROJECT_STATUS, detectPlatform } from '@/lib/labels'
import { fmtBytes, fmtDuration, fmtRelative } from '@/lib/utils'
import { ACTIVITY_WEEK } from '@/mock/library'
import { useStorage } from '@/hooks/useStorage'
import { IS_MOCK_BACKEND } from '@/services'
import { fileNameOf, pickVideoPath } from '@/lib/native'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'

const storageTone = ['bg-accent', 'bg-cyan', 'bg-warn', 'bg-t3', 'bg-ok']

function Greeting() {
  const h = new Date().getHours()
  return <>{h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}</>
}

export function Dashboard() {
  const nav = useNavigate()
  const { status, projects, clips, jobs } = useLibrary()
  const setDraft = useUi((s) => s.setDraft)
  const fileRef = useRef<HTMLInputElement>(null)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const loading = status !== 'ready'

  const running = jobs.filter((j) => j.status === 'running')
  const totalSrc = projects.reduce((a, p) => a + p.duration, 0)
  const storage = useStorage()
  const barTotal = storage.totalBytes ?? Math.max(storage.used, 1)
  const week = useMemo(() => {
    if (IS_MOCK_BACKEND) return ACTIVITY_WEEK
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - (6 - i))
      return { start: d.getTime(), day: d.toLocaleDateString(undefined, { weekday: 'short' }), clips: 0 }
    })
    clips.forEach((c) => {
      const t = new Date(c.createdAt).getTime()
      const slot = [...days].reverse().find((d) => t >= d.start)
      if (slot) slot.clips++
    })
    return days.map(({ day, clips: n }) => ({ day, clips: n }))
  }, [clips])

  const submitUrl = () => {
    const d = detectPlatform(url)
    if (!d) return setErr('Enter a full link that starts with http:// or https://')
    setDraft({ kind: 'url', name: d.url, url: d.url })
    setUrlOpen(false)
    setUrl('')
    setErr(null)
    nav('/auto-clipper')
  }

  const actions = [
    { icon: Upload, title: 'Import video', body: 'Pick a local file to clip.', onClick: () => { if (IS_MOCK_BACKEND) fileRef.current?.click(); else void pickVideoPath().then((p) => { if (p) { setDraft({ kind: 'file', name: fileNameOf(p), path: p }); nav('/auto-clipper') } }) }, primary: true },
    { icon: Link2, title: 'Paste video URL', body: 'YouTube, Twitch, Kick and more.', onClick: () => setUrlOpen(true) },
    { icon: Radio, title: 'Start live clipping', body: 'Monitor a stream for highlights.', onClick: () => nav('/live') },
  ]

  return (
    <Page className="flex flex-col gap-6">
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (!f) return
          setDraft({ kind: 'file', name: f.name, sizeBytes: f.size, objectUrl: URL.createObjectURL(f) })
          nav('/auto-clipper')
          e.target.value = ''
        }}
      />

      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-title font-semibold"><Greeting /></h2>
          <p className="mt-0.5 text-body text-t2">
            {running.length ? `${running.length} job${running.length === 1 ? ' is' : 's are'} running.` : 'Nothing is processing. Start from a video or a stream.'}
          </p>
        </div>
      </section>

      <SetupCheck />

      <section className="grid grid-cols-3 gap-4" aria-label="Start">
        {actions.map((a) => (
          <button
            key={a.title}
            onClick={a.onClick}
            className={`no-drag group panel flex items-center gap-4 p-4 text-left transition-[border-color,background-color] duration-150 hover:border-accent/50 hover:bg-s2 ${a.primary ? 'border-accent/40 bg-accent/[0.07]' : ''}`}
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${a.primary ? 'bg-accent text-accent-fg' : 'bg-s3 text-t1'}`}>
              <a.icon size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-section font-semibold">{a.title}</p>
              <p className="text-label text-t2">{a.body}</p>
            </div>
            <ArrowRight size={16} className="text-t3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-t1" />
          </button>
        ))}
      </section>

      <section className="grid grid-cols-4 gap-4" aria-label="Statistics">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[84px]" />)
        ) : (
          <>
            <StatTile label="Projects" value={String(projects.length)} sub={`${projects.filter((p) => p.status === 'ready').length} ready`} icon={<FolderKanban size={19} />} />
            <StatTile label="Clips" value={String(clips.length)} sub={`${clips.filter((c) => c.exportStatus === 'exported').length} exported`} icon={<Clapperboard size={19} />} />
            <StatTile label="Source footage" value={`${(totalSrc / 3600).toFixed(1)} h`} sub="Across all projects" icon={<Timer size={19} />} />
            <StatTile label="Storage used" value={fmtBytes(storage.used)} sub={storage.totalBytes ? `of ${fmtBytes(storage.totalBytes)} sample volume` : 'By AutoKlipper on this PC'} icon={<HardDrive size={19} />} />
          </>
        )}
      </section>

      <div className="grid grid-cols-12 gap-4">
        <section className="panel col-span-8 p-[var(--pad-panel)]" aria-label="Recent projects">
          <SectionHeader title="Recent projects" action={<Button variant="ghost" size="sm" onClick={() => nav('/projects')}>View all<ArrowRight size={13} /></Button>} />
          {loading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : projects.length === 0 ? (
            <EmptyState icon={FolderKanban} title="No projects yet" body="Import a video or paste a link and your first project appears here." action={<Button variant="primary" onClick={() => fileRef.current?.click()}>Import video</Button>} />
          ) : (
            <ul className="flex flex-col">
              {projects.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <Link to={`/clips?project=${p.id}`} className="no-drag flex items-center gap-3.5 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-s2">
                    <Thumb hue={p.hue} className="w-24 shrink-0 rounded-md" ratio={16 / 9} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{p.title}</p>
                      <p className="flex items-center gap-2 text-label text-t3">
                        <PlatformMark id={p.platform} size={18} />
                        <span>{fmtDuration(p.duration)}</span>
                        <span>{fmtRelative(p.createdAt)}</span>
                      </p>
                    </div>
                    <span className="text-label text-t2">{p.clipCount} clips</span>
                    <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel col-span-4 flex flex-col p-[var(--pad-panel)]" aria-label="Processing activity">
          <SectionHeader title="Processing activity" hint={IS_MOCK_BACKEND ? 'Simulated jobs' : 'Downloads, captions and exports'} />
          {loading ? (
            <Skeleton className="h-40" />
          ) : running.length === 0 ? (
            <p className="py-6 text-center text-body text-t2">All quiet. Jobs you start appear here with live progress.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {running.map((j) => (
                <li key={j.id}>
                  <div className="mb-1.5 flex justify-between gap-2 text-body">
                    <span className="truncate">{j.title}</span>
                    <span className="font-mono text-label text-t2">{Math.round(j.progress)}%</span>
                  </div>
                  <Progress value={j.progress} label={j.title} />
                  <p className="mt-1 truncate text-meta text-t3">{j.source}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto pt-5">
            <p className="mb-1 text-label text-t2">Clips created this week{IS_MOCK_BACKEND ? ' (sample)' : ''}</p>
            <div className="h-28" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={week} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
                  <defs>
                    <linearGradient id="act" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-3)', fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--text-3)', fontSize: 11 }} allowDecimals={false} />
                  <RTooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--line-strong)', borderRadius: 8, fontSize: 12 }} cursor={{ stroke: 'var(--line-strong)' }} />
                  <Area dataKey="clips" stroke="var(--accent)" strokeWidth={2} fill="url(#act)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="panel col-span-8 p-[var(--pad-panel)]" aria-label="Recent clips">
          <SectionHeader title="Recently generated clips" action={<Button variant="ghost" size="sm" onClick={() => nav('/clips')}>View all<ArrowRight size={13} /></Button>} />
          {loading ? (
            <div className="grid grid-cols-5 gap-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="aspect-[9/14]" />)}</div>
          ) : clips.length === 0 ? (
            <EmptyState icon={Clapperboard} title="No clips yet" body="Generated clips show up here, newest first." />
          ) : (
            <ul className="grid grid-cols-5 gap-3">
              {clips.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link to={`/editor/${c.id}`} className="no-drag group block">
                    <Thumb hue={c.hue} ratio={9 / 14} duration={c.endSec - c.startSec} className="rounded-md ring-1 ring-line transition-[box-shadow] duration-150 group-hover:ring-accent/60" />
                    <p className="mt-1.5 truncate text-body">{c.title}</p>
                    <p className="text-meta text-t3">{c.aspect} for {c.target === 'shorts' ? 'Shorts' : c.target === 'fb-reels' ? 'Facebook' : c.target === 'reels' ? 'Reels' : 'TikTok'}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel col-span-4 p-[var(--pad-panel)]" aria-label="Storage usage">
          <SectionHeader title="Storage" hint={storage.real ? 'AutoKlipper folders on this PC' : 'Sample values for the prototype'} />
          <div className="flex h-2.5 overflow-hidden rounded-full bg-s3" role="img" aria-label={`${fmtBytes(storage.used)} used`}>
            {(storage.items ?? []).map((s, i) => (
              <div key={s.id} className={storageTone[i]} style={{ width: `${(s.bytes / barTotal) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-4 flex flex-col gap-2.5">
            {(storage.items ?? []).map((s, i) => (
              <li key={s.id} className="flex items-center gap-2.5 text-body">
                <span className={`h-2.5 w-2.5 rounded-sm ${storageTone[i]}`} aria-hidden />
                <span className="flex-1 text-t2">{s.label}</span>
                <span className="font-mono text-label">{fmtBytes(s.bytes)}</span>
              </li>
            ))}
          </ul>
          <Button className="mt-5 w-full" onClick={() => nav('/settings?tab=storage')}>Manage storage</Button>
        </section>
      </div>

      <Dialog
        open={urlOpen}
        onOpenChange={(o) => {
          setUrlOpen(o)
          if (!o) setErr(null)
        }}
        title="Paste a video URL"
        description={IS_MOCK_BACKEND ? 'AutoKlipper checks the link and opens the Auto Clipper.' : 'AutoKlipper looks the link up, shows what it found, and opens the Auto Clipper. Nothing downloads until you confirm.'}
        width={480}
        footer={
          <>
            <Button onClick={() => setUrlOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={submitUrl}>Continue</Button>
          </>
        }
      >
        <Field label="Video or stream link" error={err}>
          {(id, desc) => (
            <Input id={id} aria-describedby={desc} aria-invalid={!!err} autoFocus value={url} placeholder="https://www.youtube.com/watch?v=..." onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitUrl()} />
          )}
        </Field>
      </Dialog>
    </Page>
  )
}
