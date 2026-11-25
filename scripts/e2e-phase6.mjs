// Phase 6 end-to-end test against the REAL desktop app. It makes its own livestream: FFmpeg publishes a looping
// speech video as HLS and a small web server on 127.0.0.1 serves it. Nothing on the internet is recorded.
//
// Needs: local AI set up in the app with the tiny model (Settings, AI), FFmpeg and Python on PATH.
//   npm run tauri dev -- --config scripts/debug-window.json
//   node scripts/e2e-phase6.mjs <speech video> <empty work folder>
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [SPEECH, WORK] = process.argv.slice(2)
const PORT = 8765
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })
const publisher = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', SPEECH, '-c:v', 'libx264', '-preset', 'veryfast', '-g', '60', '-c:a', 'aac', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6', '-hls_flags', 'delete_segments', path.join(WORK, 'live.m3u8')], { stdio: 'ignore' })
const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', WORK], { stdio: 'ignore' })
const stopStream = () => { publisher.kill(); server.kill() }
process.on('exit', stopStream)
for (let i = 0; i < 40 && !fs.existsSync(path.join(WORK, 'live.m3u8')); i++) await sleep(500)

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
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })) })
const js = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
const invoke = (c, a = {}) => js(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)}).then(v => ({ok: true, v}), e => ({ok: false, e: String(e)}))`)
const results = []
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + String(detail).slice(0, 220) : ''}`) }

await sleep(3000)
// Collect the backend's live events inside the page.
await js(`(async () => { window.__live = []; const handler = window.__TAURI_INTERNALS__.transformCallback((e) => window.__live.push(e.payload)); await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', { event: 'live-update', target: { kind: 'Any' }, handler }) })()`)
const events = (sid) => js(`window.__live.filter((e) => e.sessionId === ${JSON.stringify(sid)})`)

const info = (await invoke('app_info')).v
const ai = (await invoke('ai_status')).v
check('local AI with the tiny model is available', ai.ready && ai.models.includes('tiny'), JSON.stringify(ai))
const before = (await invoke('list_projects')).v.map((p) => p.id)
const URL_ = `http://127.0.0.1:${PORT}/live.m3u8`
const SID = 'e2elive_' + Date.now()
const req = (over = {}) => ({ request: { id: SID, url: URL_, confirmedRights: true, model: 'tiny', language: 'auto', autoClip: true, bufferMinutes: 5, minLen: 6, maxLen: 18, moments: [], sensitivity: 80, aspect: '9:16', target: 'tiktok', maxHeight: 720, ...over } })

const noRights = await invoke('live_start', req({ confirmedRights: false }))
check('monitoring is refused without the rights confirmation', !noRights.ok && /right to record/.test(noRights.e), noRights.e)
const bad = await invoke('live_start', req({ id: 'e2ebad', url: 'file:///c:/x.m3u8' }))
check('a file address is refused', !bad.ok && /not supported/.test(bad.e), bad.e)
check('refusals hold no session slot', (await invoke('live_running')).v.length === 0)

const started = await invoke('live_start', req())
check('monitoring starts on the local HLS stream', started.ok, started.e)
const dup = await invoke('live_start', req())
check('the same stream cannot be monitored twice', !dup.ok && /already being monitored/.test(dup.e), dup.e)

let ev = []
for (let i = 0; i < 110; i++) {
  ev = await events(SID)
  if (ev.some((e) => e.kind === 'ready')) break
  await sleep(1000)
}
const mon = ev.find((e) => e.kind === 'monitoring')
check('it reaches monitoring with transcription on', !!mon && mon.transcribing === true, ev.map((e) => e.kind).filter((k) => k !== 'tick').join(','))
const tick = [...ev].reverse().find((e) => e.kind === 'tick')
check('it reports time, buffer length and a preview frame', tick && tick.uptimeSec > 10 && tick.bufferedSec > 5 && !!tick.thumbnail && fs.existsSync(tick.thumbnail), JSON.stringify(tick && [tick.uptimeSec, tick.bufferedSec]))
const found = ev.find((e) => e.kind === 'found')
check('a highlight is detected automatically', !!found && found.score > 40, found && `${found.atSec?.toFixed(1)}s ${found.score} ${found.label} "${found.title}"`)
const ready = ev.find((e) => e.kind === 'ready')
check('it is cut from the buffer and saved', !!ready?.projectId, JSON.stringify(ev.filter((e) => e.kind === 'failed' || e.kind === 'warning')))

