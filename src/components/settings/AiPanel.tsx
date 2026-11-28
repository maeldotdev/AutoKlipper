import { Check, Download } from 'lucide-react'
import { StopJob } from '@/components/StopJob'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Select, Switch } from '@/components/ui/Controls'
import { Badge, Progress } from '@/components/ui/Display'
import { api } from '@/services'
import { useAi } from '@/stores/ai'
import { useLibrary } from '@/stores/library'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { WHISPER_MODELS } from '@/theme/models'

const fail = (title: string) => (e: unknown) => toast({ kind: 'error', title, body: String(e) })

/** Progress of the running setup or download job whose title starts with `prefix`. */
function useRunning(prefix: string) {
  return useLibrary((s) => s.jobs.find((j) => j.title.startsWith(prefix) && (j.status === 'running' || j.status === 'queued')))
}

function JobBar({ prefix }: { prefix: string }) {
  const job = useRunning(prefix)
  if (!job) return null
  return (
    <div className="mt-2 flex items-center gap-3">
      <Progress value={job.progress} label={job.title} className="flex-1" />
      <span className="w-10 font-mono text-meta">{Math.round(job.progress)}%</span>
      <StopJob jobId={job.id} />
    </div>
  )
}

/** Desktop app only: set up local AI, fetch models, speaker detection and optional Ollama. */
export function AiPanel() {
  const { status, loading, refresh } = useAi()
  const s = useSettings()
  const [ollama, setOllama] = useState<string[] | null | undefined>(undefined)
  const setupJob = useRunning('Set up local AI')
  const speakerJob = useRunning('Download speaker models')
  const faceJob = useRunning('Set up face tracking')

  const checkOllama = useCallback(() => {
    api.ai.ollamaModels().then(setOllama).catch(() => setOllama(null))
  }, [])
  useEffect(() => {
    void refresh()
    checkOllama()
  }, [refresh, checkOllama])

  const start = (run: () => Promise<string>, what: string) => () => void run().then(() => toast({ kind: 'info', title: `${what} started`, body: 'Follow progress here or in History.' })).catch(fail(`Could not start: ${what}`))

  return (
    <>
      <div className="border-b border-line py-4">
        <div className="flex items-start justify-between gap-6">
          <div className="max-w-lg">
            <p className="text-body font-medium">Local AI engine</p>
            <p className="mt-0.5 text-label text-t3">
              Faster-Whisper transcribes on this computer. Setting up downloads Python packages into the AutoKlipper folder and uses about 350 MB of disk space. Nothing is installed system-wide, and your videos never leave this PC.
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-label">
              {loading && !status ? <Badge>Checking</Badge> : status?.ready ? <Badge tone="success"><Check size={11} />Ready</Badge> : <Badge tone="warning">Not set up</Badge>}
              {status?.fasterWhisper ? <span className="font-mono text-meta text-t3">faster-whisper {status.fasterWhisper}</span> : null}
              {status ? <span className="text-meta text-t3">{status.gpus > 0 ? 'NVIDIA GPU available' : 'Runs on the CPU'}</span> : null}
              {status && !status.pythonFound ? <span className="text-meta text-bad">Python 3.11 to 3.13 is needed: winget install Python.Python.3.12</span> : null}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button onClick={() => void refresh()}>Check again</Button>
            {status?.ready ? null : (
              <Button variant="primary" disabled={!status?.pythonFound || !!setupJob} onClick={start(api.ai.setup, 'Setup')}>Set up local AI</Button>
            )}
          </div>
        </div>
        <JobBar prefix="Set up local AI" />
      </div>

      <div className="border-b border-line py-4">
        <p className="text-body font-medium">Transcription model</p>
        <p className="mb-3 mt-0.5 text-label text-t3">A model downloads once from Hugging Face, then works offline. Bigger models are more accurate and slower.</p>
        <div role="radiogroup" aria-label="Transcription model" className="grid gap-2">
          {WHISPER_MODELS.map((m) => {
            const installed = status?.models.includes(m.id)
            return (
              <div key={m.id} className={`rounded-lg border px-3.5 py-2.5 ${s.model === m.id ? 'border-accent bg-accent/[0.07]' : 'border-line'}`}>
                <div className="flex items-center gap-3 text-body">
                  <button role="radio" aria-checked={s.model === m.id} onClick={() => s.set({ model: m.id })} className="no-drag flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${s.model === m.id ? 'border-accent' : 'border-line2'}`}>{s.model === m.id ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}</span>
                    <span className="w-20 font-medium">{m.label}</span>
                    <span className="w-16 font-mono text-label text-t2">{m.download}</span>
                    <span className="truncate text-label text-t2">{m.memory}. {m.note}</span>
                  </button>
                  {installed ? <Badge tone="success">Installed</Badge> : (
                    <Button size="sm" disabled={!status?.ready} onClick={start(() => api.ai.downloadModel(m.id), `${m.label} download`)}><Download size={13} />Download</Button>
                  )}
                </div>
                <JobBar prefix={`Download Whisper model ${m.id}`} />
              </div>
            )
          })}
        </div>
      </div>

      <div className="border-b border-line py-4">
        <div className="flex items-center justify-between gap-6">
          <div className="max-w-lg">
            <p className="text-body font-medium">Speaker detection</p>
            <p className="mt-0.5 text-label text-t3">Tells voices apart. Two small models (about 45 MB) from the sherpa-onnx project. Labels are estimates.</p>
          </div>
          <div className="flex items-center gap-3">
            {status?.speakerModels ? <Badge tone="success">Installed</Badge> : (
              <Button size="sm" disabled={!status?.ready || !!speakerJob} onClick={start(api.ai.downloadSpeakers, 'Speaker model download')}><Download size={13} />Download</Button>
            )}
            <Switch label="Use speaker detection" checked={s.speakerDetection} onChange={(v) => s.set({ speakerDetection: v })} />
          </div>
        </div>
        <JobBar prefix="Download speaker models" />
      </div>

      <div className="border-b border-line py-4">
        <div className="flex items-center justify-between gap-6">
          <div className="max-w-lg">
            <p className="text-body font-medium">Face tracking</p>
            <p className="mt-0.5 text-label text-t3">Moves the vertical crop with the face. Adds OpenCV (about 45 MB) to the AI environment and a small face model.</p>
          </div>
          {status?.faceReady ? <Badge tone="success">Installed</Badge> : (
            <Button size="sm" disabled={!status?.ready || !!faceJob} onClick={start(api.ai.setupFace, 'Face tracking setup')}><Download size={13} />Set up</Button>
          )}
        </div>
        <JobBar prefix="Set up face tracking" />
      </div>

      <div className="border-b border-line py-4">
        <div className="flex items-center justify-between gap-6">
          <div className="max-w-lg">
            <p className="text-body font-medium">Second opinion from Ollama, optional</p>
            <p className="mt-0.5 text-label text-t3">A model you run yourself also scores each found moment and suggests a title. Only this computer is contacted. Highlight detection works without it.</p>
            <p className="mt-1.5 text-meta text-t3">
              {ollama === undefined ? 'Looking for Ollama' : ollama === null ? 'Ollama is not running on this computer.' : ollama.length === 0 ? 'Ollama is running but has no models.' : `Ollama is running with ${ollama.length} model${ollama.length === 1 ? '' : 's'}.`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {ollama?.length ? (
              <div className="w-44"><Select aria-label="Ollama model" value={s.ollamaModel || ollama[0]} onChange={(v) => s.set({ ollamaModel: v })} options={ollama.map((m) => ({ value: m, label: m }))} /></div>
            ) : <Button size="sm" onClick={checkOllama}>Check again</Button>}
            <Switch label="Use Ollama" checked={s.ollamaEnabled && !!ollama?.length} disabled={!ollama?.length} onChange={(v) => s.set({ ollamaEnabled: v, ollamaModel: s.ollamaModel || ollama?.[0] || '' })} />
          </div>
        </div>
        {ollama?.length ? null : (
          <div className="mt-3 text-label text-t2">
            <p>To add Ollama, run these in PowerShell, one after the other, then check again. The model is about 2 GB.</p>
            <p className="mt-1 select-all rounded-md border border-line bg-s2 px-3 py-2 font-mono">winget install Ollama.Ollama</p>
            <p className="mt-1 select-all rounded-md border border-line bg-s2 px-3 py-2 font-mono">ollama pull llama3.2:3b</p>
          </div>
        )}
        <div className="mt-4 flex items-start justify-between gap-4">
          <div className="max-w-lg">
            <p className="text-body font-medium">Post captions</p>
            <p className="mt-0.5 text-label text-t3">Every new clip gets a caption, hashtags and a credit, ready to paste. Ollama writes it when it is running; without it, it comes from the words in the clip.</p>
          </div>
          <Switch label="Post captions" checked={s.postCaptions} onChange={(v) => s.set({ postCaptions: v })} />
        </div>
        <div className="mt-4 flex items-start justify-between gap-4">
          <div className="max-w-lg">
            <p className="text-body font-medium">Sound effects on new clips</p>
            <p className="mt-0.5 text-label text-t3">Uses only the files you put in your Sounds folder, chosen by Ollama when it is running, else by matching words to file names. Use sounds you are allowed to use.</p>
            <Button size="sm" className="mt-2" onClick={() => void api.sounds.folder().then((p) => api.media.reveal(p))}>Open Sounds folder</Button>
          </div>
          <Switch label="Sound effects on new clips" checked={s.autoSounds} onChange={(v) => s.set({ autoSounds: v })} />
        </div>
        <label className="mt-3 flex max-w-lg flex-col gap-1.5">
          <span className="text-label font-medium text-t2">Hashtags added to every post</span>
          <input value={s.postTags} maxLength={300} onChange={(e) => s.set({ postTags: e.target.value })} className="rounded-md border border-line bg-s2 px-3 py-2 text-body text-t1" />
        </label>
      </div>
    </>
  )
}
