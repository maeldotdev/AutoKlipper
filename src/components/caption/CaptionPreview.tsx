import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref, type RefObject } from 'react'
import { SplitPicture, type FrameChange } from '@/components/editor/SplitLayout'
import { Movable } from '@/components/caption/Movable'
import { previewFilter } from '@/lib/filters'
import { seam } from '@/lib/split'
import { ASPECT_DIMS } from '@/lib/labels'
import { clamp } from '@/lib/utils'
import { FONT_STACKS } from '@/theme/captionPresets'
import { usePlayhead } from '@/stores/playhead'
import { centreAt, cropPosition, type TrackPoint } from '@/lib/reframe'
import type { AspectRatio, CaptionSegment, CaptionStyle, CaptionWord, Filters, Split, TextLayout, TextPlace } from '@/types'

const hexToRgba = (hex: string, a: number) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1)
const easeOut = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3

/** Outline built from a ring of text-shadows so it works for any font and with clipping. */
function textShadow(s: CaptionStyle): string {
  const parts: string[] = []
  if (s.outlineWidth > 0) {
    const r = s.outlineWidth * 0.05
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      parts.push(`${(Math.cos(a) * r).toFixed(3)}cqh ${(Math.sin(a) * r).toFixed(3)}cqh 0 ${s.outlineColor}`)
    }
  }
  if (s.shadow > 0) parts.push(`0 ${s.shadow * 0.07}cqh ${s.shadow * 0.14}cqh rgb(0 0 0 / 0.6)`)
  return parts.length ? parts.join(', ') : 'none'
}

interface Pick {
  seg: CaptionSegment
  idx: number
  words: CaptionWord[]
  offset: number
}
function pick(segments: CaptionSegment[], s: CaptionStyle, t: number): Pick | null {
  const seg = segments.find((x) => t >= x.start - 0.08 && t <= x.end + 0.35)
  if (!seg) return null
  let idx = 0
  seg.words.forEach((w, i) => {
    if (w.start <= t) idx = i
  })
  const size = Math.max(1, s.maxWords * s.maxLines)
  const page = Math.floor(idx / size)
  return { seg, idx, words: seg.words.slice(page * size, (page + 1) * size), offset: page * size }
}

const REVEAL: CaptionStyle['animation'][] = ['word-reveal', 'pop-in', 'slide-up', 'typewriter']

function wordStyle(w: CaptionWord, s: CaptionStyle, t: number, segFade: number): { css: CSSProperties; text: string } {
  const sp = Math.max(0.3, s.animSpeed)
  const since = (t - w.start) * sp
  const started = t >= w.start
  const active = t >= w.start && t < w.end + 0.06
  let opacity = 1
  let scale = 1
  let ty = 0
  let text = w.text
  let visibility: CSSProperties['visibility'] = 'visible'

  if (REVEAL.includes(s.animation) && !started) visibility = 'hidden'

  switch (s.animation) {
    case 'word-reveal':
      opacity = easeOut(since / 0.14)
      break
    case 'pop-in':
      scale = since < 0.12 ? lerp(0.55, 1.14, since / 0.12) : lerp(1.14, 1, (since - 0.12) / 0.14)
      opacity = clamp(since / 0.06, 0, 1)
      break
    case 'slide-up':
      ty = lerp(0.35, 0, easeOut(since / 0.22))
      opacity = easeOut(since / 0.18)
      break
    case 'typewriter': {
      const n = Math.ceil(clamp((t - w.start) / Math.max(0.12, (w.end - w.start) * 0.8), 0, 1) * w.text.length)
      text = w.text.slice(0, n)
      break
    }
    case 'scale-emphasis':
      scale = active ? lerp(1, 1.2, easeOut(since / 0.12)) : 1
      break
    case 'keyword-emphasis':
      scale = w.keyword && started ? lerp(1, 1.16, easeOut(since / 0.2)) : 1
      break
    case 'fade':
      opacity = segFade
      break
    default:
      break
  }

  let color = s.color
  if (s.highlight === 'active-word' && active) color = s.highlightColor
  if (s.highlight === 'keywords' && w.keyword) color = s.highlightColor
  if (s.animation === 'keyword-emphasis' && w.keyword && started) color = s.highlightColor

  return {
    text,
    css: {
      display: 'inline-block',
      position: 'relative',
      opacity,
      visibility,
      color,
      transform: `translateY(${ty}em) scale(${scale})`,
      transformOrigin: '50% 70%',
      padding: '0 0.12em',
      // transitions on colour would lag behind the playhead while scrubbing
    },
  }
}

