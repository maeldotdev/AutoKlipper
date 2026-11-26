import { Square } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useLibrary } from '@/stores/library'

/** Stops one running or waiting job. Shows nothing once it has ended, or for the browser preview's pretend jobs. */
export function StopJob({ jobId, className }: { jobId: string | undefined; className?: string }) {
  const job = useLibrary((s) => s.jobs.find((j) => j.id === jobId))
  const cancel = useLibrary((s) => s.cancelJob)
  if (!job || job.simulated || (job.status !== 'running' && job.status !== 'queued')) return null
  return (
    <Button
      size="sm"
      className={className}
      aria-label={`Stop: ${job.title}`}
      onClick={(e) => {
        // The button can sit on a card that opens when clicked.
        e.stopPropagation()
        e.preventDefault()
        cancel(job.id)
      }}
    >
      <Square size={11} />Stop
    </Button>
  )
}
