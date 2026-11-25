// Phase 7 end-to-end test against the REAL desktop app: face tracking, moving crop, waveform and the editor.
//
// Needs: local AI set up in the app (Settings, AI), FFmpeg on PATH. Installs face tracking if it is missing
// (OpenCV from PyPI and the YuNet model from GitHub).
//   npm run tauri dev -- --config scripts/debug-window.json
//   node scripts/e2e-phase7.mjs <video of one face moving left to right> <video with sound> <empty work folder> <AI venv python>
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [FACE, SOUND, WORK, PY] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })
const SRC = path.resolve(WORK, 'face-with-sound.mp4')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', FACE, '-i', SOUND, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', SRC])

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
const until = async (fn, tries = 120, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms) } return null }
const shot = async (name) => { const r = await send('Page.captureScreenshot'); fs.writeFileSync(path.join(WORK, name), Buffer.from(r.result.data, 'base64')) }
const key = (k, shift = false) => js(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, shiftKey: ${shift}, bubbles: true })), true`)

await sleep(3000)
const info = (await invoke('app_info')).v

// ---- set up face tracking with the app's own button
let ai = (await invoke('ai_status')).v
check('local AI is set up', ai.ready, JSON.stringify(ai))
if (!ai.faceReady) {
  await js(`location.hash = '#/settings', true`)
  await sleep(1500)
  await js(`[...document.querySelectorAll('button, [role=tab]')].find((b) => b.textContent.trim() === 'AI')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })), [...document.querySelectorAll('button, [role=tab]')].find((b) => b.textContent.trim() === 'AI')?.click(), true`)
  await sleep(2000)
  const clicked = await js(`(() => { const p = [...document.querySelectorAll('p')].find((x) => x.textContent === 'Face tracking'); const b = p?.parentElement.parentElement.querySelector('button'); if (b && !b.disabled) { b.click(); return true } return false })()`)
  check('the Set up button for face tracking is there', clicked)
  ai = (await until(async () => { const s = (await invoke('ai_status')).v; return s.faceReady ? s : null }, 400, 1000)) ?? ai
}
check('face tracking is installed', ai.faceReady)

// ---- a project with one clip over the moving face
const now = new Date().toISOString()
const pid = 'e2e7_' + Date.now()
const cid = pid + '_c'
await invoke('create_project', { project: { id: pid, title: 'E2E moving face', sourceKind: 'file', sourceLabel: SRC, platform: 'local', duration: 8, status: 'ready', createdAt: now, clipCount: 1, hue: 40, sizeBytes: 1, sourcePath: SRC } })
const made = await invoke('create_clips', { clips: [{ id: cid, projectId: pid, title: 'E2E face clip', startSec: 0, endSec: 8, aspect: '9:16', target: 'tiktok', captions: 'none', exportStatus: 'not-exported', score: 0, hue: 40, createdAt: now }] })
check('a clip is stored with default framing', made.ok, made.e)
const get = async (i = cid) => (await invoke('list_clips')).v.find((c) => c.id === i)
let c = await get()
check('framing defaults to centre, no zoom, no path', c.cropX === 50 && c.zoom === 1 && !c.track, JSON.stringify([c.cropX, c.zoom, c.track]))

const framed = await invoke('update_clip', { id: cid, patch: { cropX: 30, zoom: 1.25 } })
c = await get()
check('crop and zoom are saved on the clip', framed.ok && c.cropX === 30 && c.zoom === 1.25, framed.e)
const badZoom = await invoke('update_clip', { id: cid, patch: { zoom: 9 } })
check('an impossible zoom is refused', !badZoom.ok, badZoom.e)
await invoke('update_clip', { id: cid, patch: { cropX: 50, zoom: 1 } })

// ---- face path: the face centre is known for every moment of this video
const truth = (t) => (40 + ((1280 - 500) * t) / 8 + (420 * 223) / 512) / 1280
const at = (track, t) => { if (t <= track[0][0]) return track[0][1]; for (let i = 1; i < track.length; i++) if (t < track[i][0]) { const [a, x] = track[i - 1], [b, y] = track[i]; return x + ((y - x) * (t - a)) / (b - a) } return track.at(-1)[1] }
const tr = await invoke('track_faces', { clipId: cid })
c = await get()
check('the face is tracked and the path is saved', tr.ok && c.track?.length >= 2, tr.e ?? JSON.stringify(c.track))
if (tr.ok) {
  const worst = Math.max(...[1, 2, 3, 4, 5, 6, 7].map((t) => Math.abs(at(c.track, t) - truth(t))))
  check('the path stays close to the real face position', worst < 0.08, `worst error ${(worst * 100).toFixed(1)}% of the width`)
}

// ---- waveform
const peaks = await invoke('audio_peaks', { path: SRC, start: 0, end: 8, buckets: 160 })
check('the waveform is read from the real audio', peaks.ok && peaks.v.length === 160 && Math.max(...peaks.v) > 0.5 && new Set(peaks.v).size > 20, peaks.e)
const badPeaks = await invoke('audio_peaks', { path: SRC, start: 5, end: 1, buckets: 160 })
check('a backwards range is refused', !badPeaks.ok, badPeaks.e)

// ---- export follows the face
const exportWait = async (clipId) => {
  const ex = await invoke('export_clips', { request: { clipIds: [clipId], resolution: 720, fps: 30, quality: 'fast', device: 'cpu', outDir: path.resolve(WORK), concurrency: 1, burnCaptions: false, writeSrt: false, style: null } })
  if (!ex.ok) return ex
  const job = await until(async () => (await invoke('list_jobs')).v.find((j) => j.id === ex.v[0] && (j.status === 'completed' || j.status === 'failed')), 240)
  return { ok: job?.status === 'completed', e: job?.error, v: await get(clipId) }
}
const faceIn = (file) => {
  const out = path.join(WORK, 'out-track.json')
  execFileSync(PY, [path.resolve('src-tauri/ai/clipit_ai.py'), 'track', '--video', file, '--model', path.join(info.paths.models, 'face', 'yunet.onnx'), '--start', '0', '--end', '8', '--out', out])
  return JSON.parse(fs.readFileSync(out, 'utf8')).samples.filter((s) => s.t > 0.5 && s.t < 7.5)
}
const moving = await exportWait(cid)
check('export with a face path completes', moving.ok, moving.e)
if (moving.ok) {
  const s = faceIn(moving.v.exportPath)
  const seen = s.filter((x) => x.cx !== null)
  const off = seen.length ? Math.max(...seen.map((x) => Math.abs(x.cx - 0.5))) : 1
  check('the face stays near the middle of the exported vertical video', seen.length === s.length && off < 0.2, `${seen.length}/${s.length} frames with a face, furthest ${(off * 100).toFixed(0)}% from centre`)
}

// ---- the editor
await js(`location.hash = '#/editor/${cid}', location.reload(), true`)
await sleep(5000)
const videoState = () => js(`(() => { const v = document.querySelector('section[aria-label="Preview"] video'); return v ? { pos: v.style.objectPosition, w: v.videoWidth, ready: v.readyState } : null })()`)
const v0 = await until(async () => { const v = await videoState(); return v?.ready >= 1 ? v : null }, 60)
check('the editor plays the source video', !!v0 && v0.w === 1280, JSON.stringify(v0))
const bars = await until(async () => js(`(() => { const t = document.querySelector('section[aria-label="Timeline"]'); const h = [...t.querySelectorAll('div > span')].map((s) => s.style.height).filter(Boolean); return h.length >= 100 ? new Set(h).size : 0 })()`), 40)
check('the timeline draws the real waveform', bars > 20, `${bars} distinct bar heights`)
await shot('editor-start.png')
await js(`document.activeElement?.blur(), true`)
for (let i = 0; i < 5; i++) await key('ArrowRight', true)
await sleep(800)
const v5 = await videoState()
check('the preview crop moves with the face', v0 && v5 && parseFloat(v5.pos) > parseFloat(v0.pos) + 20, `${v0?.pos} at 0 s, ${v5?.pos} at 5 s`)
await shot('editor-5s.png')

await key('s')
const halves = await until(async () => { const list = (await invoke('list_clips')).v.filter((x) => x.projectId === pid); return list.length === 2 ? list.sort((a, b) => a.startSec - b.startSec) : null }, 20)
check('S splits the clip at the playhead', !!halves && halves[0].endSec === 5 && halves[1].startSec === 5 && halves[1].endSec === 8, JSON.stringify(halves?.map((h) => [h.startSec, h.endSec])))
check('both halves keep the face path', !!halves && halves.every((h) => h.track?.length >= 2))

for (let i = 0; i < 3; i++) await key('ArrowLeft', true)
await sleep(500)
const vt = await js(`document.querySelector('section[aria-label="Preview"] video').currentTime`)
check('the arrows still move the video after a split', Math.abs(vt - 2) < 0.3, `video at ${vt} s`)
await key('i')
const trimmed = await until(async () => { const x = await get(); return x.startSec === 2 ? x : null }, 20)
check('I sets the start at the playhead', !!trimmed, JSON.stringify((await get()).startSec))

await js(`[...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === 'Frame')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })), true`)
await sleep(500)
await shot('editor-frame.png')
const stopped = await js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Stop following')); b?.click(); return !!b })()`)
const cleared = await until(async () => ((await get()).track ? null : true), 20)
check('"stop following" removes the path', stopped && !!cleared)

await js(`location.hash = '#/clips', true`)
await sleep(1000)
const errors = await js(`document.body.innerText.includes('Something went wrong')`)
check('My Clips still renders', !errors)
await shot('clips.png')

// ---- cleanup: only what this script made (exports went to the work folder)
await invoke('delete_project', { id: pid })
check('test project removed', !(await invoke('list_projects')).v.some((p) => p.id === pid) && fs.existsSync(SRC))

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
ws.close()
process.exit(failed ? 1 : 0)
