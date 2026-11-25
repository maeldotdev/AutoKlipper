import type { AspectRatio, CaptionStatus, ExportStatus, PlatformId, ProjectStatus, TargetPlatform } from '@/types'

export const PLATFORMS: Record<PlatformId | 'local', { name: string; mark: string; tint: string }> = {
  youtube: { name: 'YouTube', mark: 'YT', tint: '#ff5a5a' },
  twitch: { name: 'Twitch', mark: 'TW', tint: '#a479ff' },
  kick: { name: 'Kick', mark: 'K', tint: '#53fc18' },
  tiktok: { name: 'TikTok', mark: 'TT', tint: '#2de2e6' },
  facebook: { name: 'Facebook', mark: 'FB', tint: '#4f8dff' },
  generic: { name: 'Generic stream', mark: 'URL', tint: '#9aa8c7' },
  local: { name: 'Local file', mark: 'MP4', tint: '#9aa8c7' },
}

export const TARGETS: Record<TargetPlatform, string> = {
  tiktok: 'TikTok',
  shorts: 'YouTube Shorts',
  reels: 'Instagram Reels',
  'fb-reels': 'Facebook Reels',
}

export const ASPECT_DIMS: Record<AspectRatio, { w: number; h: number; label: string; px: string }> = {
  '9:16': { w: 9, h: 16, label: 'Vertical', px: '1080 × 1920' },
  '1:1': { w: 1, h: 1, label: 'Square', px: '1080 × 1080' },
  '4:5': { w: 4, h: 5, label: 'Portrait', px: '1080 × 1350' },
  '16:9': { w: 16, h: 9, label: 'Landscape', px: '1920 × 1080' },
}

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: 'success' | 'accent' | 'danger' | 'neutral' }> = {
  ready: { label: 'Ready', tone: 'success' },
  processing: { label: 'Processing', tone: 'accent' },
  failed: { label: 'Failed', tone: 'danger' },
  draft: { label: 'Draft', tone: 'neutral' },
}

export const EXPORT_STATUS: Record<ExportStatus, { label: string; tone: 'success' | 'accent' | 'danger' | 'neutral' | 'warning' }> = {
  'not-exported': { label: 'Not exported', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'warning' },
  exporting: { label: 'Exporting', tone: 'accent' },
  exported: { label: 'Exported', tone: 'success' },
  failed: { label: 'Export failed', tone: 'danger' },
}

export const CAPTION_STATUS: Record<CaptionStatus, string> = {
  none: 'No captions',
  generated: 'Captions generated',
  styled: 'Captions styled',
}

/** Recognise a pasted URL. Returns null when it is not a valid http(s) URL. */
export function detectPlatform(raw: string): { platform: PlatformId; url: string } | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol)) return null
  const h = u.hostname.replace(/^www\.|^m\./, '')
  const platform: PlatformId =
    h.endsWith('youtube.com') || h === 'youtu.be' ? 'youtube'
    : h.endsWith('twitch.tv') ? 'twitch'
    : h.endsWith('kick.com') ? 'kick'
    : h.endsWith('tiktok.com') ? 'tiktok'
    : h.endsWith('facebook.com') || h === 'fb.watch' ? 'facebook'
    : 'generic'
  return { platform, url: u.toString() }
}
