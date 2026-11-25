import { Suspense, lazy, useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ALL_NAV, NAV_MAIN } from '@/app/routes'
import { ToastViewport } from '@/components/ui/Overlays'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { accentForeground, useSettings } from '@/stores/settings'
import { useLibrary } from '@/stores/library'
import { useLive } from '@/stores/live'
import { useUi } from '@/stores/ui'
import { CommandPalette } from './CommandPalette'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'

const SetupWizard = lazy(() => import('@/components/SetupWizard').then((m) => ({ default: m.SetupWizard })))

function useApplySettings() {
  const { theme, accent, density, motion: m } = useSettings()
  useEffect(() => {
    const r = document.documentElement
    r.dataset.theme = theme
    r.dataset.density = density
    r.dataset.motion = m === 'off' ? 'off' : 'on'
    r.style.setProperty('--accent', accent)
    r.style.setProperty('--accent-fg', accentForeground(accent))
    r.style.setProperty('--glow', `color-mix(in oklab, ${accent} 11%, transparent)`)
  }, [theme, accent, density, m])
}

function useShortcuts() {
  const nav = useNavigate()
  const set = useSettings((s) => s.set)
  const setPalette = useUi((s) => s.setPalette)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        setPalette(true)
      } else if (k === 'b') {
        e.preventDefault()
        set({ sidebarCollapsed: !useSettings.getState().sidebarCollapsed })
      } else if (k === ',') {
        e.preventDefault()
        nav('/settings')
      } else if (/^[1-9]$/.test(k)) {
        const target = k === '9' ? ALL_NAV[ALL_NAV.length - 1] : NAV_MAIN[Number(k) - 1]
        if (target) {
          e.preventDefault()
          nav(target.path)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nav, set, setPalette])
}

export function AppShell() {
  useApplySettings()
  useShortcuts()
  const setupNeeded = useSettings((s) => !s.setupDone)
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
    try {
      localStorage.setItem('clipit.lastPath', pathname)
    } catch {
      /* storage unavailable: startup falls back to the dashboard */
    }
  }, [pathname])
  const loadLib = useLibrary((s) => s.load)
  const loadLive = useLive((s) => s.load)
  useEffect(() => {
    void loadLib()
    void loadLive()
  }, [loadLib, loadLive])

  return (
    <TooltipProvider>
      <div className="atmosphere flex h-full flex-col overflow-hidden">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto" id="main">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={pathname.startsWith('/editor') ? '/editor' : pathname}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full"
                >
                  <Suspense fallback={null}>
                    <Outlet />
                  </Suspense>
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>
      </div>
      <CommandPalette />
      {setupNeeded ? <Suspense fallback={null}><SetupWizard /></Suspense> : null}
      <ToastViewport />
    </TooltipProvider>
  )
}
