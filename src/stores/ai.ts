import { create } from 'zustand'
import { IS_MOCK_BACKEND, api, type AiStatus } from '@/services'
import { useSettings } from '@/stores/settings'

/** What the local AI can do right now. Refreshed at startup and after setup or download jobs. */
interface AiStore {
  status: AiStatus | null
  loading: boolean
  refresh: () => Promise<void>
}

export const useAi = create<AiStore>((set) => ({
  status: null,
  loading: false,
  refresh: async () => {
    if (IS_MOCK_BACKEND) return
    set({ loading: true })
    try {
      set({ status: await api.ai.status(), loading: false })
    } catch {
      set({ loading: false })
    }
  },
}))

/** True when the chosen Whisper model is installed and the environment works. */
export function aiReady(): boolean {
  const s = useAi.getState().status
  return !!s?.ready && s.models.includes(useSettings.getState().model)
}

export function useAiReady(): boolean {
  const status = useAi((s) => s.status)
  const model = useSettings((s) => s.model)
  return !!status?.ready && status.models.includes(model)
}
