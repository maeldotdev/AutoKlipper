import { Button } from '@/components/ui/Button'
import { useUpdate } from '@/stores/update'

/** Appears under the header when a newer version exists. Nothing installs without a click. */
export function UpdateBanner() {
  const { available, dismissed, installing, install, dismiss } = useUpdate()
  if (!available || dismissed) return null
  return (
    <div role="status" className="mx-5 mt-3 flex shrink-0 items-center gap-3 rounded-lg border border-accent/40 bg-accent/[0.08] px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">Version {available.version} is available</p>
        <p className="truncate text-label text-t2" title={available.notes ?? undefined}>
          {installing ? 'Downloading. AutoKlipper will restart.' : (available.notes ?? 'Your projects and settings are kept.')}
        </p>
      </div>
      <Button variant="ghost" size="sm" disabled={installing} onClick={dismiss}>Later</Button>
      <Button variant="primary" size="sm" loading={installing} onClick={() => void install()}>Update</Button>
    </div>
  )
}
