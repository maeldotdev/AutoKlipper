import { IS_MOCK_BACKEND } from '@/services'
import { Merge, Minus, Plus, Redo2, Scissors, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Controls'
import { Input } from '@/components/ui/Input'
import { Tip } from '@/components/ui/Tooltip'
import { cn, fmtClock } from '@/lib/utils'
import { useCaptions } from '@/stores/captions'
import { usePlayhead } from '@/stores/playhead'
import { toast } from '@/stores/ui'

export function SegmentEditor({ selected, onSelect }: { selected: { segId: string; wordId: string } | null; onSelect: (s: { segId: string; wordId: string } | null) => void }) {
  const { segments, past, future, undo, redo, editWord, toggleKeyword, shiftSegment, splitSegment, mergeNext, deleteSegment, replaceAll, resetTranscript } = useCaptions()
  const activeId = usePlayhead((s) => segments.find((x) => s.time >= x.start - 0.05 && s.time <= x.end + 0.2)?.id)
  const seek = usePlayhead((s) => s.seek)
  const real = useCaptions((s) => s.source === 'real')
  const [find, setFind] = useState('')
  const [repl, setRepl] = useState('')
  const [matchCase, setMatchCase] = useState(false)

  const hits = find
    ? segments.flatMap((s) => s.words).filter((w) => (matchCase ? w.text.includes(find) : w.text.toLowerCase().includes(find.toLowerCase()))).length
    : 0
  const isHit = (t: string) => !!find && (matchCase ? t.includes(find) : t.toLowerCase().includes(find.toLowerCase()))

  return (
    <div
      onKeyDown={(e) => {
        if (!(e.ctrlKey || e.metaKey)) return
        const k = e.key.toLowerCase()
        if (k === 'z' && !(e.target as HTMLElement).matches('input')) {
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
        } else if (k === 'y' && !(e.target as HTMLElement).matches('input')) {
          e.preventDefault()
          redo()
        }
      }}
    >
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <Input aria-label="Find" placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
          <Input aria-label="Replace with" placeholder="Replace with" value={repl} onChange={(e) => setRepl(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip active={matchCase} onClick={() => setMatchCase((v) => !v)}>Match case</Chip>
          <Button
            disabled={!find || hits === 0}
            onClick={() => {
              const n = replaceAll(find, repl, matchCase)
              toast({ kind: 'success', title: `Replaced ${n} occurrence${n === 1 ? '' : 's'}` })
            }}
          >
            Replace all
          </Button>
          <span className="text-meta text-t3">{find ? `${hits} match${hits === 1 ? '' : 'es'}` : ''}</span>
          <div className="ml-auto flex items-center gap-1">
            <Tip label="Undo" kbd="Ctrl Z">
              <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!past.length} onClick={undo}>
                <Undo2 size={16} />
              </Button>
            </Tip>
            <Tip label="Redo" kbd="Ctrl Y">
              <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!future.length} onClick={redo}>
                <Redo2 size={16} />
              </Button>
            </Tip>
            {real || IS_MOCK_BACKEND ? <Button variant="ghost" size="sm" onClick={resetTranscript}>{real ? 'Reload transcript' : 'Reset sample'}</Button> : null}
          </div>
        </div>
      </div>

      <ul className="flex flex-col gap-2 p-4">
        {segments.length === 0 ? <li className="py-6 text-center text-body text-t2">{IS_MOCK_BACKEND ? 'No segments left. Reset the sample transcript to start again.' : 'No captions for this clip yet.'}</li> : null}
        {segments.map((seg, si) => {
          const sel = selected?.segId === seg.id ? seg.words.findIndex((w) => w.id === selected.wordId) : -1
          const word = sel >= 0 ? seg.words[sel] : null
          return (
            <li key={seg.id} className={cn('rounded-lg border bg-s2 p-3 transition-colors duration-150', activeId === seg.id ? 'border-accent/60' : 'border-line')}>
              <div className="mb-2 flex items-center gap-2">
                <button type="button" onClick={() => seek(seg.start)} className="no-drag font-mono text-label text-t2 hover:text-accent" aria-label={`Seek to segment ${si + 1}`}>
                  {fmtClock(seg.start)} to {fmtClock(seg.end)}
                </button>
                <div className="ml-auto flex items-center gap-0.5">
                  <Tip label="Shift earlier by 0.1 s"><Button variant="ghost" size="icon-sm" aria-label="Shift segment earlier" onClick={() => shiftSegment(seg.id, -0.1)}><Minus size={14} /></Button></Tip>
                  <Tip label="Shift later by 0.1 s"><Button variant="ghost" size="icon-sm" aria-label="Shift segment later" onClick={() => shiftSegment(seg.id, 0.1)}><Plus size={14} /></Button></Tip>
                  <Tip label="Merge with next segment"><Button variant="ghost" size="icon-sm" aria-label="Merge with next segment" disabled={si === segments.length - 1} onClick={() => mergeNext(seg.id)}><Merge size={14} /></Button></Tip>
                  <Tip label="Delete segment"><Button variant="ghost" size="icon-sm" aria-label="Delete segment" onClick={() => deleteSegment(seg.id)}><Trash2 size={14} /></Button></Tip>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {seg.words.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => {
                      onSelect({ segId: seg.id, wordId: w.id })
                      seek(w.start)
                    }}
                    className={cn(
                      'no-drag rounded-md border px-2 py-0.5 text-body transition-colors duration-150',
                      word?.id === w.id ? 'border-accent bg-accent/18 text-t1' : 'border-transparent bg-s1 text-t1 hover:border-line2',
                      w.keyword && 'text-warn',
                      isHit(w.text) && 'ring-2 ring-cyan/60',
                    )}
                  >
                    {w.text}
                  </button>
                ))}
              </div>
              {word ? (
                <div className="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-line bg-s1 p-3">
                  <label className="flex flex-col gap-1 text-meta text-t3">
                    Word
                    <Input value={word.text} onChange={(e) => editWord(seg.id, word.id, { text: e.target.value })} className="w-36" aria-label="Word text" />
                  </label>
                  <label className="flex flex-col gap-1 text-meta text-t3">
                    Start (s)
                    <Input type="number" step="0.05" min={0} value={word.start} onChange={(e) => editWord(seg.id, word.id, { start: Math.max(0, +e.target.value) })} className="w-24 font-mono" aria-label="Word start" />
                  </label>
                  <label className="flex flex-col gap-1 text-meta text-t3">
                    End (s)
                    <Input type="number" step="0.05" min={0} value={word.end} onChange={(e) => editWord(seg.id, word.id, { end: Math.max(word.start + 0.05, +e.target.value) })} className="w-24 font-mono" aria-label="Word end" />
                  </label>
                  <Chip active={!!word.keyword} onClick={() => toggleKeyword(seg.id, word.id)}>Keyword</Chip>
                  <Button disabled={sel === 0} onClick={() => splitSegment(seg.id, sel)}>
                    <Scissors size={14} />
                    Split before word
                  </Button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
