import type { AspectRatio, CaptionStatus, Clip, ExportStatus, Job, LiveStream, Project, TargetPlatform } from '@/types'

/* Sample data for the Phase 1 prototype. Nothing here came from a real video. */
const now = Date.now()
const ago = (h: number) => new Date(now - h * 3600_000).toISOString()

export const MOCK_PROJECTS: Project[] = [
  { id: 'p1', title: 'Ranked grind, night session', sourceKind: 'url', sourceLabel: 'twitch.tv/videos/sample-1', platform: 'twitch', duration: 14520, status: 'ready', createdAt: ago(3), clipCount: 6, hue: 222, sizeBytes: 5.1e9 },
  { id: 'p2', title: 'Founder interview, episode 41', sourceKind: 'url', sourceLabel: 'youtube.com/watch?v=sample-2', platform: 'youtube', duration: 4260, status: 'ready', createdAt: ago(26), clipCount: 5, hue: 262, sizeBytes: 1.6e9 },
  { id: 'p3', title: 'Speedrun attempt 112', sourceKind: 'live', sourceLabel: 'kick.com/sample-run', platform: 'kick', duration: 9840, status: 'processing', createdAt: ago(1), clipCount: 0, hue: 168, sizeBytes: 3.4e9 },
  { id: 'p4', title: 'Ramen from scratch, cooking stream', sourceKind: 'url', sourceLabel: 'kick.com/videos/sample-4', platform: 'kick', duration: 7110, status: 'ready', createdAt: ago(52), clipCount: 4, hue: 24, sizeBytes: 2.6e9 },
  { id: 'p5', title: 'Podcast: pricing small tools', sourceKind: 'file', sourceLabel: 'pricing-small-tools.mp4', platform: 'local', duration: 3380, status: 'ready', createdAt: ago(80), clipCount: 3, hue: 196, sizeBytes: 1.2e9 },
  { id: 'p6', title: 'Studio walkthrough, raw footage', sourceKind: 'file', sourceLabel: 'walkthrough_raw_v2.mov', platform: 'local', duration: 1260, status: 'draft', createdAt: ago(120), clipCount: 0, hue: 330, sizeBytes: 0.9e9 },
  { id: 'p7', title: 'Charity stream, hour three', sourceKind: 'url', sourceLabel: 'facebook.com/watch/sample-7', platform: 'facebook', duration: 11220, status: 'failed', createdAt: ago(190), clipCount: 0, hue: 10, sizeBytes: 0 },
  { id: 'p8', title: 'Conference keynote recap', sourceKind: 'url', sourceLabel: 'youtube.com/watch?v=sample-8', platform: 'youtube', duration: 2940, status: 'ready', createdAt: ago(300), clipCount: 3, hue: 48, sizeBytes: 1.1e9 },
]

const TITLES = [
  'Final boss, one hit', 'The pricing mistake', 'Chat loses it', 'Cleanest run yet', 'Why we cut the feature',
  'Broth reveal', 'Unexpected save', 'First hire regret', 'Clutch with 3 HP', 'Noodle timing trick',
  'Keynote slip', 'Hot take on onboarding', 'Speed skip found', 'Shipping on Fridays', 'Crowd reaction',
  'Pan sear, done right', 'Two-minute demo', 'Reading the room',
]
const ASPECTS: AspectRatio[] = ['9:16', '9:16', '9:16', '1:1', '4:5', '9:16']
const TARGETS: TargetPlatform[] = ['tiktok', 'shorts', 'reels', 'tiktok', 'fb-reels', 'shorts']
const CAPS: CaptionStatus[] = ['styled', 'generated', 'styled', 'none', 'styled', 'generated']
const EXPS: ExportStatus[] = ['exported', 'not-exported', 'exported', 'queued', 'not-exported', 'failed', 'not-exported', 'exporting']

