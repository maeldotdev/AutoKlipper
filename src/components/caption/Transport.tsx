import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { Select, Slider } from '@/components/ui/Controls'
import { Tip } from '@/components/ui/Tooltip'
import { fmtClock } from '@/lib/utils'
import { usePlayhead } from '@/stores/playhead'

/** Space toggles playback unless the user is typing. */
export function useSpaceToggle() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.code !== 'Space' || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName) || el.isContentEditable || el.getAttribute('role') === 'slider') return
      e.preventDefault()
      usePlayhead.getState().toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function Clock() {
  const t = usePlayhead((s) => s.time)
  const d = usePlayhead((s) => s.duration)
  return (
    <span className="min-w-[88px] font-mono text-label tabular-nums text-t2">
      <span className="text-t1">{fmtClock(t)}</span> / {fmtClock(d)}
    </span>
  )
}

function Scrub() {
  const t = usePlayhead((s) => s.time)
  const d = usePlayhead((s) => s.duration)
  const seek = usePlayhead((s) => s.seek)
  return <Slider label="Seek" min={0} max={Math.max(1, d)} step={0.05} value={[Math.min(t, d)]} onChange={([v]) => seek(v)} />
}

export function Transport({ className }: { className?: string }) {
  const playing = usePlayhead((s) => s.playing)
  const toggle = usePlayhead((s) => s.toggle)
  const seek = usePlayhead((s) => s.seek)
  const rate = usePlayhead((s) => s.rate)
  const setRate = usePlayhead((s) => s.setRate)
  const step = (d: number) => seek(usePlayhead.getState().time + d)
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <Tip label="Back 5 seconds" side="top">
        <Button variant="ghost" size="icon-sm" aria-label="Back 5 seconds" onClick={() => step(-5)}>
          <SkipBack size={16} />
        </Button>
      </Tip>
      <Tip label={playing ? 'Pause' : 'Play'} side="top" kbd="Space">
        <Button variant="primary" size="icon" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} className="rounded-full">
          {playing ? <Pause size={16} /> : <Play size={16} className="translate-x-px" />}
        </Button>
      </Tip>
      <Tip label="Forward 5 seconds" side="top">
        <Button variant="ghost" size="icon-sm" aria-label="Forward 5 seconds" onClick={() => step(5)}>
          <SkipForward size={16} />
        </Button>
      </Tip>
      <Clock />
      <div className="min-w-24 flex-1">
        <Scrub />
      </div>
      <div className="w-[84px]">
        <Select
          aria-label="Playback speed"
          value={String(rate)}
          onChange={(v) => {
            const r = Number(v)
            setRate(r)
            const el = document.querySelector('video')
            if (el) el.playbackRate = r
          }}
          options={['0.5', '1', '1.5', '2'].map((v) => ({ value: v, label: `${v}x` }))}
        />
      </div>
    </div>
  )
}
