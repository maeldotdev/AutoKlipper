import { Check, FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Page } from '@/components/Common'
import { Button } from '@/components/ui/Button'
import { Segmented, Select, Slider, Switch } from '@/components/ui/Controls'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { Badge } from '@/components/ui/Display'
import { Input } from '@/components/ui/Input'
import { pickFolder } from '@/lib/native'
import { cn, fmtBytes } from '@/lib/utils'
import { useStorage } from '@/hooks/useStorage'
import { AboutPanel } from '@/components/settings/AboutPanel'
import { AiPanel } from '@/components/settings/AiPanel'
import { IS_MOCK_BACKEND, api, type FfmpegStatus, type ToolStatus } from '@/services'
import { ACCENTS, useSettings, type ThemeId } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { useUpdate } from '@/stores/update'
import { LANGUAGES, WHISPER_MODELS } from '@/theme/models'

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'processing', label: 'Processing' },
  { id: 'ai', label: 'AI' },
  { id: 'storage', label: 'Storage' },
  { id: 'about', label: 'About' },
] as const

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-line py-4 last:border-0">
      <div className="max-w-md">
        <p className="text-body font-medium">{label}</p>
        {hint ? <p className="mt-0.5 text-label text-t3">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

const THEMES: { id: ThemeId; label: string; sw: string[] }[] = [
  { id: 'midnight', label: 'Midnight', sw: ['#070b16', '#0d1424', '#18233e'] },
  { id: 'abyss', label: 'Abyss', sw: ['#03060d', '#080e1b', '#131d36'] },
  { id: 'slate', label: 'Slate', sw: ['#0c111b', '#121823', '#212b3c'] },
]

export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const tab = SECTIONS.find((s) => s.id === params.get('tab'))?.id ?? 'general'
  const s = useSettings()
  const checkUpdate = useUpdate((u) => u.check)
  const checkingUpdate = useUpdate((u) => u.checking)
  const [clean, setClean] = useState<null | 'cache' | 'temp'>(null)
  const [resetting, setResetting] = useState(false)
  const storage = useStorage()
  const [ff, setFf] = useState<FfmpegStatus | null | undefined>(undefined)
  const checkFfmpeg = useCallback(() => {
    setFf(undefined)
    api.media.ffmpegStatus().then(setFf).catch(() => setFf(null))
  }, [])
  useEffect(() => {
    if (tab === 'processing') checkFfmpeg()
  }, [tab, checkFfmpeg])
  const [yt, setYt] = useState<ToolStatus | null | undefined>(undefined)
  const checkYt = useCallback(() => {
    setYt(undefined)
    api.media.ytdlpStatus().then(setYt).catch(() => setYt(null))
  }, [])
  useEffect(() => {
    if (tab === 'processing') checkYt()
  }, [tab, checkYt])
  const chooseTool = async (tool: 'ffmpeg' | 'ytdlp') => {
    try {
      const path = await api.system.chooseTool(tool)
      if (!path) return
      s.set(tool === 'ffmpeg' ? { ffmpegPath: path } : { ytdlpPath: path })
      if (tool === 'ffmpeg') checkFfmpeg()
      else checkYt()
    } catch (e) {
      toast({ kind: 'error', title: 'That file was not used', body: String(e) })
    }
  }
  const automaticTool = async (tool: 'ffmpeg' | 'ytdlp') => {
    const patch = tool === 'ffmpeg' ? { ffmpegPath: '' } : { ytdlpPath: '' }
    // Save first: the backend reads the settings file when it looks for the tool.
    await api.system.patchSettings(patch)
    s.set(patch)
    if (tool === 'ffmpeg') checkFfmpeg()
    else checkYt()
  }
  const tones = ['bg-accent', 'bg-cyan', 'bg-warn', 'bg-t3', 'bg-ok']
  const barTotal = storage.totalBytes ?? Math.max(storage.used, 1)

  const browse = async (key: 'exportFolder' | 'modelFolder', title: string) => {
    const p = await pickFolder(title)
    if (p) s.set({ [key]: p })
  }

  return (
    <Page className="grid grid-cols-[200px_minmax(0,1fr)] items-start gap-6">
      <nav aria-label="Settings sections" className="sticky top-5 flex flex-col gap-0.5">
        {SECTIONS.map((x) => (
          <button
            key={x.id}
            aria-current={tab === x.id ? 'page' : undefined}
            onClick={() => setParams({ tab: x.id })}
            className={cn('no-drag h-9 rounded-md px-3 text-left text-body transition-colors duration-150', tab === x.id ? 'bg-s3 text-t1' : 'text-t2 hover:bg-s2 hover:text-t1')}
          >
            {x.label}
          </button>
        ))}
      </nav>

      <section className="panel px-6 py-2" aria-label={SECTIONS.find((x) => x.id === tab)?.label}>
        {tab === 'general' ? (
          <>
            <Row label="Default export folder" hint="Where finished clips and SRT files are saved.">
              <Input aria-label="Export folder" readOnly value={s.exportFolder} className="w-72 font-mono text-label" />
              <Button onClick={() => browse('exportFolder', 'Choose export folder')}><FolderOpen size={15} />Browse</Button>
            </Row>
            <Row label="Storage folder for large files" hint="Downloads, live buffers, new models and temporary files. Pick a drive with space. Takes effect after restarting AutoKlipper; files already saved stay where they are.">
              <Input aria-label="Storage folder" readOnly value={s.dataFolder || 'App data folder (default)'} className="w-72 font-mono text-label" />
              <Button onClick={() => void pickFolder('Choose a folder for large files').then((p) => { if (p) { s.set({ dataFolder: p }); toast({ kind: 'info', title: 'Restart AutoKlipper to use the new folder' }) } })}><FolderOpen size={15} />Browse</Button>
              {s.dataFolder ? <Button variant="ghost" onClick={() => s.set({ dataFolder: '' })}>Use default</Button> : null}
            </Row>
            <Row label="Open on startup" hint="Which page AutoKlipper shows first.">
              <div className="w-44"><Select aria-label="Startup page" value={s.startup} onChange={(v) => s.set({ startup: v })} options={[{ value: 'dashboard', label: 'Dashboard' }, { value: 'last-page', label: 'Last page used' }]} /></div>
            </Row>
            {IS_MOCK_BACKEND ? null : (
              <Row label="Updates" hint="Looks on GitHub for a newer version when AutoKlipper starts. Nothing installs without your click.">
                <Button loading={checkingUpdate} onClick={() => void checkUpdate()}>Check now</Button>
                <Switch label="Check for updates at start" checked={s.checkUpdates} onChange={(v) => s.set({ checkUpdates: v })} />
              </Row>
            )}
            {IS_MOCK_BACKEND ? null : (
              <Row label="Keep running in the tray when closed" hint="Closing the window hides AutoKlipper near the clock, so jobs and livestreams carry on. Right-click the tray icon to quit.">
                <Switch label="Keep running in the tray when closed" checked={s.closeToTray} onChange={(v) => s.set({ closeToTray: v })} />
              </Row>
            )}
            <Row label="Desktop notifications" hint="A Windows pop-up when clips are ready, an export ends or something fails. Click it to open AutoKlipper there.">
              <Switch label="Desktop notifications" checked={s.notifications} onChange={(v) => s.set({ notifications: v })} />
            </Row>
            {IS_MOCK_BACKEND ? null : (
              <Row label="Setup guide" hint="Check the free tools, local AI, captions and folders again.">
                <Button onClick={() => s.set({ setupDone: false })}>Run setup</Button>
              </Row>
            )}
            <Row label="Reset all settings" hint="Restores every option on this page to its default.">
              <Button variant="danger" onClick={() => setResetting(true)}>Reset settings</Button>
            </Row>
          </>
        ) : null}

        {tab === 'appearance' ? (
          <>
            <Row label="Theme" hint="Surface colours for the whole app.">
              <div className="flex gap-3">
                {THEMES.map((t) => (
                  <button key={t.id} aria-pressed={s.theme === t.id} onClick={() => s.set({ theme: t.id })} className={cn('no-drag w-28 rounded-lg border p-2 text-left transition-colors duration-150', s.theme === t.id ? 'border-accent bg-s3' : 'border-line hover:border-line2')}>
                    <span className="flex h-9 overflow-hidden rounded">{t.sw.map((c) => <span key={c} className="flex-1" style={{ background: c }} />)}</span>
                    <span className="mt-1.5 flex items-center justify-between text-label">{t.label}{s.theme === t.id ? <Check size={13} className="text-accent" /> : null}</span>
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Accent colour" hint="Buttons, focus rings and highlights.">
              <div className="flex items-center gap-2">
                {ACCENTS.map((a) => (
                  <button key={a.id} aria-label={a.label} aria-pressed={s.accent.toLowerCase() === a.value} title={a.label} onClick={() => s.set({ accent: a.value })} className={cn('no-drag h-7 w-7 rounded-full ring-offset-2 ring-offset-[var(--surface-1)] transition-shadow duration-150', s.accent.toLowerCase() === a.value ? 'ring-2 ring-t1' : 'hover:ring-2 hover:ring-line2')} style={{ background: a.value }} />
                ))}
                <label className="no-drag ml-1 flex items-center gap-2 text-label text-t2">
                  <input type="color" aria-label="Custom accent colour" value={s.accent} onChange={(e) => s.set({ accent: e.target.value })} className="h-7 w-9 cursor-pointer rounded-md border border-line bg-s2 p-0.5" />
                  Custom
                </label>
              </div>
            </Row>
            <Row label="Interface density" hint="Compact fits more on screen.">
              <Segmented label="Interface density" value={s.density} onChange={(v) => s.set({ density: v })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
            </Row>
            <Row label="Animations" hint="System follows your Windows setting.">
              <div className="w-44"><Select aria-label="Animations" value={s.motion} onChange={(v) => s.set({ motion: v })} options={[{ value: 'system', label: 'Follow system' }, { value: 'reduced', label: 'Reduced' }, { value: 'off', label: 'Off' }]} /></div>
            </Row>
          </>
        ) : null}

        {tab === 'processing' ? (
          <>
            <Row label="FFmpeg" hint={IS_MOCK_BACKEND ? 'Video processing runs in the desktop app.' : 'The engine that cuts and reframes video. AutoKlipper never downloads it silently.'}>
              {IS_MOCK_BACKEND ? <Badge>Desktop app only</Badge> : null}
            </Row>
            {IS_MOCK_BACKEND ? null : (
              <div className="border-b border-line py-4">
                {ff === undefined ? <p className="text-body text-t2">Looking for FFmpeg</p> : ff?.found ? (
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 text-body">
                      <p className="flex items-center gap-2"><Badge tone="success"><Check size={11} />Found</Badge><span className="font-mono text-label">{ff.version}</span></p>
                      <p className="mt-1.5 truncate font-mono text-meta text-t3" title={ff.ffmpegPath ?? ''}>{ff.ffmpegPath}</p>
                      <p className="mt-1 text-label text-t2">Hardware H.264 encoders: {ff.hardwareEncoders.length ? ff.hardwareEncoders.join(', ') : 'none, CPU encoding only'}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button onClick={checkFfmpeg}>Check again</Button>
                      <Button onClick={() => void chooseTool('ffmpeg')}>Change</Button>
                      {s.ffmpegPath ? <Button variant="ghost" onClick={() => void automaticTool('ffmpeg')}>Use automatic</Button> : null}
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="flex items-center gap-2"><Badge tone="danger">Not found</Badge><span className="text-body">Exports and video reading need FFmpeg.</span></p>
                    <p className="mt-2 text-label text-t2">Install it from a terminal, then check again:</p>
                    <p className="mt-1 rounded-md border border-line bg-s2 px-3 py-2 font-mono text-label">winget install Gyan.FFmpeg</p>
                    <div className="mt-3 flex gap-2"><Button onClick={checkFfmpeg}>Check again</Button><Button onClick={() => void chooseTool('ffmpeg')}>Choose ffmpeg.exe</Button></div>
                  </div>
                )}
              </div>
            )}
            <Row label="yt-dlp" hint={IS_MOCK_BACKEND ? 'Link downloads run in the desktop app.' : 'Downloads videos from links. AutoKlipper never downloads it silently. Sites change often, so keep it updated.'}>
              {IS_MOCK_BACKEND ? <Badge>Desktop app only</Badge> : null}
            </Row>
            {IS_MOCK_BACKEND ? null : (
              <div className="border-b border-line py-4">
                {yt === undefined ? <p className="text-body text-t2">Looking for yt-dlp</p> : yt?.found ? (
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 text-body">
                      <p className="flex items-center gap-2"><Badge tone="success"><Check size={11} />Found</Badge><span className="font-mono text-label">{yt.version}</span></p>
                      <p className="mt-1.5 truncate font-mono text-meta text-t3" title={yt.path ?? ''}>{yt.path}</p>
                      <p className="mt-1 text-label text-t2">If a site stops working, update it with <span className="font-mono">winget upgrade yt-dlp.yt-dlp</span></p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button onClick={checkYt}>Check again</Button>
                      <Button onClick={() => void chooseTool('ytdlp')}>Change</Button>
                      {s.ytdlpPath ? <Button variant="ghost" onClick={() => void automaticTool('ytdlp')}>Use automatic</Button> : null}
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="flex items-center gap-2"><Badge tone="danger">Not found</Badge><span className="text-body">Importing from links needs yt-dlp. Local files still work.</span></p>
                    <p className="mt-2 text-label text-t2">Install it from a terminal, then check again:</p>
                    <p className="mt-1 rounded-md border border-line bg-s2 px-3 py-2 font-mono text-label">winget install yt-dlp.yt-dlp</p>
                    <div className="mt-3 flex gap-2"><Button onClick={checkYt}>Check again</Button><Button onClick={() => void chooseTool('ytdlp')}>Choose yt-dlp.exe</Button></div>
                  </div>
                )}
              </div>
            )}
            {IS_MOCK_BACKEND ? null : (
              <Row label="Use my browser's sign-in" hint="Only for videos your own account may watch (private, age-restricted, members). AutoKlipper never sees your password. It lets yt-dlp read your browser's cookies for the site. Off by default.">
                <div className="w-44"><Select aria-label="Browser sign-in" value={s.cookiesBrowser || 'none'} onChange={(v) => s.set({ cookiesBrowser: v === 'none' ? '' : (v as typeof s.cookiesBrowser) })} options={[{ value: 'none', label: 'Off' }, { value: 'chrome', label: 'Chrome' }, { value: 'edge', label: 'Edge' }, { value: 'firefox', label: 'Firefox' }, { value: 'brave', label: 'Brave' }]} /></div>
              </Row>
            )}
            <Row label="Processing device" hint="GPU uses the first hardware H.264 encoder your FFmpeg offers. If none exists, exports explain it.">
              <Segmented label="Processing device" value={s.device} onChange={(v) => s.set({ device: v })} options={[{ value: 'auto', label: 'Automatic' }, { value: 'cpu', label: 'CPU' }, { value: 'gpu', label: 'GPU' }]} />
            </Row>
            <Row label="Quality" hint="Higher quality renders slower and makes larger files.">
              <Segmented label="Processing quality" value={s.quality} onChange={(v) => s.set({ quality: v })} options={[{ value: 'fast', label: 'Fast' }, { value: 'balanced', label: 'Balanced' }, { value: 'high', label: 'High' }]} />
            </Row>
            <Row label="Concurrent jobs" hint="How many jobs may run at once.">
              <div className="flex w-56 items-center gap-3"><Slider label="Concurrent jobs" min={1} max={4} value={[s.concurrency]} onChange={([v]) => s.set({ concurrency: v })} /><span className="w-4 font-mono text-label">{s.concurrency}</span></div>
            </Row>
          </>
        ) : null}

        {tab === 'ai' ? (
          <>
            {IS_MOCK_BACKEND ? (
            <div className="border-b border-line py-4">
              <p className="text-body font-medium">Transcription model</p>
              <p className="mb-3 mt-0.5 text-label text-t3">Faster-Whisper runs on your machine. A model downloads once, then works offline.</p>
              <div role="radiogroup" aria-label="Transcription model" className="grid gap-2">
                {WHISPER_MODELS.map((m) => (
                  <button key={m.id} role="radio" aria-checked={s.model === m.id} onClick={() => s.set({ model: m.id })} className={cn('no-drag grid grid-cols-[20px_90px_90px_1fr_90px] items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-body transition-colors duration-150', s.model === m.id ? 'border-accent bg-accent/[0.07]' : 'border-line hover:border-line2')}>
                    <span className={cn('flex h-4 w-4 items-center justify-center rounded-full border', s.model === m.id ? 'border-accent' : 'border-line2')}>{s.model === m.id ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}</span>
                    <span className="font-medium">{m.label}</span>
                    <span className="font-mono text-label text-t2">{m.download}</span>
                    <span className="text-label text-t2">{m.memory}. {m.note}</span>
                    <span className="text-right text-label text-t3">{m.speed}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-meta text-t3">Sizes and relative speed follow the Whisper project. Memory is approximate and depends on settings.</p>
            </div>
            ) : <AiPanel />}
            <Row label="Model storage folder" hint="Where downloaded models live.">
              <Input aria-label="Model folder" readOnly value={s.modelFolder} className="w-72 font-mono text-label" />
              <Button onClick={() => browse('modelFolder', 'Choose model folder')}><FolderOpen size={15} />Browse</Button>
            </Row>
            <Row label="Spoken language" hint="Auto detect works for most clips.">
              <div className="w-44"><Select aria-label="Spoken language" value={s.language} onChange={(v) => s.set({ language: v })} options={LANGUAGES} /></div>
            </Row>
            <Row label="Highlight sensitivity" hint="Higher keeps weaker candidate moments.">
              <div className="flex w-56 items-center gap-3"><Slider label="Highlight sensitivity" min={10} max={100} step={5} value={[s.sensitivity]} onChange={([v]) => s.set({ sensitivity: v })} /><span className="w-10 font-mono text-label">{s.sensitivity}%</span></div>
            </Row>
            {IS_MOCK_BACKEND ? <Row label="Local LLM through Ollama" hint="Optional. Scores moments with a model you run yourself.">
              <Badge>Desktop app only</Badge><Switch label="Ollama" checked={false} onChange={() => undefined} />
            </Row> : null}
          </>
        ) : null}

        {tab === 'storage' ? (
          <>
            <div className="border-b border-line py-4">
              <div className="mb-2 flex items-baseline justify-between"><p className="text-body font-medium">Storage used</p><span className="font-mono text-label text-t2">{fmtBytes(storage.used)}{storage.totalBytes ? ', sample values' : ' by AutoKlipper'}</span></div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-s3">
                {(storage.items ?? []).map((x, i) => <div key={x.id} className={tones[i]} style={{ width: `${(x.bytes / barTotal) * 100}%` }} />)}
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1.5 text-body">
                {(storage.items ?? []).map((x, i) => <li key={x.id} className="flex items-center gap-2"><span className={cn('h-2.5 w-2.5 rounded-sm', tones[i])} /><span className="flex-1 text-t2">{x.label}</span><span className="font-mono text-label">{fmtBytes(x.bytes)}</span></li>)}
              </ul>
            </div>
            <Row label="Clear cache" hint="Thumbnails and analysis results. They are rebuilt when needed."><Button onClick={() => setClean('cache')}>Clear cache</Button></Row>
            <Row label="Delete temporary files" hint="Partial renders and downloads left by failed jobs."><Button onClick={() => setClean('temp')}>Delete temp files</Button></Row>
            <Row label="Clean up automatically" hint="Remove temp files after each finished job."><Switch label="Clean up automatically" checked={s.autoCleanup} onChange={(v) => s.set({ autoCleanup: v })} /></Row>
            <Row label="Cache size limit" hint="Oldest cache entries go first.">
              <div className="flex w-56 items-center gap-3"><Slider label="Cache size limit" min={2} max={100} step={2} value={[s.cacheCapGb]} onChange={([v]) => s.set({ cacheCapGb: v })} /><span className="w-14 font-mono text-label">{s.cacheCapGb} GB</span></div>
            </Row>
          </>
        ) : null}

        {tab === 'about' ? <AboutPanel /> : null}
      </section>

      <ConfirmDialog open={clean !== null} onOpenChange={(o) => !o && setClean(null)} title={clean === 'cache' ? 'Clear the cache?' : 'Delete temporary files?'} description={storage.real ? 'Deletes the files inside this AutoKlipper folder. Your projects, clips and exports are not touched. This cannot be undone.' : 'Prototype: this is simulated and removes nothing from your disk.'} confirmLabel={clean === 'cache' ? 'Clear cache' : 'Delete files'} onConfirm={() => { const t = clean; setClean(null); if (!t) return; if (!storage.real) { toast({ kind: 'success', title: 'Simulated cleanup finished', body: 'No files were touched.' }); return } api.system.cleanStorage(t).then((n) => { toast({ kind: 'success', title: 'Cleanup finished', body: `Freed ${fmtBytes(n)}.` }); void storage.refresh() }).catch((e) => toast({ kind: 'error', title: 'Cleanup failed', body: String(e) })) }} />
      <ConfirmDialog open={resetting} onOpenChange={setResetting} title="Reset all settings?" description="Theme, accent, folders and processing options return to their defaults." confirmLabel="Reset settings" onConfirm={() => { s.reset(); setResetting(false); toast({ kind: 'success', title: 'Settings reset' }) }} />
    </Page>
  )
}
