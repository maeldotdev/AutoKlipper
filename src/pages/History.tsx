import { ChevronDown, ChevronRight, Clock3, RotateCcw, Trash2 } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Page } from '@/components/Common'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Controls'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { Badge, EmptyState, Progress, Skeleton } from '@/components/ui/Display'
import { fmtDuration, fmtRelative } from '@/lib/utils'
import { useLibrary } from '@/stores/library'
import { toast } from '@/stores/ui'
import type { JobStatus } from '@/types'

const TONE: Record<JobStatus, 'neutral' | 'accent' | 'success' | 'danger'> = { queued: 'neutral', running: 'accent', completed: 'success', failed: 'danger' }
const LABEL: Record<JobStatus, string> = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed' }

export function History() {
  const { jobs, status, retryJob, clearHistory, cancelJob } = useLibrary()
  const [filter, setFilter] = useState<'all' | JobStatus>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const shown = jobs.filter((j) => filter === 'all' || j.status === filter)
  const finished = jobs.filter((j) => j.status === 'completed' || j.status === 'failed').length

  return (
    <Page className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<'all' | JobStatus>
          label="Filter jobs"
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, { value: 'running', label: 'Running' }, { value: 'completed', label: 'Completed' }, { value: 'failed', label: 'Failed' }]}
        />
        <span className="text-label text-t3">{shown.length} job{shown.length === 1 ? '' : 's'}</span>
        <Button className="ml-auto" disabled={finished === 0} onClick={() => setConfirm(true)}><Trash2 size={15} />Clear finished</Button>
      </div>

      <section className="panel overflow-hidden">
        {status !== 'ready' ? (
          <div className="flex flex-col gap-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div>
        ) : shown.length === 0 ? (
          <EmptyState icon={Clock3} title="No jobs here" body={filter === 'all' ? 'Every download, transcription and render is logged here.' : 'No jobs with this status.'} />
        ) : (
          <table className="w-full text-left text-body">
            <thead className="border-b border-line text-label text-t3">
              <tr><th className="w-8 py-2.5 pl-3" /><th className="px-3 font-medium">Job</th><th className="px-3 font-medium">Source</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Started</th><th className="px-3 font-medium">Took</th><th className="w-28 px-3" /></tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <Fragment key={j.id}>
                  <tr className="border-b border-line last:border-0 hover:bg-s2/50">
                    <td className="pl-3">
                      {j.error ? (
                        <button aria-label={open === j.id ? 'Hide details' : 'Show details'} aria-expanded={open === j.id} onClick={() => setOpen(open === j.id ? null : j.id)} className="no-drag rounded p-1 text-t3 hover:text-t1">
                          {open === j.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-3 py-3"><p className="font-medium">{j.title}</p>{j.simulated ? <p className="text-meta text-t3">Simulated</p> : null}{!j.simulated && j.status === 'queued' ? <p className="text-meta text-t3">Waiting for a free slot</p> : null}</td>
                    <td className="max-w-[260px] truncate px-3 text-t2">{j.source}</td>
                    <td className="w-44 px-3">
                      {j.status === 'running' ? <div className="flex items-center gap-2"><Progress value={j.progress} className="flex-1" label={j.title} /><span className="font-mono text-label">{Math.round(j.progress)}%</span></div> : <Badge tone={TONE[j.status]}>{LABEL[j.status]}</Badge>}
                    </td>
                    <td className="px-3 text-t2">{fmtRelative(j.startedAt)}</td>
                    <td className="px-3 font-mono text-label">{j.status === 'running' ? '' : fmtDuration(j.durationSec)}</td>
                    <td className="px-3 text-right">
                      {!j.simulated && (j.status === 'running' || j.status === 'queued') ? <Button size="sm" onClick={() => cancelJob(j.id)}>Cancel</Button> : null}
                      {j.status === 'failed' && j.simulated ? <Button size="sm" onClick={() => { retryJob(j.id); toast({ kind: 'info', title: 'Retrying (simulated)', body: j.title }) }}><RotateCcw size={13} />Retry</Button> : null}
                    </td>
                  </tr>
                  {open === j.id && j.error ? (
                    <tr className="border-b border-line bg-bad/[0.05]"><td />
                      <td colSpan={6} className="px-3 py-3 text-body text-t2"><span className="font-medium text-bad">What happened: </span>{j.error}</td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Clear finished jobs?"
        description={`${finished} completed and failed jobs are removed from the log. Running jobs stay. This cannot be undone.`}
        confirmLabel="Clear finished"
        onConfirm={() => { clearHistory(); setConfirm(false); toast({ kind: 'success', title: 'History cleared' }) }}
      />
    </Page>
  )
}
