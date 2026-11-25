import * as D from '@radix-ui/react-dialog'
import { Clapperboard, FolderKanban, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ALL_NAV } from '@/app/routes'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/utils'

interface Result {
  id: string
  label: string
  group: string
  icon: ReactNode
  to: string
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPalette)
  const projects = useLibrary((s) => s.projects)
  const clips = useLibrary((s) => s.clips)
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)

  const results = useMemo<Result[]>(() => {
    const all: Result[] = [
      ...ALL_NAV.map((n) => ({ id: n.path, label: n.label, group: 'Pages', icon: <n.icon size={16} />, to: n.path })),
      ...projects.map((p) => ({ id: p.id, label: p.title, group: 'Projects', icon: <FolderKanban size={16} />, to: `/clips?project=${p.id}` })),
      ...clips.map((c) => ({ id: c.id, label: c.title, group: 'Clips', icon: <Clapperboard size={16} />, to: `/editor/${c.id}` })),
    ]
    const s = q.trim().toLowerCase()
    return (s ? all.filter((r) => r.label.toLowerCase().includes(s)) : all.filter((r) => r.group === 'Pages')).slice(0, 12)
  }, [q, projects, clips])

  const go = (r: Result | undefined) => {
    if (!r) return
    setOpen(false)
    nav(r.to)
  }

  return (
    <D.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setQ('')
          setActive(0)
        }
      }}
    >
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px]" />
        <D.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[18%] z-[61] w-[min(92vw,560px)] -translate-x-1/2 overflow-hidden rounded-lg border border-line2 bg-s1 shadow-[var(--shadow-pop)]"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') go(results[active])
          }}
        >
          <D.Title className="sr-only">Search</D.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search size={16} className="text-t3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
              placeholder="Search projects, clips, pages"
              aria-label="Search"
              className="h-12 flex-1 bg-transparent text-section text-t1 outline-none placeholder:text-t3"
            />
          </div>
          <ul className="max-h-80 overflow-y-auto p-1.5" role="listbox">
            {results.length === 0 ? (
              <li className="px-3 py-8 text-center text-body text-t2">No match for “{q}”.</li>
            ) : (
              results.map((r, i) => (
                <li
                  key={r.group + r.id}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={cn('flex h-9 items-center gap-3 rounded-md px-3 text-body', i === active ? 'bg-s3 text-t1' : 'text-t2')}
                >
                  {r.icon}
                  <span className="flex-1 truncate">{r.label}</span>
                  <span className="text-meta text-t3">{r.group}</span>
                </li>
              ))
            )}
          </ul>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
