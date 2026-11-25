import { lazy, type ComponentType } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/layouts/AppShell'
import { Dashboard } from '@/pages/Dashboard'
import { useSettings } from '@/stores/settings'

// Only the start page loads up front. The rest arrive when first opened.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))
const AutoClipper = page(() => import('@/pages/AutoClipper'), 'AutoClipper')
const CaptionStudio = page(() => import('@/pages/CaptionStudio'), 'CaptionStudio')
const ClipEditor = page(() => import('@/pages/ClipEditor'), 'ClipEditor')
const History = page(() => import('@/pages/History'), 'History')
const LiveClipper = page(() => import('@/pages/LiveClipper'), 'LiveClipper')
const MyClips = page(() => import('@/pages/MyClips'), 'MyClips')
const Projects = page(() => import('@/pages/Projects'), 'Projects')
const SettingsPage = page(() => import('@/pages/Settings'), 'SettingsPage')
const Templates = page(() => import('@/pages/Templates'), 'Templates')

function startPath(): string {
  try {
    const last = localStorage.getItem('clipit.lastPath')
    return useSettings.getState().startup === 'last-page' && last && !last.startsWith('/editor') ? last : '/dashboard'
  } catch {
    return '/dashboard'
  }
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={startPath()} replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/auto-clipper" element={<AutoClipper />} />
          <Route path="/live" element={<LiveClipper />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/clips" element={<MyClips />} />
          <Route path="/editor/:clipId?" element={<ClipEditor />} />
          <Route path="/caption-studio" element={<CaptionStudio />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