if (ready) {
  const p = (await invoke('list_projects')).v.find((x) => x.id === ready.projectId)
  const c = (await invoke('list_clips')).v.find((x) => x.projectId === ready.projectId)
  const t = (await invoke('get_transcript', { projectId: ready.projectId })).v
  check('the live clip is a normal project with a real file', p?.sourceKind === 'live' && p.status === 'ready' && fs.existsSync(p.sourcePath) && p.sourcePath.toLowerCase().startsWith(info.paths.downloads.toLowerCase()), p?.sourcePath)
  check('the stored label is the host only, never the link', p.sourceLabel === '127.0.0.1', p.sourceLabel)
  check('it has a clip with a reason and its own transcript', !!c?.reason && c.endSec > c.startSec && t?.segments.length > 0 && c.captions === 'generated', `${c?.startSec}-${c?.endSec} ${t?.segments.map((s) => s.words.map((w) => w.text).join(' ')).join(' ').slice(0, 90)}`)
  const pj = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', p.sourcePath]).toString())
  check('the saved file plays and holds the clip range', parseFloat(pj.format.duration) >= c.endSec - 0.5, `${pj.format.duration}s`)
}

const seen = (await events(SID)).filter((e) => e.kind === 'ready').length
const now = await invoke('live_clip_now', { id: SID, seconds: 10 })
let manual
for (let i = 0; i < 40; i++) {
  const all = await events(SID)
  manual = all.filter((e) => e.kind === 'found' && e.title === 'Manual clip')[0]
  if (manual && all.filter((e) => e.kind === 'ready').length > seen) break
  await sleep(1000)
}
check('"clip the last 10 seconds" works', now.ok && !!manual && (await events(SID)).some((e) => e.kind === 'ready' && e.n === manual.n), now.e)

// A second stream runs alongside, and an unreachable one ends with a clear error.
const SID2 = SID + 'b'
const s2 = await invoke('live_start', req({ id: SID2, autoClip: false }))
const SID3 = SID + 'c'
const s3 = await invoke('live_start', req({ id: SID3, url: 'http://127.0.0.1:9/none.m3u8' }))
const four = await invoke('live_start', req({ id: SID + 'd' }))
check('several streams run at once, with a limit of three', s2.ok && s3.ok && !four.ok && /at once/.test(four.e), four.e)
let end3
for (let i = 0; i < 90 && !end3; i++) {
  end3 = (await events(SID3)).find((e) => e.kind === 'ended')
  await sleep(1000)
}
check('an unreachable stream retries and then ends with an error', !!end3?.message && /Could not open/.test(end3.message) && (await events(SID3)).some((e) => e.kind === 'reconnecting'), end3?.message)

for (const s of [SID, SID2]) await invoke('live_stop', { id: s })
let running
for (let i = 0; i < 40; i++) {
  running = (await invoke('live_running')).v
  if (!running.length) break
  await sleep(500)
}
check('stop ends the sessions', running.length === 0 && (await events(SID)).some((e) => e.kind === 'ended' && !e.message), running.join(','))
await sleep(1500)
check('the rolling buffers are removed', [SID, SID2, SID3].every((s) => !fs.existsSync(path.join(info.paths.temp, 'live', s))))
const strays = execFileSync('powershell', ['-NoProfile', '-Command', "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'ffmpeg.exe','python.exe' -and ($_.CommandLine -match 'segment_list|clipit_ai.py') }).Count"]).toString().trim()
check('no recorder or transcriber process is left running', strays === '0', `${strays} found`)

for (const p of (await invoke('list_projects')).v.filter((p) => !before.includes(p.id))) await invoke('delete_project', { id: p.id })
check('cleanup removes the saved live files', !fs.readdirSync(info.paths.downloads).some((f) => f.startsWith('live-')), fs.readdirSync(info.paths.downloads).join(','))

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
ws.close()
stopStream()
process.exit(failed ? 1 : 0)
