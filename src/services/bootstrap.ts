import { IS_MOCK_BACKEND, api } from '@/services'
import { useAi } from '@/stores/ai'
import { toast } from '@/stores/ui'
import { useLive } from '@/stores/live'
import type { LiveUpdate } from '@/services'
import { useLibrary, type JobEvent } from '@/stores/library'
import { setRuntimeDefaults, useSettings } from '@/stores/settings'

const data = (s: object) => Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v !== 'function'))

/**
 * Runs once before the UI renders. Wires error logging, loads settings from the
 * backend settings file (source of truth in the desktop app) and writes changes back.
 */
export async function bootstrap(): Promise<void> {
  window.addEventListener('error', (e) => api.system.log('error', `${e.message} (${e.filename}:${e.lineno})`))
  window.addEventListener('unhandledrejection', (e) => api.system.log('error', `Unhandled rejection: ${String(e.reason)}`))
  if (IS_MOCK_BACKEND) return

  try {
    const { listen } = await import('@tauri-apps/api/event')
    await listen<JobEvent>('job-update', (e) => useLibrary.getState().applyJobEvent(e.payload))
    await listen<LiveUpdate>('live-update', (e) => useLive.getState().applyUpdate(e.payload))
    // A clicked Windows notification, and post text written in the background.
    await listen<string>('open-route', (e) => { if (e.payload.startsWith('/')) location.hash = e.payload })
    await listen<{ clipId: string; post: string | null }>('clip-post', (e) => useLibrary.getState().applyPost(e.payload.clipId, e.payload.post))
    const info = await api.system.info()
    const stored = await api.system.loadSettings()
    if (info) {
      if (info.paths.warning) toast({ kind: 'error', title: 'Using the default folder', body: info.paths.warning })
      // Real folders replace the placeholder paths the first time only.
      const runtime = { exportFolder: info.paths.exports, modelFolder: info.paths.models }
      setRuntimeDefaults(runtime)
      const missing = Object.fromEntries(Object.entries(runtime).filter(([k]) => !(k in stored)))
      // The settings file decides whether setup was done, not what the web view remembers.
      useSettings.setState({ ...runtime, setupDone: false, ...stored })
      if (Object.keys(missing).length) await api.system.patchSettings(missing)
      api.system.log('info', `UI started, backend ${info.version}, schema v${info.schemaVersion}`)
      void useAi.getState().refresh()
    } else {
      useSettings.setState(stored)
    }

    let prev = data(useSettings.getState()) as Record<string, unknown>
    let timer: ReturnType<typeof setTimeout> | undefined
    useSettings.subscribe((state) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const cur = data(state) as Record<string, unknown>
        const diff = Object.fromEntries(Object.entries(cur).filter(([k, v]) => v !== prev[k]))
        prev = cur
        if (Object.keys(diff).length) api.system.patchSettings(diff).catch((e) => api.system.log('error', `settings save failed: ${String(e)}`))
      }, 300)
    })
  } catch (e) {
    api.system.log('error', `bootstrap failed: ${String(e)}`)
  }
}
