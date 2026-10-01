import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchHRFileBlob, saveBlobAs } from '../lib/api'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Which uploaded files the browser can show in place. Word, Excel and HEIC
// photos have no built-in viewer, so those stay download-only.
export function canViewHRFile(file) {
  const type = file?.content_type || ''
  return type === 'application/pdf' || type === 'text/plain' || IMAGE_TYPES.includes(type)
}

// Full-screen preview of one uploaded HR file. The bytes are fetched with the
// user's token and shown from an in-memory blob, so nothing is exposed by URL.
export default function HRFileViewer({ file, onClose }) {
  const [blob, setBlob] = useState(null)
  const [url, setUrl] = useState(null)
  const [text, setText] = useState(null)
  const [error, setError] = useState(null)

  const type = file.content_type
  const isImage = IMAGE_TYPES.includes(type)
  const isText = type === 'text/plain'

  useEffect(() => {
    let cancelled = false
    let objectUrl = null
    fetchHRFileBlob(file.id)
      .then(async raw => {
        if (cancelled) return
        // Type the blob from the stored record, never from what was fetched.
        const typed = new Blob([raw], { type })
        setBlob(typed)
        if (isText) {
          setText(await typed.text())
        } else {
          objectUrl = URL.createObjectURL(typed)
          setUrl(objectUrl)
        }
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Could not load the file') })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.id, type, isText])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const loading = !error && !url && text === null

  // Rendered on <body> so no ancestor's overflow or transform can clip it.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80 p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex flex-col flex-1 min-h-0 w-full max-w-5xl mx-auto bg-surface rounded-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <p className="flex-1 min-w-0 truncate text-sm font-semibold text-text-primary">{file.title || file.file_name}</p>
          <button
            type="button"
            onClick={() => blob && saveBlobAs(blob, file.file_name)}
            disabled={!blob}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-bg text-text-primary hover:border-text-muted transition-colors disabled:opacity-40 shrink-0"
          >
            Download
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors shrink-0"
          >
            Close
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-bg overflow-auto">
          {loading && <p className="text-sm text-text-muted text-center py-12">Loading...</p>}
          {error && <p className="text-sm text-red-600 text-center py-12">{error}</p>}
          {url && isImage && (
            <img src={url} alt={file.file_name} className="block max-w-full mx-auto" />
          )}
          {url && !isImage && (
            <iframe src={url} title={file.file_name} className="w-full h-full border-0" />
          )}
          {text !== null && (
            <pre className="p-4 text-sm text-text-primary whitespace-pre-wrap break-words">{text}</pre>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
