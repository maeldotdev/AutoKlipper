import { Segmented, Slider, Switch } from '@/components/ui/Controls'
import { LOOKS, NO_FILTERS } from '@/lib/filters'
import type { Filters, Look } from '@/types'

const SWITCHES: { key: 'sharpen' | 'denoise' | 'voice'; label: string; hint: string }[] = [
  { key: 'sharpen', label: 'Sharpen', hint: 'Crisper edges for soft video.' },
  { key: 'denoise', label: 'Clean up noise', hint: 'Less grain in dark or low quality video.' },
  { key: 'voice', label: 'Clearer, louder voice', hint: 'Cuts rumble and hiss, then evens the volume.' },
]

export function FilterPanel({ value, onChange }: { value: Filters | null; onChange: (f: Filters) => void }) {
  const f = value ?? NO_FILTERS
  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <p className="mb-2 text-label font-medium text-t2">Look</p>
        <Segmented<Look> label="Look" value={f.look} onChange={(look) => onChange({ ...f, look })} options={LOOKS} className="!grid !h-auto w-full grid-cols-3" />
      </div>
      {f.look !== 'none' ? (
        <div>
          <div className="mb-2 flex justify-between text-label"><span className="font-medium text-t2">Strength</span><span className="font-mono">{Math.round(f.strength * 100)}%</span></div>
          <Slider label="Filter strength" min={10} max={100} step={5} value={[Math.round(f.strength * 100)]} onChange={([v]) => onChange({ ...f, strength: v / 100 })} />
        </div>
      ) : null}
      {SWITCHES.map((x) => (
        <div key={x.key} className="flex items-center justify-between gap-3">
          <div>
            <p className="text-body font-medium">{x.label}</p>
            <p className="text-meta text-t3">{x.hint}</p>
          </div>
          <Switch label={x.label} checked={f[x.key]} onChange={(on) => onChange({ ...f, [x.key]: on })} />
        </div>
      ))}
      <p className="text-meta text-t3">Applied when you export. The preview shows the look closely, not exactly. Sharpen, noise and voice are heard and seen in the exported file.</p>
    </div>
  )
}
