// Drives the REAL desktop app through the WebView2 debug port. Calls the actual Tauri commands.
const SRC = process.argv[2]
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
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) pending.get(d.id)(d)
}
const evalIn = (expr) =>
  new Promise((resolve, reject) => {
    const n = ++id
    pending.set(n, (d) => (d.result?.exceptionDetails ? reject(new Error(d.result.exceptionDetails.exception?.description ?? 'eval error')) : resolve(d.result?.result?.value)))
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
  })
const invoke = (cmd, args = {}) =>
  evalIn(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then(v => ({ok: true, v}), e => ({ok: false, e: String(e)}))`)

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

// give the app a moment to finish bootstrap
await sleep(3000)

const ff = await invoke('ffmpeg_status')
check('ffmpeg_status finds FFmpeg', ff.ok && ff.v.found, ff.ok ? `${ff.v.version} hw=[${ff.v.hardwareEncoders}]` : ff.e)

const bad = await invoke('probe_media', { path: SRC + '.missing' })
check('probe of a missing file gives a readable error', !bad.ok && /not found/i.test(bad.e), bad.e)

const pr = await invoke('probe_media', { path: SRC })
check('probe_media reads the test video', pr.ok && pr.v.width === 1920 && pr.v.height === 1080 && Math.abs(pr.v.durationSec - 20) < 0.5 && pr.v.hasAudio, JSON.stringify(pr.v))

const now = new Date().toISOString()
const pid = 'e2e_p_' + Date.now()
const mkClip = (n, start, end, aspect) => ({ id: `e2e_c${n}_${Date.now()}`, projectId: pid, title: `E2E clip ${n}`, startSec: start, endSec: end, aspect, target: 'tiktok', captions: 'none', exportStatus: 'not-exported', score: 80, hue: 100, createdAt: now, exportPath: null })
const c1 = mkClip(1, 3, 9, '9:16')
const c2 = mkClip(2, 10, 14, '1:1')
const c3 = mkClip(3, 1, 5, '16:9')
const mk = await invoke('create_project', { project: { id: pid, title: 'E2E project', sourceKind: 'file', sourceLabel: 'e2e-source.mp4', platform: 'local', duration: pr.v.durationSec, status: 'ready', createdAt: now, clipCount: 0, hue: 10, sizeBytes: pr.v.sizeBytes, sourcePath: SRC } })
check('create_project with sourcePath', mk.ok, mk.e)
const mc = await invoke('create_clips', { clips: [c1, c2, c3] })
check('create_clips', mc.ok, mc.e)

const projs = await invoke('list_projects')
const mine = projs.v.find((p) => p.id === pid)
check('list_projects returns sourcePath and clip count', mine?.sourcePath === SRC && mine.clipCount === 3, JSON.stringify({ sp: mine?.sourcePath, n: mine?.clipCount }))

// A project with no source file must be refused, with a clear message and nothing queued.
const pid2 = pid + '_nosrc'
await invoke('create_project', { project: { id: pid2, title: 'No source', sourceKind: 'url', sourceLabel: 'x', platform: 'youtube', duration: 100, status: 'ready', createdAt: now, clipCount: 0, hue: 1, sizeBytes: 0, sourcePath: null } })
const cx = { ...mkClip(9, 1, 5, '9:16'), id: 'e2e_nosrc_' + Date.now(), projectId: pid2 }
await invoke('create_clips', { clips: [cx] })
const req = { resolution: 720, fps: 30, quality: 'fast', device: 'cpu', cropX: 50, zoom: 1, outDir: null, concurrency: 1 }
const refused = await invoke('export_clips', { request: { ...req, clipIds: [cx.id] } })
check('export of a clip with no source video is refused clearly', !refused.ok && /no source video/i.test(refused.e), refused.e)
const jobsBefore = (await invoke('list_jobs')).v.length

// Real export: 3 clips, concurrency 1, then cancel the last one while it waits.
const ex = await invoke('export_clips', { request: { ...req, clipIds: [c1.id, c2.id, c3.id] } })
check('export_clips queues 3 jobs', ex.ok && ex.v.length === 3, ex.e)
const jobIds = ex.v
await sleep(150)
const cancelled = await invoke('cancel_job', { id: jobIds[2] })
check('a waiting job can be cancelled', cancelled.ok && cancelled.v === true, JSON.stringify(cancelled))

let clips
for (let i = 0; i < 120; i++) {
  clips = (await invoke('list_clips')).v.filter((c) => c.projectId === pid)
  const st = Object.fromEntries(clips.map((c) => [c.id, c.exportStatus]))
  if (st[c1.id] === 'exported' && st[c2.id] === 'exported' && st[c3.id] !== 'queued') break
  await sleep(500)
}
const byId = Object.fromEntries(clips.map((c) => [c.id, c]))
check('clip 1 exported', byId[c1.id].exportStatus === 'exported' && !!byId[c1.id].exportPath, byId[c1.id].exportPath)
check('clip 2 exported', byId[c2.id].exportStatus === 'exported' && !!byId[c2.id].exportPath, byId[c2.id].exportPath)
check('cancelled clip returns to not-exported', byId[c3.id].exportStatus === 'not-exported' && !byId[c3.id].exportPath, byId[c3.id].exportStatus)

const jobs = (await invoke('list_jobs')).v
const mineJobs = jobs.filter((j) => jobIds.includes(j.id))
check('jobs persisted with correct final states', mineJobs.length === 3 && mineJobs.filter((j) => j.status === 'completed').length === 2 && mineJobs.find((j) => j.id === jobIds[2])?.error === 'Cancelled.' && mineJobs.every((j) => j.simulated === false), JSON.stringify(mineJobs.map((j) => [j.status, j.progress, j.error])))
check('refused export queued nothing extra', jobs.length === jobsBefore + 3)

// Verify the actual files on disk with ffprobe.
const { execFileSync } = await import('node:child_process')
const fs = await import('node:fs')
const probe = (p) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', p]).toString())
for (const [c, w, h, len] of [[c1, 720, 1280, 6], [c2, 720, 720, 4]]) {
  const p = byId[c.id].exportPath
  const exists = fs.existsSync(p)
  const j = exists ? probe(p) : null
  const v = j?.streams.find((s) => s.codec_type === 'video')
  const dur = j ? parseFloat(j.format.duration) : 0
  check(`file on disk: ${c.title} is ${w}x${h}, about ${len}s, h264 + audio`, exists && v.width === w && v.height === h && Math.abs(dur - len) < 0.4 && v.codec_name === 'h264' && j.streams.some((s) => s.codec_type === 'audio'), exists ? `${v.width}x${v.height} ${dur.toFixed(2)}s` : 'missing file')
}
const cancelledFile = (await invoke('app_info')).v.paths.exports
const leftovers = fs.readdirSync(cancelledFile).filter((f) => f.startsWith('E2E-clip-3-'))
check('cancelled export leaves no partial file', leftovers.length === 0, leftovers.join(','))

// Cancel a job that is actually running (kills the FFmpeg process).
const c4 = mkClip(4, 0, 19.5, '16:9')
await invoke('create_clips', { clips: [c4] })
const ex4 = await invoke('export_clips', { request: { ...req, resolution: 1080, quality: 'high', clipIds: [c4.id] } })
let running = false
for (let i = 0; i < 60 && !running; i++) {
  const j = (await invoke('list_jobs')).v.find((x) => x.id === ex4.v[0])
  running = j?.status === 'running'
  if (!running) await sleep(100)
}
check('long export reaches running state', running)
const stopped = await invoke('cancel_job', { id: ex4.v[0] })
await sleep(1500)
const c4s = (await invoke('list_clips')).v.find((c) => c.id === c4.id)
const j4 = (await invoke('list_jobs')).v.find((x) => x.id === ex4.v[0])
check('running export can be cancelled and cleans up', stopped.v === true && c4s.exportStatus === 'not-exported' && j4.status === 'failed' && j4.error === 'Cancelled.' && !fs.readdirSync(cancelledFile).some((f) => f.startsWith('E2E-clip-4-')), JSON.stringify([c4s.exportStatus, j4.status, j4.error]))

// cleanup
for (const f of fs.readdirSync(cancelledFile)) if (f.startsWith('E2E-clip-')) fs.unlinkSync(cancelledFile + '//' + f)
await invoke('delete_project', { id: pid })
await invoke('delete_project', { id: pid2 })
const after = (await invoke('list_clips')).v.filter((c) => c.projectId === pid || c.projectId === pid2)
check('delete_project cascades to clips', after.length === 0)

const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} passed`)
ws.close()
process.exit(failed ? 1 : 0)
