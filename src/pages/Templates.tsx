import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Page } from '@/components/Common'
import { DEMO_SEGMENTS, MiniCaption } from '@/components/caption/CaptionPreview'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog'
import { Badge } from '@/components/ui/Display'
import { Field, Input } from '@/components/ui/Input'
import { TabPanel, Tabs } from '@/components/ui/Overlays'
import { useCaptions } from '@/stores/captions'
import { toast } from '@/stores/ui'
import { BASE_STYLE, BUILT_IN_TEMPLATES } from '@/theme/captionPresets'
import type { Template, TemplateKind } from '@/types'

const KINDS: { value: TemplateKind; label: string; blurb: string }[] = [
  { value: 'caption', label: 'Caption templates', blurb: 'A complete look: type, colour, position and motion.' },
  { value: 'animation', label: 'Animation presets', blurb: 'Changes only how words appear. Your style stays.' },
  { value: 'typography', label: 'Typography', blurb: 'Changes font, weight and spacing only.' },
  { value: 'highlight', label: 'Highlight styles', blurb: 'Changes how spoken or key words stand out.' },
]

function Card({ t, onApply, onDelete }: { t: Template; onApply: (open: boolean) => void; onDelete?: () => void }) {
  const style = useCaptions((s) => s.style)
  const [hover, setHover] = useState(false)
  const merged = useMemo(() => ({ ...(t.kind === 'caption' ? BASE_STYLE : style), ...t.patch }), [t, style])
  return (
    <li
      className="panel group overflow-hidden transition-[border-color] duration-150 hover:border-line2"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="h-[190px] bg-app/50 p-2.5">
        <MiniCaption segments={DEMO_SEGMENTS} style={merged} aspect="4:5" animate={hover} />
      </div>
      <div className="p-3.5">
        <div className="flex items-center gap-2">
          <p className="truncate text-body font-semibold">{t.name}</p>
          {!t.builtIn ? <Badge tone="accent">Yours</Badge> : null}
        </div>
        <p className="mt-0.5 line-clamp-2 min-h-8 text-label text-t2">{t.blurb}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="primary" onClick={() => onApply(false)}>Apply</Button>
          <Button size="sm" onClick={() => onApply(true)}>Apply and open</Button>
          {onDelete ? <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={`Delete template ${t.name}`} onClick={onDelete}><Trash2 size={14} /></Button> : null}
        </div>
      </div>
    </li>
  )
}

export function Templates() {
  const nav = useNavigate()
  const { customTemplates, applyPatch, saveCustomTemplate, deleteCustomTemplate } = useCaptions()
  const [tab, setTab] = useState<TemplateKind>('caption')
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState('')
  const [blurb, setBlurb] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [del, setDel] = useState<Template | null>(null)

  const list = (k: TemplateKind) => [...BUILT_IN_TEMPLATES.filter((t) => t.kind === k), ...(k === 'caption' ? customTemplates : [])]

  const save = () => {
    const n = name.trim()
    if (!n) return setErr('Give the template a name.')
    if ([...BUILT_IN_TEMPLATES, ...customTemplates].some((t) => t.name.toLowerCase() === n.toLowerCase())) return setErr('A template with this name exists.')
    saveCustomTemplate(n, blurb.trim() || 'Saved from Caption Studio.')
    toast({ kind: 'success', title: 'Template saved', body: `${n} is under Caption templates.` })
    setSaveOpen(false)
    setName('')
    setBlurb('')
    setErr(null)
  }

  return (
    <Page className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-body text-t2">{KINDS.find((k) => k.value === tab)?.blurb} Hover a card to see it move.</p>
        <Button onClick={() => setSaveOpen(true)}><Plus size={15} />Save current style as template</Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TemplateKind)} tabs={KINDS.map((k) => ({ value: k.value, label: k.label }))}>
        {KINDS.map((k) => (
          <TabPanel key={k.value} value={k.value} className="pt-4">
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
              {list(k.value).map((t) => (
                <Card
                  key={t.id}
                  t={t}
                  onApply={(open) => {
                    applyPatch(t.patch)
                    toast({ kind: 'success', title: `${t.name} applied`, body: 'Caption Studio and the Clip Editor now use it.' })
                    if (open) nav('/caption-studio')
                  }}
                  onDelete={t.builtIn ? undefined : () => setDel(t)}
                />
              ))}
            </ul>
          </TabPanel>
        ))}
      </Tabs>

      <Dialog
        open={saveOpen}
        onOpenChange={(o) => { setSaveOpen(o); if (!o) setErr(null) }}
        title="Save current style as a template"
        description="Uses the style you have in Caption Studio right now."
        width={440}
        footer={<><Button onClick={() => setSaveOpen(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save template</Button></>}
      >
        <div className="flex flex-col gap-4">
          <Field label="Template name" error={err}>{(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!err} autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(null) }} placeholder="Weekly highlights" />}</Field>
          <Field label="Description (optional)">{(id) => <Input id={id} value={blurb} onChange={(e) => setBlurb(e.target.value)} placeholder="Yellow keywords, lower third" />}</Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={`Delete “${del?.name ?? ''}”?`}
        description="The template is removed. Clips already styled with it keep their look."
        confirmLabel="Delete template"
        onConfirm={() => { if (del) deleteCustomTemplate(del.id); setDel(null) }}
      />
    </Page>
  )
}
