import { Check, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { Logo } from '@/components/Logo'
import { AiPanel } from '@/components/settings/AiPanel'
import { useToolCheck, type Tool } from '@/components/SetupCheck'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Controls'
import { Badge } from '@/components/ui/Display'
import { Input } from '@/components/ui/Input'
import { pickFolder } from '@/lib/native'
import { cn } from '@/lib/utils'
import { api } from '@/services'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { LANGUAGES } from '@/theme/models'

const STEPS = [
  { title: 'Free tools', intro: 'AutoKlipper works with three free programs. Open PowerShell, paste each command that is still needed, then check again. If a tool is installed but still not found, restart AutoKlipper.' },
  { title: 'Local AI and captions', intro: 'Captions are made on this PC and added to clips automatically. You can turn them off for any clip.' },
  { title: 'Folders', intro: 'Choose where videos and models are kept. Pick a drive with free space.' },
]

function ToolRow({ tool, onChange }: { tool: Tool; onChange: () => void }) {
  const s = useSettings()
  const choose = tool.setting
    ? () =>
        void api.system
          .chooseTool(tool.setting === 'ffmpegPath' ? 'ffmpeg' : 'ytdlp')
          .then((p) => {
            if (!p || !tool.setting) return
            s.set({ [tool.setting]: p })
            onChange()
          })
          .catch((e) => toast({ kind: 'error', title: 'That file was not used', body: String(e) }))
    : null
  return (
    <li className="border-b border-line py-3.5 last:border-0">
      <div className="flex items-center gap-3">
        <span className="font-medium">{tool.name}</span>
        <span className="text-label text-t2">{tool.why}</span>
        <span className="ml-auto">{tool.found ? <Badge tone="success"><Check size={11} />Found</Badge> : <Badge tone="warning">Not found</Badge>}</span>
      </div>
      {tool.found ? null : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="select-all rounded-md border border-line bg-s2 px-2 py-1 font-mono text-label">{tool.command}</code>
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(tool.command)}>Copy</Button>
          {choose ? <Button size="sm" variant="ghost" onClick={choose}>I already have it, choose the file</Button> : null}
        </div>
      )}
    </li>
  )
}

/** Fills the window instead of the app until setup is finished or skipped. */
export function SetupScreen() {
  const s = useSettings()
  const [step, setStep] = useState(0)
  const { tools, busy, check } = useToolCheck()
  const done = () => s.set({ setupDone: true })
  const folder = (key: 'exportFolder' | 'modelFolder' | 'dataFolder', title: string) => () => void pickFolder(title).then((p) => { if (p) s.set({ [key]: p }) })
  const last = step === STEPS.length - 1

  return (
    <main aria-label="Set up AutoKlipper" className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
      <aside className="flex flex-col border-r border-line bg-chrome px-6 py-8">
        <Logo size={36} />
        <h1 className="mt-4 text-title font-semibold">Set up AutoKlipper</h1>
        <p className="mt-1 text-body text-t2">Everything is free and can be changed later in Settings.</p>
        <ol className="mt-8 flex flex-col gap-1">
          {STEPS.map((x, i) => (
            <li key={x.title}>
              <button
                type="button"
                aria-current={i === step ? 'step' : undefined}
                onClick={() => setStep(i)}
                className={cn('no-drag flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-body transition-colors duration-150', i === step ? 'bg-s3 text-t1' : 'text-t2 hover:bg-s2 hover:text-t1')}
              >
                <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border text-meta', i < step ? 'border-accent bg-accent text-accent-fg' : 'border-line2')}>{i < step ? <Check size={11} /> : i + 1}</span>
                {x.title}
              </button>
            </li>
          ))}
        </ol>
        <Button variant="ghost" className="mt-auto self-start" onClick={done}>Skip for now</Button>
      </aside>

      <div className="flex min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-8">
            <h2 className="text-title font-semibold">{STEPS[step].title}</h2>
            <p className="mt-1 text-body text-t2">{STEPS[step].intro}</p>
            {step === 0 ? (
              <>
                {tools.length ? null : <p role="status" className="mt-4 text-body text-t2">Checking this PC</p>}
                <ul className="mt-3">{tools.map((t) => <ToolRow key={t.name} tool={t} onChange={() => void check()} />)}</ul>
                <Button size="sm" className="mt-3" loading={busy} onClick={() => void check()}>Check again</Button>
              </>
            ) : null}
            {step === 1 ? (
              <>
                <div className="flex items-center justify-between gap-6 border-b border-line py-4">
                  <p className="text-body font-medium">Spoken language</p>
                  <div className="w-44"><Select aria-label="Spoken language" value={s.language} onChange={(v) => s.set({ language: v })} options={LANGUAGES} /></div>
                </div>
                <AiPanel />
              </>
            ) : null}
            {step === 2 ? (
              <div className="mt-5 flex flex-col gap-5">
                {([
                  ['exportFolder', 'Export folder', 'Where finished clips are saved.'],
                  ['dataFolder', 'Large files folder', 'Downloads and temporary files. Takes effect after a restart.'],
                  ['modelFolder', 'AI model folder', 'Where caption models are stored.'],
                ] as const).map(([key, label, hint]) => (
                  <div key={key}>
                    <p className="text-body font-medium">{label}</p>
                    <p className="text-label text-t3">{hint}</p>
                    <div className="mt-1.5 flex gap-2">
                      <Input aria-label={label} readOnly value={s[key] || 'App data folder (default)'} className="flex-1 font-mono text-label" />
                      <Button onClick={folder(key, label)}><FolderOpen size={15} />Browse</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 border-t border-line py-4">
          {/* Lined up with the content column above. */}
          <div className="mx-auto flex max-w-2xl justify-end gap-2 px-8">
            {step > 0 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : null}
            <Button variant="primary" onClick={() => (last ? done() : setStep(step + 1))}>{last ? 'Open AutoKlipper' : 'Next'}</Button>
          </div>
        </div>
      </div>
    </main>
  )
}
