// Phase 5 end-to-end test against the REAL desktop app: local transcription, highlights, speakers,
// transcript editing, caption burn-in and SRT, cancel and cleanup.
//
// Needs a Python environment with faster-whisper and a models folder holding whisper-tiny/ (and speaker/).
//   $env:CLIPIT_AI_PYTHON = 'C:\path\to\venv\Scripts\python.exe'
//   npm run tauri dev -- --config scripts/debug-window.json
//   node scripts/e2e-phase5.mjs <speech video> <models folder> [--keep]
// The speech video should have two speakers and contain the words "incredible" and "secret".
const [SPEECH, MODELS, flag] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function connect() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json')).json()
      const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:1420'))
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(2000)
  }
  throw new Error('webview debug port never came up')
}
const ws = new WebSocket(await connect())
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) pending.get(d.id)(d) }
const evalIn = (expr) => new Promise((resolve, reject) => {
  const n = ++id
  pending.set(n, (d) => (d.result?.exceptionDetails ? reject(new Error(d.result.exceptionDetails.exception?.description ?? 'eval error')) : resolve(d.result?.result?.value)))
  ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
})
const invoke = (cmd, args = {}) => evalIn(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then(v => ({ok: true, v}), e => ({ok: false, e: String(e)}))`)
const results = []
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + String(detail).slice(0, 220) : ''}`) }
const fs = await import('node:fs')
const { execFileSync } = await import('node:child_process')

await sleep(3000)
const info = (await invoke('app_info')).v
const before = (await invoke('load_settings')).v.modelFolder
await invoke('patch_settings', { patch: { modelFolder: MODELS } })

const st = await invoke('ai_status')
check('local AI reports ready with the tiny model', st.ok && st.v.ready && st.v.models.includes('tiny'), JSON.stringify(st.v ?? st.e))
const speakers = st.v?.speakerModels === true
const ol = await invoke('ollama_models')
check('Ollama missing or present is reported without failing', ol.ok || /Ollama is not answering/.test(ol.e), ol.ok ? ol.v.join(',') : ol.e)

const now = new Date().toISOString()
const pid = 'e2e5_' + Date.now()
const mk = (idv, extra = {}) => ({ id: idv, title: 'E2E speech', sourceKind: 'file', sourceLabel: SPEECH, platform: 'local', duration: 49.5, status: 'ready', createdAt: now, clipCount: 0, hue: 40, sizeBytes: 1, sourcePath: SPEECH, ...extra })
await invoke('create_project', { project: mk(pid) })
const req = (projectId, over = {}) => ({ request: { projectId, options: { minLen: 8, maxLen: 20, count: 3, moments: ['Big reactions'], sensitivity: 80 }, aspect: '9:16', target: 'tiktok', captions: true, model: 'tiny', language: 'auto', speakers: true, ollamaModel: null, concurrency: 1, ...over } })

const noModel = await invoke('analyze_project', req(pid, { model: 'large-v3' }))
check('a model that is not downloaded is refused clearly', !noModel.ok && /not downloaded/.test(noModel.e), noModel.e)

const started = await invoke('analyze_project', req(pid))
check('analysis starts', started.ok, started.e)
let proj, job
for (let i = 0; i < 400; i++) {
  job = (await invoke('list_jobs')).v.find((j) => j.id === started.v)
  if (job?.status === 'completed' || job?.status === 'failed') break
  await sleep(500)
}
proj = (await invoke('list_projects')).v.find((p) => p.id === pid)
check('analysis completes and the project is ready', job?.status === 'completed' && job.kind === 'transcribe' && job.simulated === false && proj.status === 'ready', JSON.stringify([job?.status, job?.error, proj.status]))
const clips = (await invoke('list_clips')).v.filter((c) => c.projectId === pid).sort((a, b) => a.startSec - b.startSec)
check('highlights became clips with reasons and captions on', clips.length >= 1 && clips.length <= 3 && clips.every((c) => c.reason && c.captions === 'generated' && c.score > 40 && c.endSec > c.startSec), clips.map((c) => `${c.startSec}-${c.endSec} ${c.score} "${c.title}" (${c.reason})`).join(' | '))
let doc = (await invoke('get_transcript', { projectId: pid })).v
const text = doc?.segments.map((s) => s.words.map((w) => w.text).join(' ')).join(' ').toLowerCase() ?? ''
check('transcript is saved with word timestamps', doc?.language === 'en' && doc.model === 'tiny' && /incredible/.test(text) && /secret/.test(text) && doc.segments.every((s) => s.words.every((w) => w.end >= w.start)), text.slice(0, 120))
const who = new Set(doc.segments.map((s) => s.speaker).filter((x) => x !== undefined && x !== null))
check('two voices are told apart', !speakers || who.size >= 2, `speakers: ${[...who]} (models installed: ${speakers})`)
check('temporary audio files are removed', !fs.readdirSync(info.paths.temp).some((f) => f.startsWith(started.v)))

// ---- edit a word and persist it
const clip = clips.find((c) => doc.segments.some((s) => s.words.some((w) => /incredible/i.test(w.text) && w.start >= c.startSec && w.end <= c.endSec))) ?? clips[0]
for (const s of doc.segments) for (const w of s.words) if (/incredible/i.test(w.text)) w.text = 'LEGENDARY'
const saved = await invoke('save_transcript', { projectId: pid, segments: doc.segments })
doc = (await invoke('get_transcript', { projectId: pid })).v
check('transcript corrections are saved', saved.ok && JSON.stringify(doc).includes('LEGENDARY'), saved.e)

