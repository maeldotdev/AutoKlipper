import { Minus, Square, X, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isTauri } from '@/lib/utils'
import { Logo } from '@/components/Logo'

async function win() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

export function TitleBar() {
  const native = isTauri()
  const [max, setMax] = useState(false)

  useEffect(() => {
    if (!native) return
    let off: (() => void) | undefined
    void win().then(async (w) => {
      setMax(await w.isMaximized())
      off = await w.onResized(async () => setMax(await w.isMaximized()))
    })
    return () => off?.()
  }, [native])

  const btn = 'no-drag flex h-full w-[46px] items-center justify-center text-t2 transition-colors duration-100 hover:bg-s3 hover:text-t1'
  return (
    <div
      data-tauri-drag-region
      onDoubleClick={() => native && void win().then((w) => w.toggleMaximize())}
      className="drag flex shrink-0 items-center justify-between border-b border-line bg-chrome"
      style={{ height: 'var(--titlebar-h)' }}
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3 text-label text-t2">
        <Logo size={16} />
        <span data-tauri-drag-region className="font-medium text-t1">AutoKlipper</span>
        <span data-tauri-drag-region className="text-t3">Local video clipping studio</span>
      </div>
      {native ? (
        <div className="flex h-full">
          <button aria-label="Minimize" className={btn} onClick={() => void win().then((w) => w.minimize())}>
            <Minus size={15} />
          </button>
          <button aria-label={max ? 'Restore' : 'Maximize'} className={btn} onClick={() => void win().then((w) => w.toggleMaximize())}>
            {max ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button aria-label="Close" className={`${btn} hover:!bg-bad hover:!text-white`} onClick={() => void win().then((w) => w.close())}>
            <X size={16} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
