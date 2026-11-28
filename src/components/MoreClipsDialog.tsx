import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Slider } from '@/components/ui/Controls'
import { Dialog } from '@/components/ui/Dialog'
import { useLibrary } from '@/stores/library'
import type { Project } from '@/types'

export function MoreClipsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const moreClips = useLibrary((s) => s.moreClips)
  const [count, setCount] = useState(3)
  const [range, setRange] = useState([20, 60])
  const find = () => {
    void moreClips(project.id, count, range[0], range[1])
    onClose()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="More clips"
      description="New moments from the saved video. The clips you have stay as they are."
      width={440}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={find}>Find clips</Button></>}
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 flex justify-between text-label"><span>Number of clips</span><span className="font-mono tabular-nums">{count}</span></p>
          <Slider label="Number of clips" min={1} max={20} value={[count]} onChange={([v]) => setCount(v)} />
        </div>
        <div>
          <p className="mb-2 flex justify-between text-label"><span>Clip length</span><span className="font-mono tabular-nums">{range[0]}s to {range[1]}s</span></p>
          <Slider label="Clip length range" min={10} max={180} step={5} value={range} onChange={setRange} />
        </div>
      </div>
    </Dialog>
  )
}