// ---- burn in and SRT
const base = { clipIds: [clip.id], resolution: 720, fps: 30, quality: 'fast', device: 'cpu', cropX: 50, zoom: 1, outDir: null, concurrency: 1, burnCaptions: false, writeSrt: false, style: null }
async function exportWait(r) {
  const ex = await invoke('export_clips', { request: r })
  if (!ex.ok) return ex
  for (let i = 0; i < 200; i++) {
    const c = (await invoke('list_clips')).v.find((x) => x.id === r.clipIds[0])
    const j = (await invoke('list_jobs')).v.find((x) => x.id === ex.v[0])
    if (j.status === 'completed' || j.status === 'failed') return { ok: j.status === 'completed', v: c, e: j.error }
    await sleep(500)
  }
  return { ok: false, e: 'timeout' }
}
const midFrame = (file, at) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'crop=iw:ih/3:0:ih/2,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 })
const word = doc.segments.flatMap((s) => s.words).find((w) => w.start >= clip.startSec + 0.3 && w.end <= clip.endSec)
const at = (word.start + word.end) / 2 - clip.startSec
const plain = await exportWait(base)
const plainCopy = info.paths.temp + '\\e2e5-plain.mp4'
if (plain.ok) fs.copyFileSync(plain.v.exportPath, plainCopy)
const style = { font: 'geist', size: 60, weight: 900, uppercase: true, color: '#ffffff', highlightColor: '#ffd84a', outlineWidth: 7, outlineColor: '#000000', shadow: 4, bgEnabled: false, bgColor: '#0b1020', bgOpacity: 0.7, radius: 8, letterSpacing: -1, lineHeight: 1.02, align: 'center', posY: 70, maxWords: 3, maxLines: 2, animSpeed: 1.2, animation: 'pop-in', highlight: 'keywords' }
const burned = await exportWait({ ...base, burnCaptions: true, writeSrt: true, style })
check('export with burned captions completes', plain.ok && burned.ok, plain.e ?? burned.e)
if (plain.ok && burned.ok) {
  const out = burned.v.exportPath
  const srt = out.replace(/\.mp4$/, '.srt')
  const srtText = fs.existsSync(srt) ? fs.readFileSync(srt, 'utf8') : ''
  check('an SRT file is written next to the video, with the corrected word', /-->/.test(srtText) && /LEGENDARY/.test(srtText), srtText.replace(/\n/g, ' ').slice(0, 160))
  const a = midFrame(plainCopy, at), b = midFrame(out, at)
  let changed = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (Math.abs(a[i] - b[i]) > 60) changed++
  check('captions are drawn into the picture', changed > a.length / 200, `${changed} of ${a.length} pixels differ at ${at.toFixed(2)}s`)
  if (flag === '--keep') fs.copyFileSync(out, info.paths.temp + '\\e2e5-burned.mp4')
  fs.unlinkSync(out)
  if (fs.existsSync(srt)) fs.unlinkSync(srt)
}
if (fs.existsSync(plainCopy)) fs.unlinkSync(plainCopy)

// ---- captions switched off on a clip stays clean
await invoke('update_clip', { id: clip.id, patch: { captions: 'none' } })
const off = await exportWait({ ...base, burnCaptions: true, writeSrt: true, style })
check('a clip with captions off gets no SRT', off.ok && !fs.existsSync(off.v.exportPath.replace(/\.mp4$/, '.srt')), off.e)
if (off.ok) fs.unlinkSync(off.v.exportPath)
await invoke('update_clip', { id: clip.id, patch: { captions: 'generated' } })

// ---- captions on but no transcript is refused
const p2 = pid + '_nt'
await invoke('create_project', { project: mk(p2) })
await invoke('create_clips', { clips: [{ ...clip, id: p2 + '_c', projectId: p2, captions: 'generated', exportStatus: 'not-exported', exportPath: null }] })
const nt = await invoke('export_clips', { request: { ...base, clipIds: [p2 + '_c'], burnCaptions: true, style } })
check('captions on without a transcript is refused with a clear message', !nt.ok && /no transcript/.test(nt.e), nt.e)
await invoke('delete_project', { id: p2 })

// ---- cancel an analysis
const p3 = pid + '_cx'
await invoke('create_project', { project: mk(p3) })
const cx = await invoke('analyze_project', req(p3))
await sleep(900)
const stop = await invoke('cancel_job', { id: cx.v })
await sleep(2500)
const j3 = (await invoke('list_jobs')).v.find((j) => j.id === cx.v)
const pr3 = (await invoke('list_projects')).v.find((p) => p.id === p3)
check('analysis can be cancelled and leaves no temp files', stop.v === true && j3.status === 'failed' && j3.error === 'Cancelled.' && pr3.status === 'draft' && !fs.readdirSync(info.paths.temp).some((f) => f.startsWith(cx.v)), JSON.stringify([j3.status, j3.error, pr3.status]))
await invoke('delete_project', { id: p3 })

if (flag === '--keep') {
  console.log('KEPT project', pid, 'clip', clip.id)
} else {
  await invoke('delete_project', { id: pid })
  const gone = await invoke('get_transcript', { projectId: pid })
  check('deleting a project removes its transcript', gone.ok && gone.v === null)
}
await invoke('patch_settings', { patch: { modelFolder: flag === '--keep' ? MODELS : before } })
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
ws.close()
process.exit(failed ? 1 : 0)
