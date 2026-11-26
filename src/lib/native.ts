import { isTauri } from './utils'
import { toast } from '@/stores/ui'

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'ts', 'flv', 'wmv']

export const hasVideoExtension = (path: string) => VIDEO_EXTENSIONS.includes(path.split('.').pop()?.toLowerCase() ?? '')
export const fileNameOf = (path: string) => path.split(/[\\/]/).pop() ?? path

/** Native folder dialog in the desktop app; explains itself in a plain browser. */
export async function pickFolder(title: string): Promise<string | null> {
  if (!isTauri()) {
    toast({ kind: 'info', title: 'Folder picker is desktop only', body: 'Run the Tauri app to open the native Windows dialog.' })
    return null
  }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const res = await open({ directory: true, multiple: false, title })
  return typeof res === 'string' ? res : null
}

/** Native file dialog for a single video. Returns the absolute path. */
export async function pickVideoPath(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const res = await open({ multiple: false, title: 'Choose a video', filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }] })
  return typeof res === 'string' ? res : null
}

/** URL the webview can play for a local file. The backend allows each file when it is probed. */
export async function previewUrl(path: string): Promise<string> {
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  return convertFileSrc(path)
}
