import type { ReactNode } from 'react'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { Segmented, Select, Slider, Switch } from '@/components/ui/Controls'
import { ANIMATIONS, FONT_STACKS, HIGHLIGHTS } from '@/theme/captionPresets'
import { useCaptions } from '@/stores/captions'
import type { CaptionFont, CaptionStyle } from '@/types'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3.5 last:border-0">
      <h3 className="mb-2 text-label font-semibold text-t1">{title}</h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}
function Row({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] items-center gap-3">
      <span className="text-label text-t2">
        {label}
        {value ? <span className="ml-1.5 font-mono text-meta text-t3">{value}</span> : null}
      </span>
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  )
}
function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="no-drag flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-9 cursor-pointer rounded-md border border-line bg-s2 p-0.5"
      />
      <span className="font-mono text-meta text-t2">{value}</span>
    </label>
  )
}

const WEIGHTS = [400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) }))

export function StylePanel() {
  const style = useCaptions((s) => s.style)
  const setStyle = useCaptions((s) => s.setStyle)
  const up = (p: Partial<CaptionStyle>) => setStyle(p)
  const num = (k: keyof CaptionStyle, min: number, max: number, step = 1) => (
    <Slider label={String(k)} min={min} max={max} step={step} value={[style[k] as number]} onChange={([v]) => up({ [k]: v })} />
  )

  return (
    <div>
      <Group title="Typography">
        <Row label="Font family">
          <Select<CaptionFont>
            aria-label="Font family"
            value={style.font}
            onChange={(font) => up({ font })}
            options={(Object.keys(FONT_STACKS) as CaptionFont[]).map((k) => ({ value: k, label: FONT_STACKS[k].label }))}
          />
        </Row>
        <Row label="Font size" value={String(style.size)}>{num('size', 20, 90)}</Row>
        <Row label="Font weight">
          <Select aria-label="Font weight" value={String(style.weight)} onChange={(v) => up({ weight: Number(v) })} options={WEIGHTS} />
        </Row>
        <Row label="Capitals">
          <Switch label="Capitals" checked={style.uppercase} onChange={(uppercase) => up({ uppercase })} />
        </Row>
        <Row label="Letter spacing" value={String(style.letterSpacing)}>{num('letterSpacing', -5, 20)}</Row>
        <Row label="Line spacing" value={style.lineHeight.toFixed(2)}>{num('lineHeight', 0.9, 1.6, 0.05)}</Row>
        <Row label="Alignment">
          <Segmented
            label="Text alignment"
            value={style.align}
            onChange={(align) => up({ align })}
            options={[
              { value: 'left', label: <AlignLeft size={15} />, title: 'Left' },
              { value: 'center', label: <AlignCenter size={15} />, title: 'Center' },
              { value: 'right', label: <AlignRight size={15} />, title: 'Right' },
            ]}
          />
        </Row>
      </Group>

      <Group title="Colour and outline">
        <Row label="Text colour"><Color label="Text colour" value={style.color} onChange={(color) => up({ color })} /></Row>
        <Row label="Highlight"><Color label="Highlight colour" value={style.highlightColor} onChange={(highlightColor) => up({ highlightColor })} /></Row>
        <Row label="Outline" value={String(style.outlineWidth)}>{num('outlineWidth', 0, 12)}</Row>
        <Row label="Outline colour"><Color label="Outline colour" value={style.outlineColor} onChange={(outlineColor) => up({ outlineColor })} /></Row>
        <Row label="Shadow" value={String(style.shadow)}>{num('shadow', 0, 10)}</Row>
      </Group>

      <Group title="Background box">
        <Row label="Show box"><Switch label="Show background box" checked={style.bgEnabled} onChange={(bgEnabled) => up({ bgEnabled })} /></Row>
        <Row label="Box colour"><Color label="Box colour" value={style.bgColor} onChange={(bgColor) => up({ bgColor })} /></Row>
        <Row label="Opacity" value={`${Math.round(style.bgOpacity * 100)}%`}>{num('bgOpacity', 0, 1, 0.05)}</Row>
        <Row label="Corner radius" value={String(style.radius)}>{num('radius', 0, 30)}</Row>
      </Group>

      <Group title="Layout">
        <Row label="Vertical position" value={`${style.posY}%`}>{num('posY', 10, 95)}</Row>
        <Row label="Words per line" value={String(style.maxWords)}>{num('maxWords', 1, 8)}</Row>
        <Row label="Max lines" value={String(style.maxLines)}>{num('maxLines', 1, 3)}</Row>
      </Group>

      <Group title="Animation">
        <Row label="Style">
          <Select aria-label="Animation style" value={style.animation} onChange={(animation) => up({ animation })} options={ANIMATIONS.map((a) => ({ value: a.id, label: a.label }))} />
        </Row>
        <Row label="Speed" value={`${style.animSpeed.toFixed(1)}x`}>{num('animSpeed', 0.5, 2, 0.1)}</Row>
        <Row label="Highlight">
          <Select aria-label="Highlight behavior" value={style.highlight} onChange={(highlight) => up({ highlight })} options={HIGHLIGHTS.map((h) => ({ value: h.id, label: h.label }))} />
        </Row>
      </Group>
    </div>
  )
}
