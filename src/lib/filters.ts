import type { Filters, Look } from '@/types'

export const NO_FILTERS: Filters = { look: 'none', strength: 0.6, sharpen: false, denoise: false, voice: false }

export const LOOKS: { value: Look; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'brighten', label: 'Brighten' },
  { value: 'vivid', label: 'Vivid' },
  { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' },
  { value: 'mono', label: 'Black and white' },
]

/** A close CSS stand-in for the export's FFmpeg filters. Sharpen, noise and voice show only in the export. */
export function previewFilter(f: Filters | null | undefined): string | undefined {
  if (!f) return undefined
  const s = f.strength
  switch (f.look) {
    case 'brighten': return `brightness(${1 + 0.15 * s}) contrast(${1 + 0.05 * s})`
    case 'vivid': return `contrast(${1 + 0.18 * s}) saturate(${1 + 0.55 * s})`
    case 'warm': return `sepia(${0.35 * s}) saturate(${1 + 0.25 * s})`
    case 'cool': return `hue-rotate(${14 * s}deg) saturate(${1 - 0.1 * s})`
    case 'mono': return `grayscale(${s}) contrast(${1 + 0.1 * s})`
    default: return undefined
  }
}
