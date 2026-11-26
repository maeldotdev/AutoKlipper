import { Bell, ChevronRight, Cpu, Palette, Search, SlidersHorizontal } from 'lucide-react'
import { StopJob } from '@/components/StopJob'
import { Link, useLocation } from 'react-router-dom'
import { describeRoute } from '@/app/routes'
import { Badge, Progress } from '@/components/ui/Display'
import { Button } from '@/components/ui/Button'
import { Menu, Popover } from '@/components/ui/Overlays'
import { Tip } from '@/components/ui/Tooltip'
import { useLibrary } from '@/stores/library'
import { useSettings, type ThemeId } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { fmtRelative } from '@/lib/utils'
import { IS_MOCK_BACKEND } from '@/services'
import { useAi, useAiReady } from '@/stores/ai'

function Processing() {
  const jobs = useLibrary((s) => s.jobs).filter((j) => j.status === 'running' || j.status === 'queued')
  const running = jobs.filter((j) => j.status === 'running').length
  return (
    <Popover
      width={340}
      trigger={
        <Button variant="secondary" size="md" aria-label={`Processing: ${running} running`}>
          <Cpu size={15} className={jobs.length ? 'text-accent' : 'text-t3'} />
          <span>{jobs.length ? `${running} running` : 'Idle'}</span>
        </Button>
      }
    >
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-body font-semibold">Processing</p>
          <Badge tone="neutral">Exports are real</Badge>
        </div>
        {jobs.length === 0 ? (
          <p className="py-4 text-center text-label text-t2">No jobs running. Start one from Auto Clipper.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {jobs.map((j) => (
              <li key={j.id}>
                <div className="mb-1 flex justify-between gap-3 text-label">
                  <span className="truncate">{j.title}</span>
                  <span className="font-mono text-t2">{j.status === 'queued' ? 'Waiting' : `${Math.round(j.progress)}%`}</span>
                </div>
                <Progress value={j.progress} label={j.title} />
                <div className="mt-1 flex items-center justify-between gap-3">
                  <p className="truncate text-meta text-t3">{j.source}</p>
                  <StopJob jobId={j.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  )
}

function Notifications() {
  const notices = useUi((s) => s.notices)
  const markAllRead = useUi((s) => s.markAllRead)
  const clear = useUi((s) => s.clearNotices)
  const unread = notices.filter((n) => !n.read).length
  return (
    <Popover
      width={360}
      trigger={
        <Button variant="secondary" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={markAllRead} className="relative">
          <Bell size={16} />
          {unread ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-[var(--surface-3)]" aria-hidden /> : null}
        </Button>
      }
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <p className="text-body font-semibold">Notifications</p>
        <Button variant="ghost" size="sm" onClick={clear} disabled={!notices.length}>
          Clear all
        </Button>
      </div>
      <ul className="max-h-80 overflow-y-auto">
        {notices.length === 0 ? (
          <li className="px-4 py-8 text-center text-label text-t2">Nothing new. Finished jobs will show up here.</li>
        ) : (
          notices.map((n) => (
            <li key={n.id} className="border-b border-line px-3 py-2.5 last:border-0">
              <p className="text-body font-medium">{n.title}</p>
              <p className="text-label text-t2">{n.body}</p>
              <p className="mt-1 text-meta text-t3">{fmtRelative(n.at)}</p>
            </li>
          ))
        )}
      </ul>
    </Popover>
  )
}

export function Header() {
  const { pathname } = useLocation()
  const { title, crumbs } = describeRoute(pathname)
  const setPalette = useUi((s) => s.setPalette)
  const ai = useAiReady()
  // Environment works but the chosen model is missing: say that, not "not set up".
  const modelMissing = useAi((s) => !!s.status?.ready) && !ai
  const theme = useSettings((s) => s.theme)
  const density = useSettings((s) => s.density)
  const set = useSettings((s) => s.set)
  const themes: { id: ThemeId; label: string }[] = [
    { id: 'midnight', label: 'Midnight' },
    { id: 'abyss', label: 'Abyss' },
    { id: 'slate', label: 'Slate' },
  ]
  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-line px-6" style={{ height: 'var(--header-h)' }}>
      <div className="min-w-0">
        {crumbs.length ? (
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-meta text-t3">
            {crumbs.map((c, i) => (
              <span key={c} className="flex items-center gap-1">
                {i === 0 ? (
                  <Link to="/clips" className="no-drag hover:text-t1">
                    {c}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-t2">{c}</span>
                )}
                {i < crumbs.length - 1 ? <ChevronRight size={11} /> : null}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="truncate text-title font-semibold leading-tight">{title}</h1>
      </div>

      <button
        onClick={() => setPalette(true)}
        className="no-drag field mx-auto flex w-full max-w-md items-center gap-2.5 text-left text-t3"
        aria-label="Search pages, projects and clips"
      >
        <Search size={15} />
        <span className="flex-1 text-body">Search projects, clips, pages</span>
        <kbd className="rounded border border-line bg-s1 px-1.5 py-px font-mono text-meta">Ctrl K</kbd>
      </button>

      <div className="flex items-center gap-2">
        <Tip label={IS_MOCK_BACKEND ? 'All data in this build is sample data' : ai ? 'Transcription, highlights and exports run on this computer.' : 'Exports are real. Without local AI, clips are evenly spaced and have no captions.'} side="bottom">
          <span>
            <Badge tone={ai ? 'success' : 'warning'}>{IS_MOCK_BACKEND ? 'Prototype data' : ai ? 'Local AI ready' : modelMissing ? 'Model not downloaded' : 'Local AI not set up'}</Badge>
          </span>
        </Tip>
        <Processing />
        <Notifications />
        <Menu
          trigger={
            <Button variant="secondary" size="icon" aria-label="Appearance preferences">
              <SlidersHorizontal size={16} />
            </Button>
          }
          items={[
            ...themes.map((t) => ({
              label: `Theme: ${t.label}${theme === t.id ? ' (current)' : ''}`,
              icon: <Palette size={14} />,
              onSelect: () => set({ theme: t.id }),
            })),
            {
              label: density === 'compact' ? 'Density: switch to comfortable' : 'Density: switch to compact',
              onSelect: () => set({ density: density === 'compact' ? 'comfortable' : 'compact' }),
              separatorBefore: true,
            },
          ]}
        />
      </div>
    </header>
  )
}
