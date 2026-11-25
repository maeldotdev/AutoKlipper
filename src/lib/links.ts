import { isTauri } from '@/lib/utils'

export type OutsideLink = 'kofi' | 'github'

const WEB: Record<OutsideLink, string> = { kofi: 'https://ko-fi.com/maeldotdev', github: 'https://github.com/MaelPlays/AutoKlipper' }

/** Open the project's Ko-fi or GitHub page in the user's own browser. */
export function openLink(which: OutsideLink): void {
  if (!isTauri()) {
    window.open(WEB[which], '_blank', 'noopener,noreferrer')
    return
  }
  // The desktop app only accepts the name; the address is fixed in the backend.
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('open_link', { which }))
}
