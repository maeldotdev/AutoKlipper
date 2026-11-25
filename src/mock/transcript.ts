import type { CaptionSegment, CaptionWord } from '@/types'

/* Sample transcript. Timings are synthesised from word length, not from audio. */
const LINES: { text: string; keywords: string[] }[] = [
  { text: 'Okay so I did not expect that to work.', keywords: ['expect'] },
  { text: 'Seriously, the final boss went down in one hit.', keywords: ['boss', 'hit'] },
  { text: 'Chat, did you see that?', keywords: ['see'] },
  { text: 'That was the cleanest run I have ever had.', keywords: ['cleanest', 'run'] },
  { text: "Let's clip it and run it back.", keywords: ['clip'] },
]

export function buildSampleTranscript(): CaptionSegment[] {
  let t = 0.4
  let n = 0
  return LINES.map((line, si) => {
    const words: CaptionWord[] = line.text.split(' ').map((raw) => {
      const clean = raw.replace(/[.,?!]/g, '').toLowerCase()
      const dur = 0.2 + Math.min(raw.length, 9) * 0.035
      const w: CaptionWord = {
        id: `w${n++}`,
        text: raw,
        start: +t.toFixed(2),
        end: +(t + dur).toFixed(2),
        keyword: line.keywords.includes(clean) || undefined,
      }
      t += dur + (/[,]$/.test(raw) ? 0.28 : 0.04)
      if (/[.?!]$/.test(raw)) t += 0.35
      return w
    })
    return { id: `s${si}`, start: words[0].start, end: words[words.length - 1].end, words }
  })
}

export const SAMPLE_DURATION = 18
