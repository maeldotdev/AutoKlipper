import { Check, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { AiPanel } from '@/components/settings/AiPanel'
import { useToolCheck, type Tool } from '@/components/SetupCheck'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Controls'
import { Dialog } from '@/components/ui/Dialog'
import { Badge } from '@/components/ui/Display'
import { Input } from '@/components/ui/Input'
import { pickExecutable, pickFolder } from '@/lib/native'
import { IS_MOCK_BACKEND, api } from '@/services'
import { useSettings } from '@/stores/settings'
import { LANGUAGES } from '@/theme/models'

const STEPS = ['Free tools', 'Local AI and captions', 'Folders']

function ToolRow({ tool, onChange }: { tool: Tool; onChange: () => void }) {
  const s = useSettings()
  const choose = tool.setting
    ? () =>
        void pickExecutable(`Choose ${tool.name}`).then(async (p) => {
          if (!p || !tool.setting) return
          // Save first: the backend reads the settings file when it looks for the tool.
          await api.system.patchSettings({ [tool.setting]: p })
          s.set({ [tool.setting]: p })
          onChange()
        })
    : null
  return (
    <li className="border-b border-line py-3 last:border-0">
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

/** Shown on the first start of the desktop app, and again from Settings when asked. */
export function SetupWizard() {
  const s = useSettings()
  const [step, setStep] = useState(0)
  const { tools, busy, check } = useToolCheck()
  if (IS_MOCK_BACKEND || s.setupDone) return null
  const done = () => {
    s.set({ setupDone: true })
    setStep(0)
  }
  const folder = (key: 'exportFolder' | 'modelFolder' | 'dataFolder', title: string) => () => void pickFolder(title).then((p) => { if (p) s.set({ [key]: p }) })
  const last = step === STEPS.length - 1

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && done()}
      width={760}
      title="Set up AutoKlipper"
      description={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}. Everything is free and can be changed later in Settings.`}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={done}>Skip for now</Button>
          {step > 0 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : null}
          <Button variant="primary" onClick={() => (last ? done() : setStep(step + 1))}>{last ? 'Finish' : 'Next'}</Button>
        </>
      }
    >
      {step === 0 ? (
        <>
          <p className="text-body text-t2">Open PowerShell, paste each command that is still needed, then check again. If a tool is installed but still not found, restart AutoKlipper.</p>
          {tools.length ? null : <p role="status" className="mt-3 text-body text-t2">Checking this PC</p>}
          <ul className="mt-2">{tools.map((t) => <ToolRow key={t.name} tool={t} onChange={() => void check()} />)}</ul>
          <Button size="sm" className="mt-3" loading={busy} onClick={() => void check()}>Check again</Button>
        </>
      ) : null}
      {step === 1 ? (
        <>
          <p className="text-body text-t2">Captions are made on this PC and added to clips automatically. You can turn them off for any clip.</p>
          <div className="flex items-center justify-between gap-6 border-b border-line py-4">
            <p className="text-body font-medium">Spoken language</p>
            <div className="w-44"><Select aria-label="Spoken language" value={s.language} onChange={(v) => s.set({ language: v })} options={LANGUAGES} /></div>
          </div>
          <AiPanel />
        </>
      ) : null}
      {step === 2 ? (
        <div className="flex flex-col gap-4">
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
    </Dialog>
  )
}
