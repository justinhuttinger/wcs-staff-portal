import { useRef, useState } from 'react'
import { uploadHRFile, downloadHRFile } from '../lib/api'

const MAX_BYTES = 15 * 1024 * 1024
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.txt'

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function FileRow({ file }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleDownload() {
    setBusy(true)
    setError(null)
    try {
      await downloadHRFile(file.id, file.file_name)
    } catch (err) {
      setError(err.message || 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-wcs-red shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{file.title || file.file_name}</p>
        <p className="text-[11px] text-text-muted truncate">
          {[file.title ? file.file_name : null, formatSize(file.size_bytes), formatDate(file.created_at), file.uploaded_by_name]
            .filter(Boolean).join(' · ')}
        </p>
        {error && <p className="text-[11px] text-red-600 mt-0.5">{error}</p>}
      </div>
      <button
        onClick={handleDownload}
        disabled={busy}
        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-bg text-text-primary hover:border-text-muted transition-colors disabled:opacity-40 shrink-0"
      >
        {busy ? 'Downloading...' : 'Download'}
      </button>
    </div>
  )
}

// Files a manager has uploaded to this employee's HR record, plus the control
// to add one. Shared by the desktop and mobile HR views. `locationSlug` is the
// club the worker was picked from; it travels with the file the same way it
// does with a written document.
export default function HRUploadedFiles({ worker, locationSlug, files, onUploaded }) {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  function handlePick(e) {
    const picked = e.target.files?.[0] || null
    setError(null)
    if (picked && picked.size > MAX_BYTES) {
      setError('File exceeds the 15 MB limit')
      setFile(null)
      e.target.value = ''
      return
    }
    setFile(picked)
  }

  function reset() {
    setFile(null)
    setTitle('')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const row = await uploadHRFile({
        file,
        workerId: worker.workerId,
        employeeName: worker.displayName,
        locationSlug: locationSlug || undefined,
        title: title.trim() || undefined,
      })
      reset()
      onUploaded?.(row)
    } catch (err) {
      setError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <h3 className="inline-block bg-surface border border-border rounded-full px-3 py-1 text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
        Uploaded Files {files.length > 0 && `(${files.length})`}
      </h3>

      <div className="bg-surface border border-border rounded-xl p-4 mb-2 space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={handlePick}
          className="hidden"
        />
        {!file ? (
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-lg border border-dashed border-border bg-bg text-text-primary hover:border-wcs-red hover:text-wcs-red transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            Upload a File
          </button>
        ) : (
          <>
            <p className="text-sm text-text-primary truncate">
              <span className="font-semibold">{file.name}</span>
              <span className="text-text-muted"> · {formatSize(file.size)}</span>
            </p>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Label (optional), e.g. Doctor's note, Signed write-up"
              maxLength={200}
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
            />
            <div className="flex gap-3">
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="px-5 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
              <button
                onClick={reset}
                disabled={uploading}
                className="px-5 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <p className="text-[11px] text-text-muted">PDF, photo, Word, Excel, or text file, up to 15 MB. Saved to this employee's record in the portal.</p>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map(f => <FileRow key={f.id} file={f} />)}
        </div>
      )}
    </div>
  )
}
