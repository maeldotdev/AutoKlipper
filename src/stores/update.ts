import { create } from 'zustand'
import { IS_MOCK_BACKEND } from '@/services'
import { toast } from '@/stores/ui'

export interface UpdateInfo {
  version: string
  notes: string | null
}

interface UpdateStore {
  available: UpdateInfo | null
  checking: boolean
  installing: boolean
  dismissed: boolean
  /** `quiet` is the start-up check: it says nothing unless there is something new. */
  check: (quiet?: boolean) => Promise<void>
  install: () => Promise<void>
  dismiss: () => void
}

const invoke = async <T>(cmd: string): Promise<T> => (await import('@tauri-apps/api/core')).invoke<T>(cmd)

export const useUpdate = create<UpdateStore>((set, get) => ({
  available: null,
  checking: false,
  installing: false,
  dismissed: false,
  check: async (quiet = false) => {
    if (IS_MOCK_BACKEND || get().checking) return
    set({ checking: true })
    try {
      const found = await invoke<UpdateInfo | null>('check_update')
      set({ available: found, dismissed: false })
      if (!found && !quiet) toast({ kind: 'success', title: 'You have the newest version' })
    } catch (e) {
      if (!quiet) toast({ kind: 'warning', title: 'Could not check for updates', body: String(e) })
    } finally {
      set({ checking: false })
    }
  },
  install: async () => {
    set({ installing: true })
    try {
      // On success the app closes and reopens, so nothing follows.
      await invoke('install_update')
    } catch (e) {
      toast({ kind: 'warning', title: 'Not updated', body: String(e) })
      set({ installing: false })
    }
  },
  dismiss: () => set({ dismissed: true }),
}))
