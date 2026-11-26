import { FolderKanban, LayoutGrid, List, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Page, PlatformMark, Thumb } from '@/components/Common'
import { Button } from '@/components/ui/Button'
import { Segmented, Select } from '@/components/ui/Controls'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { Badge, EmptyState, Progress, Skeleton } from '@/components/ui/Display'
import { Input } from '@/components/ui/Input'
import { PLATFORMS, PROJECT_STATUS } from '@/lib/labels'
import { fmtBytes, fmtDuration, fmtRelative, shortSource } from '@/lib/utils'
import { useLibrary } from '@/stores/library'
import { toast } from '@/stores/ui'
import type { Project, ProjectStatus } from '@/types'

/** How far the work on a processing project has got. A link is downloaded first, then transcribed. */
function ProjectProgress({ id, className }: { id: string; className?: string }) {
  const job = useLibrary((s) => s.jobs.find((j) => j.id === s.projectJob[id]))
  if (!job) return null
  const pct = Math.round(job.progress)
  const step = job.status === 'queued' ? 'Waiting' : job.kind === 'download' ? 'Downloading' : 'Finding clips'
  return (
    <div className={className}>
      <div className="mb-1 flex justify-between text-meta text-t3">
        <span>{step}</span>
        <span className="font-mono tabular-nums">{pct}%</span>
      </div>
      <Progress value={pct} label={`${step}, ${pct}%`} />
    </div>
  )
}

export function Projects() {
  const nav = useNavigate()
  const { projects, status, deleteProject } = useLibrary()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | ProjectStatus>('all')
  const [sort, setSort] = useState<'new' | 'old' | 'clips' | 'name'>('new')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [del, setDel] = useState<Project | null>(null)

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return projects
      .filter((p) => (filter === 'all' || p.status === filter) && (!s || p.title.toLowerCase().includes(s) || p.sourceLabel.toLowerCase().includes(s)))
      .sort((a, b) =>
        sort === 'new' ? +new Date(b.createdAt) - +new Date(a.createdAt)
        : sort === 'old' ? +new Date(a.createdAt) - +new Date(b.createdAt)
        : sort === 'clips' ? b.clipCount - a.clipCount
        : a.title.localeCompare(b.title),
      )
  }, [projects, q, filter, sort])

  const open = (p: Project) => (p.status === 'ready' ? nav(`/clips?project=${p.id}`) : toast({ kind: 'warning', title: `${p.title} has no clips`, body: p.status === 'failed' ? 'This project failed. Retry it from History.' : 'It is not finished yet.' }))

  return (
    <Page className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-t3" />
          <Input aria-label="Search projects" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Segmented<'all' | ProjectStatus>
          label="Filter by status"
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, { value: 'ready', label: 'Ready' }, { value: 'processing', label: 'Processing' }, { value: 'failed', label: 'Failed' }, { value: 'draft', label: 'Draft' }]}
        />
        <div className="ml-auto flex items-center gap-3">
          <div className="w-44">
            <Select aria-label="Sort" value={sort} onChange={setSort} options={[{ value: 'new', label: 'Newest first' }, { value: 'old', label: 'Oldest first' }, { value: 'clips', label: 'Most clips' }, { value: 'name', label: 'Name A to Z' }]} />
          </div>
          <Segmented<'grid' | 'list'> label="View" value={view} onChange={setView} options={[{ value: 'grid', label: <LayoutGrid size={15} />, title: 'Grid' }, { value: 'list', label: <List size={15} />, title: 'List' }]} />
        </div>
      </div>

      {status !== 'ready' ? (
        <div className="grid grid-cols-4 gap-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : shown.length === 0 ? (
        <section className="panel">
          {projects.length === 0 ? (
            <EmptyState icon={FolderKanban} title="No projects yet" body="Projects are created when you generate clips from a video or a stream." action={<Button variant="primary" onClick={() => nav('/auto-clipper')}>Open Auto Clipper</Button>} />
          ) : (
            <EmptyState icon={Search} title="No matching projects" body="Try another search or clear the status filter." action={<Button onClick={() => { setQ(''); setFilter('all') }}>Clear filters</Button>} />
          )}
        </section>
      ) : view === 'grid' ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
          {shown.map((p) => (
            <li key={p.id} className="panel group overflow-hidden transition-[border-color] duration-150 hover:border-line2">
              <button className="no-drag block w-full text-left" onClick={() => open(p)} aria-label={`Open ${p.title}`}>
                <Thumb hue={p.hue} duration={p.duration} />
                <div className="p-3.5 pb-2">
                  <p className="truncate text-section font-semibold">{p.title}</p>
                  <p className="mt-1 flex items-center gap-2 text-label text-t3"><PlatformMark id={p.platform} size={18} /><span className="truncate" title={p.sourceLabel}>{shortSource(p.sourceLabel)}</span></p>
                </div>
              </button>
              {p.status === 'processing' ? <ProjectProgress id={p.id} className="px-3.5 pb-1.5" /> : null}
              <div className="flex items-center gap-2 px-3.5 pb-3.5 pt-1">
                <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>
                <span className="text-label text-t2">{p.clipCount} clips</span>
                <span className="ml-auto text-meta text-t3">{fmtRelative(p.createdAt)}</span>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${p.title}`} onClick={() => setDel(p)}><Trash2 size={14} /></Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <section className="panel overflow-hidden">
          <table className="w-full text-left text-body">
            <thead className="border-b border-line text-label text-t3">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project</th><th className="px-3 font-medium">Source</th><th className="px-3 font-medium">Length</th><th className="px-3 font-medium">Clips</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Created</th><th className="w-24 px-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-s2/60">
                  <td className="px-4 py-2.5"><button className="no-drag flex items-center gap-3 text-left" onClick={() => open(p)}><Thumb hue={p.hue} className="w-14 rounded" /><span className="font-medium">{p.title}</span></button></td>
                  <td className="px-3 text-t2">{PLATFORMS[p.platform].name}{p.sizeBytes ? `, ${fmtBytes(p.sizeBytes)}` : ''}</td>
                  <td className="px-3 font-mono text-label">{fmtDuration(p.duration)}</td>
                  <td className="px-3">{p.clipCount}</td>
                  <td className="px-3"><Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>{p.status === 'processing' ? <ProjectProgress id={p.id} className="mt-1.5 w-36" /> : null}</td>
                  <td className="px-3 text-t2">{fmtRelative(p.createdAt)}</td>
                  <td className="px-3"><div className="flex justify-end gap-1"><Button size="sm" onClick={() => open(p)}>Open</Button><Button variant="ghost" size="icon-sm" aria-label={`Delete ${p.title}`} onClick={() => setDel(p)}><Trash2 size={14} /></Button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={`Delete “${del?.title ?? ''}”?`}
        description={`This removes the project and its ${del?.clipCount ?? 0} clips from AutoKlipper. ${del?.sourcePath && /[\\/]downloads[\\/]/i.test(del.sourcePath) ? 'The video AutoKlipper downloaded for it is deleted too. ' : 'Your source file is not touched. '}Exported clips stay on disk. This cannot be undone.`}
        confirmLabel="Delete project"
        onConfirm={() => {
          if (del) {
            deleteProject(del.id)
            toast({ kind: 'success', title: 'Project deleted', body: del.title })
          }
          setDel(null)
        }}
      />
    </Page>
  )
}
