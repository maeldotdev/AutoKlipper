import type { CaptionFont, CaptionPreset, CaptionStyle, Template } from '@/types'

export const FONT_STACKS: Record<CaptionFont, { label: string; css: string }> = {
  geist: { label: 'Geist', css: 'var(--font-sans)' },
  'geist-mono': { label: 'Cascadia Mono', css: 'var(--font-mono)' },
  serif: { label: 'Cormorant Garamond', css: 'var(--font-serif)' },
  impact: { label: 'Anton', css: 'var(--font-impact)' },
}

export const BASE_STYLE: CaptionStyle = {
  font: 'geist',
  size: 50,
  weight: 700,
  uppercase: false,
  color: '#ffffff',
  highlightColor: '#ffd84a',
  outlineWidth: 0,
  outlineColor: '#000000',
  shadow: 2,
  bgEnabled: false,
  bgColor: '#0b1020',
  bgOpacity: 0.7,
  radius: 8,
  letterSpacing: 0,
  lineHeight: 1.15,
  align: 'center',
  posY: 76,
  maxWords: 4,
  maxLines: 2,
  animSpeed: 1,
  animation: 'word-reveal',
  highlight: 'active-word',
}

const mk = (patch: Partial<CaptionStyle>): CaptionStyle => ({ ...BASE_STYLE, ...patch })

export const BUILT_IN_PRESETS: CaptionPreset[] = [
  {
    id: 'bold-creator',
    name: 'Bold Creator',
    blurb: 'Heavy type, hard outline, keyword pops.',
    builtIn: true,
    style: mk({
      font: 'geist', weight: 900, uppercase: true, size: 60, color: '#ffffff', highlightColor: '#ffd84a',
      outlineWidth: 7, outlineColor: '#000000', shadow: 4, letterSpacing: -1, lineHeight: 1.02,
      posY: 70, maxWords: 3, maxLines: 2, animation: 'pop-in', highlight: 'keywords', animSpeed: 1.2,
    }),
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    blurb: 'Colour fills each word as it is spoken.',
    builtIn: true,
    style: mk({
      font: 'geist', weight: 800, size: 54, color: '#ffffff', highlightColor: '#22d3ee',
      outlineWidth: 5, outlineColor: '#05121f', shadow: 3, posY: 72, maxWords: 4, maxLines: 2,
      animation: 'karaoke', highlight: 'karaoke-fill', animSpeed: 1,
    }),
  },
  {
    id: 'minimal',
    name: 'Minimal',
    blurb: 'Quiet lower-third text, soft fade.',
    builtIn: true,
    style: mk({
      font: 'geist', weight: 500, size: 40, color: '#f4f6fb', highlightColor: '#f4f6fb',
      outlineWidth: 0, shadow: 3, posY: 84, maxWords: 7, maxLines: 2, animation: 'fade', highlight: 'none', animSpeed: 0.9,
    }),
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    blurb: 'Serif titles, wide tracking, slow dissolve.',
    builtIn: true,
    style: mk({
      font: 'serif', weight: 600, size: 52, color: '#f3ead8', highlightColor: '#f3ead8',
      outlineWidth: 0, shadow: 4, letterSpacing: 8, lineHeight: 1.2, posY: 88, maxWords: 8, maxLines: 2,
      animation: 'fade', highlight: 'none', animSpeed: 0.6,
    }),
  },
  {
    id: 'podcast',
    name: 'Podcast',
    blurb: 'Boxed lines for talking heads, key words lit.',
    builtIn: true,
    style: mk({
      font: 'geist', weight: 650, size: 42, color: '#ffffff', highlightColor: '#7fb2ff',
      outlineWidth: 0, shadow: 0, bgEnabled: true, bgColor: '#0b1020', bgOpacity: 0.78, radius: 10,
      posY: 80, maxWords: 6, maxLines: 2, animation: 'keyword-emphasis', highlight: 'keywords',
    }),
  },
  {
    id: 'gaming',
    name: 'Gaming',
    blurb: 'Impact type, fast scale hits, lime highlight.',
    builtIn: true,
    style: mk({
      font: 'impact', weight: 400, uppercase: true, size: 68, color: '#ffffff', highlightColor: '#b6ff3b',
      outlineWidth: 7, outlineColor: '#0b0f1a', shadow: 6, letterSpacing: 2, lineHeight: 1.0, posY: 66,
      maxWords: 3, maxLines: 2, animation: 'scale-emphasis', highlight: 'active-word', animSpeed: 1.4,
    }),
  },
]

