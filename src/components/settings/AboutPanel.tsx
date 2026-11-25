import { useState } from 'react'
import licence from '../../../LICENSE?raw'
import terms from '../../../legal/TERMS_OF_USE.md?raw'
import { version } from '../../../package.json'
import { Segmented } from '@/components/ui/Controls'
import { Badge } from '@/components/ui/Display'

type Doc = 'licence' | 'terms' | 'notices'

export function AboutPanel() {
  const [doc, setDoc] = useState<Doc>('licence')
  const [notices, setNotices] = useState('')
  const open = (d: Doc) => {
    setDoc(d)
    // Large file: read it only when asked for.
    if (d === 'notices' && !notices) {
      setNotices('Loading')
      fetch('/THIRD_PARTY_NOTICES.txt')
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .then(setNotices)
        .catch(() => setNotices('The notices file could not be read. It is also installed next to AutoKlipper.'))
    }
  }
  return (
    <div className="py-4">
      <div className="flex items-baseline gap-3">
        <p className="text-title font-semibold">AutoKlipper</p>
        <Badge tone="accent">Version {version}</Badge>
      </div>
      <p className="mt-1 max-w-xl text-body text-t2">Local-first AI video clipping studio for Windows. Open source under the MIT licence, by maeldotdev.</p>
      <p className="mt-1 max-w-xl text-label text-t3">FFmpeg, yt-dlp, Python and AI models are separate software with their own licences. They are not part of this app.</p>
      <div className="mt-5">
        <Segmented<Doc> label="Document" value={doc} onChange={open} options={[{ value: 'licence', label: 'Licence' }, { value: 'terms', label: 'Terms of use' }, { value: 'notices', label: 'Third-party notices' }]} />
      </div>
      <pre tabIndex={0} aria-label="Document text" className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-s2 p-4 font-mono text-meta text-t2">
        {doc === 'licence' ? licence : doc === 'terms' ? terms : notices}
      </pre>
    </div>
  )
}
