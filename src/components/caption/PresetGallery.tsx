import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input } from '@/components/ui/Input'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'
import { styleEquals, useCaptions } from '@/stores/captions'
import { toast } from '@/stores/ui'
import { BUILT_IN_PRESETS } from '@/theme/captionPresets'
import { DEMO_SEGMENTS, MiniCaption } from './CaptionPreview'
import type { CaptionPreset } from '@/types'

function Card({ preset, selected, modified, onPick, onDelete }: { preset: CaptionPreset; selected: boolean; modified: boolean; onPick: () => void; onDelete?: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className={cn(
        'group relative rounded-lg border bg-s2 p-2 transition-[border-color,background-color] duration-150',
        selected ? 'border-accent bg-s3' : 'border-line hover:border-line2',
      )}
    >
      <button type="button" onClick={onPick} aria-pressed={selected} aria-label={`Apply preset ${preset.name}`} className="no-drag block w-full text-left">
        <div className="h-[168px] overflow-hidden rounded-md">
          <MiniCaption segments={DEMO_SEGMENTS} style={preset.style} aspect="4:5" animate={hover} hue={222} />
        </div>
        <div className="mt-2 px-0.5">
          <p className="flex items-center gap-1.5 text-body font-medium">
            {preset.name}
            {selected && modified ? <span className="text-meta font-normal text-warn">Modified</span> : null}
          </p>
          <p className="line-clamp-2 text-meta text-t3">{preset.blurb}</p>
        </div>
      </button>
      {onDelete ? (
        <Tip label="Delete preset" side="top">
          <Button variant="ghost" size="icon-sm" aria-label={`Delete preset ${preset.name}`} onClick={onDelete} className="absolute right-3 top-3 bg-black/55 opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
            <Trash2 size={14} />
          </Button>
        </Tip>
      ) : null}
    </div>
  )
}

export function PresetGallery() {
  const { style, presetId, customPresets, applyPreset, saveCustomPreset, deleteCustomPreset } = useCaptions()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const all = [...BUILT_IN_PRESETS, ...customPresets]

  const save = () => {
    const n = name.trim()
    if (!n) return setErr('Give the preset a name.')
    if (all.some((p) => p.name.toLowerCase() === n.toLowerCase())) return setErr('A preset with this name exists.')
    saveCustomPreset(n)
    toast({ kind: 'success', title: 'Preset saved', body: `${n} is now in your preset list.` })
    setSaving(false)
    setName('')
    setErr(null)
  }

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3">
        {all.map((p) => (
          <Card
            key={p.id}
            preset={p}
            selected={presetId === p.id}
            modified={presetId === p.id && !styleEquals(style, p.style)}
            onPick={() => applyPreset(p.id)}
            onDelete={p.builtIn ? undefined : () => deleteCustomPreset(p.id)}
          />
        ))}
        <button
          type="button"
          onClick={() => setSaving(true)}
          className="no-drag flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line2 text-t2 transition-colors duration-150 hover:border-accent/60 hover:text-t1"
        >
          <Plus size={20} />
          <span className="text-body">Save current style</span>
        </button>
      </div>

      <Dialog
        open={saving}
        onOpenChange={(o) => {
          setSaving(o)
          if (!o) setErr(null)
        }}
        title="Save as preset"
        description="Stores the current style, including edits, so you can reuse it."
        width={420}
        footer={
          <>
            <Button onClick={() => setSaving(false)}>Cancel</Button>
            <Button variant="primary" onClick={save}>Save preset</Button>
          </>
        }
      >
        <Field label="Preset name" error={err}>
          {(id, desc) => (
            <Input
              id={id}
              aria-describedby={desc}
              aria-invalid={!!err}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder="Stream highlights"
            />
          )}
        </Field>
      </Dialog>
    </div>
  )
}
