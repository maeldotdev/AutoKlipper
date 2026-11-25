import { useCallback, useEffect, useState } from 'react'
import { GB, IS_MOCK_BACKEND, MOCK_USAGE, api, type UsageItem } from '@/services'

/** Disk usage by area. Real folder sizes in the desktop app, sample values in a browser. */
export function useStorage() {
  const [items, setItems] = useState<UsageItem[] | null>(null)
  const refresh = useCallback(async () => {
    try {
      setItems((await api.system.storageUsage()) ?? MOCK_USAGE)
    } catch {
      setItems([])
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const used = (items ?? []).reduce((a, i) => a + i.bytes, 0)
  return { items, used, refresh, real: !IS_MOCK_BACKEND, totalBytes: IS_MOCK_BACKEND ? 120 * GB : null }
}
