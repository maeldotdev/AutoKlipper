/* Faster-Whisper model facts. Sizes and relative speed follow the public Whisper/faster-whisper docs; memory is approximate. */
export interface WhisperModel {
  id: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'
  label: string
  download: string
  memory: string
  speed: string
  note: string
}

export const WHISPER_MODELS: WhisperModel[] = [
  { id: 'tiny', label: 'Tiny', download: '75 MB', memory: 'about 1 GB', speed: 'Fastest', note: 'Drafts and clear speech.' },
  { id: 'base', label: 'Base', download: '142 MB', memory: 'about 1 GB', speed: 'Very fast', note: 'Good for quick passes.' },
  { id: 'small', label: 'Small', download: '466 MB', memory: 'about 2 GB', speed: 'Fast', note: 'Best default on a laptop CPU.' },
  { id: 'medium', label: 'Medium', download: '1.5 GB', memory: 'about 5 GB', speed: 'Moderate', note: 'Accents and noisy audio.' },
  { id: 'large-v3', label: 'Large v3', download: '3.1 GB', memory: 'GPU with 6 GB or more advised', speed: 'Slowest', note: 'Highest accuracy, many languages.' },
]

export const LANGUAGES = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'en', label: 'English' },
  { value: 'tl', label: 'Tagalog' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'hi', label: 'Hindi' },
]