/** Pure renderer: given segments, style and time, draw the caption block. Uses cqh, so parent must be a size container. */
export function CaptionLayer({
  segments, style: s, time, onWordClick, place, onPlace,
}: {
  segments: CaptionSegment[]
  style: CaptionStyle
  time: number
  onWordClick?: (segId: string, wordId: string) => void
  /** Set when the user dragged or resized the captions. */
  place?: TextPlace | null
  onPlace?: (p: TextPlace) => void
}) {
  const p = pick(segments, s, time)
  if (!p) return null
  const sp = Math.max(0.3, s.animSpeed)
  const segFade = clamp(Math.min((time - p.seg.start + 0.08) / (0.4 / sp), (p.seg.end + 0.35 - time) / (0.3 / sp)), 0, 1)

  const lines: CaptionWord[][] = []
  for (let i = 0; i < p.words.length; i += s.maxWords) lines.push(p.words.slice(i, i + s.maxWords))

  const justify = s.align === 'left' ? 'flex-start' : s.align === 'right' ? 'flex-end' : 'center'
  const shadow = textShadow(s)

  return (
    <Movable
      label="Captions"
      anchor="middle"
      place={place ?? null}
      onChange={onPlace}
      className="w-[90%]"
      style={{
        left: `${(place?.x ?? 50) - 45}%`,
        top: `${place?.y ?? s.posY}%`,
        transform: 'translateY(-50%)',
        fontFamily: FONT_STACKS[s.font].css,
        fontSize: `${(s.size / 10) * (place?.scale ?? 1)}cqh`,
        fontWeight: s.weight,
        lineHeight: s.lineHeight,
        letterSpacing: `${s.letterSpacing / 100}em`,
        textTransform: s.uppercase ? 'uppercase' : 'none',
        textAlign: s.align,
        display: 'flex',
        justifyContent: place ? 'center' : justify,
      }}
    >
      <div
        style={{
          background: s.bgEnabled ? hexToRgba(s.bgColor, s.bgOpacity) : 'transparent',
          padding: s.bgEnabled ? '0.22em 0.5em' : 0,
          borderRadius: `${s.radius * 0.12}cqh`,
          maxWidth: '100%',
        }}
      >
        {lines.map((line, li) => (
          <div key={li} style={{ display: 'flex', justifyContent: justify, flexWrap: 'wrap' }}>
            {line.map((w) => {
              const { css, text } = wordStyle(w, s, time, segFade)
              const fill = s.highlight === 'karaoke-fill'
              const prog = clamp((time - w.start) / Math.max(0.05, w.end - w.start), 0, 1)
              return (
                <span
                  key={w.id}
                  onClick={onWordClick ? () => onWordClick(p.seg.id, w.id) : undefined}
                  className={onWordClick ? 'pointer-events-auto cursor-pointer' : undefined}
                  style={{ ...css, textShadow: shadow }}
                >
                  {text}
                  {fill ? (
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: 0,
                        padding: '0 0.12em',
                        color: s.highlightColor,
                        textShadow: shadow,
                        clipPath: `inset(0 ${100 - prog * 100}% 0 0)`,
                        whiteSpace: 'pre',
                      }}
                    >
                      {text}
                    </span>
                  ) : null}
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </Movable>
  )
}

/** Fits a frame of the given aspect ratio inside its parent. */
export function Frame({
  aspect, children, className, frameRef,
}: {
  aspect: AspectRatio
  children: ReactNode
  className?: string
  frameRef?: Ref<HTMLDivElement>
}) {
  const d = ASPECT_DIMS[aspect]
  const r = d.w / d.h
  return (
    <div className={`flex h-full w-full items-center justify-center ${className ?? ''}`} style={{ containerType: 'size' }}>
      <div
        data-frame
        ref={frameRef}
        className="relative overflow-hidden rounded-md bg-black shadow-[0_20px_50px_-20px_rgb(0_0_0/0.8)] ring-1 ring-white/10"
        style={{ width: `min(100cqw, calc(100cqh * ${r}))`, aspectRatio: String(r), containerType: 'size' }}
      >
        {children}
      </div>
    </div>
  )
}

/** Full preview: backdrop (loaded video or placeholder) + live caption layer. */
export function PreviewStage({
  aspect, segments, style, videoSrc, videoRef, cropX = 50, zoom = 1, track, trackOffset = 0, split, onFrame, hook, hue = 222, onWordClick, staticTime, layout, onLayout, filters,
}: {
  aspect: AspectRatio
  segments: CaptionSegment[]
  style: CaptionStyle
  videoSrc?: string | null
  videoRef?: Ref<HTMLVideoElement>
  cropX?: number
  zoom?: number
  /** Face path and the source time at playhead zero. */
  track?: TrackPoint[] | null
  trackOffset?: number
  /** Gaming layout. Used on vertical clips only. */
  split?: Split | null
  /** Lets the user drag the game and the camera in the gaming layout. */
  onFrame?: (c: FrameChange) => void
  /** Headline across the top, as the export draws it. */
  hook?: string | null
  hue?: number
  onWordClick?: (segId: string, wordId: string) => void
  staticTime?: number
  /** Dragged text positions, and the way to change them. */
  layout?: TextLayout | null
  onLayout?: (l: TextLayout) => void
  filters?: Filters | null
}) {
  const live = usePlayhead((s) => s.time)
  const time = staticTime ?? live
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const ratio = ASPECT_DIMS[aspect].w / ASPECT_DIMS[aspect].h
  const pos = track?.length && dims ? cropPosition(centreAt(track, trackOffset + time), dims.w, dims.h, ratio, zoom) : cropX / 100
  const stacked = split && split.share > 0 && aspect === '9:16' ? split : null
  const ownRef = useRef<HTMLVideoElement>(null)
  const sourceRef = (videoRef as RefObject<HTMLVideoElement | null> | undefined) ?? ownRef
  // Captions sit where the game and the camera meet, as in the export.
  const captionStyle = stacked ? { ...style, posY: seam(stacked) } : style
  return (
    <Frame aspect={aspect}>
      {videoSrc ? (
        <div className="absolute inset-0" style={{ filter: previewFilter(filters) }}>
        <video
          ref={sourceRef}
          src={videoSrc}
          playsInline
          muted={false}
          onLoadedMetadata={(e) => setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          className="absolute max-w-none object-cover"
          // Zoom by growing the element, then shift it: the visible part equals FFmpeg's crop window.
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, left: `${-(zoom - 1) * pos * 100}%`, top: `${-(zoom - 1) * 50}%`, objectPosition: `${pos * 100}% 50%` }}
        />
        {stacked ? <SplitPicture videoRef={sourceRef} split={stacked} cropX={cropX} zoom={zoom} onChange={onFrame} /> : null}
        </div>
      ) : (
        <div className="thumb absolute inset-0" style={{ ['--h' as string]: hue } as CSSProperties}>
          <div className="absolute inset-0 flex items-start justify-center pt-[6%]">
            <span className="relative z-[1] rounded bg-black/45 px-2 py-0.5 text-meta text-white/70">Placeholder frame, load a video to test</span>
          </div>
        </div>
      )}
      <CaptionLayer segments={segments} style={captionStyle} time={time} onWordClick={onWordClick} place={layout?.cap} onPlace={onLayout ? (cap) => onLayout({ ...layout, cap }) : undefined} />
      {hook?.trim() ? (
        <Movable
          label="Hook title"
          anchor="top"
          place={layout?.hook ?? null}
          onChange={onLayout ? (h) => onLayout({ ...layout, hook: h }) : undefined}
          className="flex w-[92%] justify-center"
          style={{ left: `${(layout?.hook?.x ?? 50) - 46}%`, top: `${layout?.hook?.y ?? 7}%` }}
        >
          <p className="break-words text-center font-bold leading-tight text-white [paint-order:stroke_fill]" style={{ fontSize: `${4.3 * (layout?.hook?.scale ?? 1)}cqh`, WebkitTextStroke: `${0.8 * (layout?.hook?.scale ?? 1)}cqh black` }}>{hook.trim()}</p>
        </Movable>
      ) : null}
    </Frame>
  )
}

/** Small looping preview used in galleries; only animates while hovered. */
export function MiniCaption({
  segments, style, aspect = '9:16', hue = 222, animate,
}: {
  segments: CaptionSegment[]
  style: CaptionStyle
  aspect?: AspectRatio
  hue?: number
  animate: boolean
}) {
  const [t, setT] = useState(0)
  const start = segments[0]?.start ?? 0
  const end = segments[segments.length - 1]?.end ?? 3
  const raf = useRef(0)
  useEffect(() => {
    if (!animate) {
      setT(start + (end - start) * 0.62)
      return
    }
    const t0 = performance.now()
    const loop = (now: number) => {
      const len = end - start + 0.8
      setT(start + (((now - t0) / 1000) % len))
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf.current)
  }, [animate, start, end])
  return (
    <Frame aspect={aspect}>
      <div className="thumb absolute inset-0" style={{ ['--h' as string]: hue } as CSSProperties} />
      <CaptionLayer segments={segments} style={style} time={t} />
    </Frame>
  )
}

/** One short segment used by gallery previews. */
export const DEMO_SEGMENTS: CaptionSegment[] = (() => {
  const words = 'That was the cleanest run I have ever had'.split(' ')
  let t = 0
  const ws: CaptionWord[] = words.map((text, i) => {
    const start = t
    const end = t + 0.3
    t += 0.34
    return { id: `d${i}`, text, start, end, keyword: ['cleanest', 'run'].includes(text) || undefined }
  })
  return [{ id: 'demo', start: 0, end: t, words: ws }]
})()
