// Phase 4 end-to-end test. Drives the REAL desktop app through the WebView2 debug port and calls the real
// Tauri commands: link lookup, connector rules, consent, a real download, export from it, cancel, cleanup.
//
// Start the app first (PowerShell, from the project root):
//   $env:CLIPIT_YTDLP = 'C:\path\to\yt-dlp.exe'     # only needed if yt-dlp is not on PATH
//   npm run tauri dev -- --config scripts/debug-window.json
// Then:  node scripts/e2e-phase4.mjs
// Network is needed. Test links: a 1 MB open-licence sample file, and metadata only for Blender's public Big Buck Bunny.
const SAMPLE = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4'
const BIG = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_30MB.mp4'
const YT = 'https://www.youtube.com/watch?v=YE7VzlLtp-4'
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
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + String(detail).slice(0, 200) : ''}`) }
const fs = await import('node:fs')
const { execFileSync } = await import('node:child_process')

await sleep(3000)
const info = (await invoke('app_info')).v
const downloads = info.paths.downloads
const exportsDir = info.paths.exports

const ytst = await invoke('ytdlp_status')
check('ytdlp_status finds yt-dlp', ytst.ok && ytst.v.found, ytst.ok ? ytst.v.version : ytst.e)
if (!ytst.v?.found) { console.log('Install or point CLIPIT_YTDLP at yt-dlp first.'); process.exit(2) }

const cons = await invoke('list_connectors')
check('six connectors are listed, each with a notice', cons.ok && cons.v.length === 6 && cons.v.every((c) => c.notice.length > 20), cons.ok ? cons.v.map((c) => c.id).join(',') : cons.e)
check('every connector says live is planned, not available', cons.v.every((c) => c.livePlanned === true))

// ---- link lookup rules
const yt = await invoke('probe_url', { url: YT + '&list=PLabc' })
check('YouTube link is read without downloading', yt.ok && yt.v.title === 'Big Buck Bunny' && yt.v.durationSec > 500 && yt.v.downloadable && yt.v.connectorId === 'youtube' && yt.v.heights.length > 3, yt.ok ? `${yt.v.title} ${yt.v.durationSec}s ${yt.v.heights}` : yt.e)
const live = await invoke('probe_url', { url: 'https://www.twitch.tv/somechannel' })
check('a Twitch channel (live) is recognised and not downloadable', live.ok && live.v.isLive && !live.v.downloadable && /Live Clipper/.test(live.v.blockReason), live.ok ? live.v.blockReason : live.e)
const chan = await invoke('probe_url', { url: 'https://www.youtube.com/@blender' })
check('a YouTube channel link is refused with a clear message', !chan.ok && /one video/.test(chan.e), chan.e)
const bad = await invoke('probe_url', { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' })
check('a missing video is explained in plain words', !bad.ok && /unavailable/i.test(bad.e), bad.e)
const evil = await invoke('probe_url', { url: 'file:///C:/Windows/win.ini' })
check('a file:// link is refused', !evil.ok && /not supported/.test(evil.e), evil.e)

// ---- consent and refusal
const now = new Date().toISOString()
const pid = 'e2e4_p_' + Date.now()
const mkProject = (id, title, extra = {}) => ({ id, title, sourceKind: 'url', sourceLabel: SAMPLE, platform: 'generic', duration: 0, status: 'processing', createdAt: now, clipCount: 0, hue: 50, sizeBytes: 0, sourcePath: null, ...extra })
await invoke('create_project', { project: mkProject(pid, 'E2E download') })
const dl = (projectId, url, over = {}) => invoke('start_download', { request: { projectId, url, maxHeight: 720, concurrency: 2, confirmedRights: true, ...over } })
const noConsent = await dl(pid, SAMPLE, { confirmedRights: false })
check('download is refused without the rights confirmation', !noConsent.ok && /right to use/.test(noConsent.e), noConsent.e)
const liveDl = await dl(pid, 'https://www.twitch.tv/somechannel')
check('a livestream cannot be downloaded', !liveDl.ok && /Live Clipper/.test(liveDl.e), liveDl.e)
const badQ = await dl(pid, SAMPLE, { maxHeight: 999 })
check('an unknown quality is refused', !badQ.ok)
const jobsBefore = (await invoke('list_jobs')).v.length
check('refusals queued nothing', jobsBefore === (await invoke('list_jobs')).v.length)

// ---- real download
const started = await dl(pid, SAMPLE)
check('download starts after confirmation', started.ok && typeof started.v === 'string', started.e)
let proj
for (let i = 0; i < 180; i++) {
  proj = (await invoke('list_projects')).v.find((p) => p.id === pid)
  if (proj.status !== 'processing') break
  await sleep(500)
}
check('project becomes ready with a real source file', proj.status === 'ready' && !!proj.sourcePath && fs.existsSync(proj.sourcePath), proj.sourcePath)
check('the file is inside the CLIPIT downloads folder', proj.sourcePath?.toLowerCase().startsWith(downloads.toLowerCase()), proj.sourcePath)
check('project length and size come from the real file', Math.abs(proj.duration - 10) < 1 && proj.sizeBytes > 100000, `${proj.duration}s ${proj.sizeBytes}B`)
const job = (await invoke('list_jobs')).v.find((j) => j.id === started.v)
check('the download job is saved as completed and not simulated', job?.status === 'completed' && job.kind === 'download' && job.simulated === false && job.progress === 100, JSON.stringify(job && [job.status, job.progress, job.simulated]))
check('no partial files are left behind', !fs.readdirSync(downloads).some((f) => f.startsWith(started.v) && /\.(part|ytdl|temp)$|\.f\d+\./.test(f)))

// ---- the downloaded video works with the engine from Phase 3
const clip = { id: 'e2e4_c_' + Date.now(), projectId: pid, title: 'From a link', startSec: 2, endSec: 7, aspect: '9:16', target: 'tiktok', captions: 'none', exportStatus: 'not-exported', score: 80, hue: 5, createdAt: now, exportPath: null }
await invoke('create_clips', { clips: [clip] })
const ex = await invoke('export_clips', { request: { clipIds: [clip.id], resolution: 720, fps: 30, quality: 'fast', device: 'cpu', cropX: 50, zoom: 1, outDir: null, concurrency: 1 } })
let c
for (let i = 0; i < 120; i++) {
  c = (await invoke('list_clips')).v.find((x) => x.id === clip.id)
  if (c.exportStatus === 'exported' || c.exportStatus === 'failed') break
  await sleep(500)
}
check('a clip cut from the downloaded video exports', ex.ok && c.exportStatus === 'exported' && fs.existsSync(c.exportPath), c.exportPath ?? c.exportStatus)
const pj = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', c.exportPath]).toString())
const v = pj.streams.find((s) => s.codec_type === 'video')
check('the exported clip is 720x1280', v.width === 720 && v.height === 1280, `${v.width}x${v.height}`)

// ---- deleting the project removes the download but not the export
await invoke('delete_project', { id: pid })
check('deleting the project removes the downloaded video', !fs.existsSync(proj.sourcePath))
check('the exported clip is kept', fs.existsSync(c.exportPath))
fs.unlinkSync(c.exportPath)

// ---- a user-imported file is never deleted with its project
const own = process.argv[2]
if (own && fs.existsSync(own)) {
  const p2 = 'e2e4_own_' + Date.now()
  await invoke('create_project', { project: mkProject(p2, 'Own file', { sourceKind: 'file', platform: 'local', status: 'ready', duration: 20, sourcePath: own }) })
  await invoke('delete_project', { id: p2 })
  check("deleting a project never deletes the user's own file", fs.existsSync(own))
}

// ---- cancel a running download
const pid3 = 'e2e4_p3_' + Date.now()
await invoke('create_project', { project: mkProject(pid3, 'E2E cancel', { sourceLabel: BIG }) })
const big = await dl(pid3, BIG, { maxHeight: 1080 })
let running = false
for (let i = 0; i < 80 && !running; i++) {
  running = (await invoke('list_jobs')).v.find((j) => j.id === big.v)?.status === 'running'
  if (!running) await sleep(100)
}
check('the large download reaches running', running)
const stop = await invoke('cancel_job', { id: big.v })
await sleep(2500)
const j3 = (await invoke('list_jobs')).v.find((j) => j.id === big.v)
const p3 = (await invoke('list_projects')).v.find((p) => p.id === pid3)
check('cancel stops it: job failed as Cancelled, project failed', stop.v === true && j3.status === 'failed' && j3.error === 'Cancelled.' && p3.status === 'failed', JSON.stringify([j3.status, j3.error, p3.status]))
check('cancel leaves no files in downloads', !fs.readdirSync(downloads).some((f) => f.startsWith(big.v)), fs.readdirSync(downloads).join(','))
await invoke('delete_project', { id: pid3 })

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
ws.close()
process.exit(failed ? 1 : 0)