export const MOCK_CLIPS: Clip[] = (() => {
  const out: Clip[] = []
  let ti = 0
  for (const p of MOCK_PROJECTS) {
    for (let i = 0; i < p.clipCount; i++) {
      const k = ti++
      const start = Math.round((p.duration / (p.clipCount + 1)) * (i + 1))
      const len = 18 + ((k * 7) % 41)
      out.push({
        id: `c${k + 1}`,
        projectId: p.id,
        title: TITLES[k % TITLES.length],
        startSec: start,
        endSec: start + len,
        aspect: ASPECTS[k % ASPECTS.length],
        target: TARGETS[k % TARGETS.length],
        captions: CAPS[k % CAPS.length],
        exportStatus: EXPS[k % EXPS.length],
        score: 94 - ((k * 5) % 31),
        hue: (p.hue + k * 11) % 360,
        createdAt: p.createdAt,
      })
    }
  }
  return out
})()

export const MOCK_JOBS: Job[] = [
  { id: 'j1', title: 'Detect highlights', kind: 'detect', status: 'running', progress: 62, source: 'Speedrun attempt 112', startedAt: ago(0.4), durationSec: 0, simulated: true },
  { id: 'j2', title: 'Transcribe audio', kind: 'transcribe', status: 'running', progress: 28, source: 'Speedrun attempt 112', startedAt: ago(0.3), durationSec: 0, simulated: true },
  { id: 'j3', title: 'Render 6 clips', kind: 'render', status: 'completed', progress: 100, source: 'Ranked grind, night session', startedAt: ago(3), durationSec: 412, simulated: true },
  { id: 'j4', title: 'Download source', kind: 'download', status: 'completed', progress: 100, source: 'Founder interview, episode 41', startedAt: ago(26), durationSec: 188, simulated: true },
  { id: 'j5', title: 'Transcribe audio', kind: 'transcribe', status: 'completed', progress: 100, source: 'Founder interview, episode 41', startedAt: ago(25.8), durationSec: 301, simulated: true },
  { id: 'j6', title: 'Download source', kind: 'download', status: 'failed', progress: 14, source: 'Charity stream, hour three', startedAt: ago(190), durationSec: 22, error: 'The source host refused the request (HTTP 403). The video may be private or require you to sign in. Check access, then retry.', simulated: true },
  { id: 'j7', title: 'Export 3 clips', kind: 'export', status: 'completed', progress: 100, source: 'Ramen from scratch, cooking stream', startedAt: ago(50), durationSec: 96, simulated: true },
  { id: 'j8', title: 'Render 4 clips', kind: 'render', status: 'failed', progress: 71, source: 'Podcast: pricing small tools', startedAt: ago(78), durationSec: 143, error: 'Rendering stopped: not enough free disk space on the temp drive (needs about 2.4 GB). Free space or change the cache folder, then retry.', simulated: true },
  { id: 'j9', title: 'Detect highlights', kind: 'detect', status: 'completed', progress: 100, source: 'Conference keynote recap', startedAt: ago(299), durationSec: 54, simulated: true },
]

export const MOCK_STREAMS: LiveStream[] = [
  { id: 's1', platform: 'twitch', url: 'https://www.twitch.tv/example_channel', title: 'Twitch, example channel', state: 'idle', uptimeSec: 0, highlights: [] },
  { id: 's2', platform: 'youtube', url: 'https://www.youtube.com/@example/live', title: 'YouTube Live, example', state: 'idle', uptimeSec: 0, highlights: [] },
]

export const STORAGE_BREAKDOWN = [
  { id: 'clips', label: 'Exported clips', gb: 18.4 },
  { id: 'sources', label: 'Source videos', gb: 41.2 },
  { id: 'models', label: 'AI models', gb: 2.1 },
  { id: 'cache', label: 'Cache and temp', gb: 6.8 },
]
export const STORAGE_TOTAL_GB = 120

export const ACTIVITY_WEEK = [
  { day: 'Mon', clips: 4 }, { day: 'Tue', clips: 7 }, { day: 'Wed', clips: 3 }, { day: 'Thu', clips: 9 },
  { day: 'Fri', clips: 6 }, { day: 'Sat', clips: 11 }, { day: 'Sun', clips: 5 },
]
