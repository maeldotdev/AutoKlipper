import { create } from 'zustand'
import { uid } from '@/lib/utils'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'
export interface Toast {
  id: string
  kind: ToastKind
  title: string
  body?: string
}
export interface Notice {
  id: string
  title: string
  body: string
  at: string
  read: boolean
  kind: ToastKind
}

/** Source handed from Dashboard / Live to the Auto Clipper. */
export interface SourceDraft {
  kind: 'file' | 'url'
  name: string
  url?: string
  /** Absolute path chosen with the native dialog (desktop app). */
  path?: string
  objectUrl?: string
  sizeBytes?: number
  duration?: number
}

interface UiStore {
  toasts: Toast[]
  notices: Notice[]
  paletteOpen: boolean
  draft: SourceDraft | null
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  notify: (n: Omit<Notice, 'id' | 'at' | 'read'>) => void
  markAllRead: () => void
  clearNotices: () => void
  setPalette: (open: boolean) => void
  setDraft: (d: SourceDraft | null) => void
}

export const useUi = create<UiStore>((set, get) => ({
  toasts: [],
  notices: [],
  paletteOpen: false,
  draft: null,
  toast: (t) => {
    const id = uid('t')
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 7000 : 4200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  notify: (n) =>
    set((s) => ({ notices: [{ ...n, id: uid('n'), at: new Date().toISOString(), read: false }, ...s.notices].slice(0, 30) })),
  markAllRead: () => set((s) => ({ notices: s.notices.map((n) => ({ ...n, read: true })) })),
  clearNotices: () => set({ notices: [] }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setDraft: (draft) => set({ draft }),
}))

export const toast = (t: Omit<Toast, 'id'>) => useUi.getState().toast(t)