export const ANIMATIONS: { id: CaptionStyle['animation']; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'word-reveal', label: 'Word-by-word reveal' },
  { id: 'karaoke', label: 'Karaoke highlight' },
  { id: 'pop-in', label: 'Pop-in' },
  { id: 'scale-emphasis', label: 'Scale emphasis' },
  { id: 'fade', label: 'Fade' },
  { id: 'slide-up', label: 'Slide up' },
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'keyword-emphasis', label: 'Keyword emphasis' },
]

export const HIGHLIGHTS: { id: CaptionStyle['highlight']; label: string }[] = [
  { id: 'none', label: 'No highlight' },
  { id: 'active-word', label: 'Active word' },
  { id: 'keywords', label: 'Keywords only' },
  { id: 'karaoke-fill', label: 'Karaoke fill' },
]

const tpl = (kind: Template['kind'], id: string, name: string, blurb: string, patch: Partial<CaptionStyle>): Template => ({
  id, kind, name, blurb, patch, builtIn: true,
})

export const BUILT_IN_TEMPLATES: Template[] = [
  ...BUILT_IN_PRESETS.map((p) => tpl('caption', `cap-${p.id}`, p.name, p.blurb, p.style)),
  tpl('caption', 'cap-headline', 'Headline block', 'Two big lines on a solid box.', {
    font: 'geist', weight: 800, size: 56, bgEnabled: true, bgColor: '#4d8dff', bgOpacity: 1, radius: 6,
    outlineWidth: 0, shadow: 0, color: '#06101f', uppercase: true, maxWords: 4, posY: 74, animation: 'slide-up', highlight: 'none',
  }),
  tpl('caption', 'cap-lowerthird', 'Clean lower third', 'Small, left aligned, no motion.', {
    font: 'geist', weight: 600, size: 36, align: 'left', posY: 88, maxWords: 8, animation: 'none', highlight: 'none', shadow: 3, outlineWidth: 0,
  }),

  ...[
    ['word-reveal', 'Word reveal', 'Each word appears on its timestamp.'],
    ['karaoke', 'Karaoke', 'Spoken word changes colour.'],
    ['pop-in', 'Pop-in', 'Words overshoot and settle.'],
    ['scale-emphasis', 'Scale emphasis', 'Active word grows slightly.'],
    ['fade', 'Fade', 'Soft opacity in and out.'],
    ['slide-up', 'Slide up', 'Words rise into place.'],
    ['typewriter', 'Typewriter', 'Letters type out in sequence.'],
    ['keyword-emphasis', 'Keyword emphasis', 'Only marked keywords animate.'],
  ].map(([id, name, blurb]) => tpl('animation', `anim-${id}`, name, blurb, { animation: id as CaptionStyle['animation'] })),

  tpl('typography', 'type-heavy', 'Heavy sans', 'Geist 900, tight tracking.', { font: 'geist', weight: 900, letterSpacing: -1, uppercase: false }),
  tpl('typography', 'type-light', 'Light sans', 'Geist 400, relaxed.', { font: 'geist', weight: 400, letterSpacing: 0, uppercase: false }),
  tpl('typography', 'type-mono', 'Mono tech', 'Mono 600.', { font: 'geist-mono', weight: 600, letterSpacing: 0, uppercase: false }),
  tpl('typography', 'type-serif', 'Editorial serif', 'Cormorant 600, tracked.', { font: 'serif', weight: 600, letterSpacing: 8, uppercase: false }),
  tpl('typography', 'type-impact', 'Impact poster', 'Anton, capitals.', { font: 'impact', weight: 400, letterSpacing: 2, uppercase: true }),

  tpl('highlight', 'hl-marker', 'Marker keywords', 'Yellow on marked keywords.', { highlight: 'keywords', highlightColor: '#ffd84a' }),
  tpl('highlight', 'hl-active', 'Active word', 'Blue on the spoken word.', { highlight: 'active-word', highlightColor: '#4d8dff' }),
  tpl('highlight', 'hl-fill', 'Karaoke fill', 'Cyan fill that sweeps across.', { highlight: 'karaoke-fill', highlightColor: '#22d3ee' }),
  tpl('highlight', 'hl-lime', 'Lime hit', 'Lime on the spoken word.', { highlight: 'active-word', highlightColor: '#b6ff3b' }),
  tpl('highlight', 'hl-none', 'No highlight', 'Flat colour, no emphasis.', { highlight: 'none' }),
]

export const SAMPLE_PREVIEW_TEXT = 'That was the cleanest run I have ever had'
