import { useRef, useState } from 'react'
import { uploadHRFile, downloadHRFile } from '../lib/api'
import HRFileViewer, { canViewHRFile } from './HRFileViewer'

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
  const [viewing, setViewing] = useState(false)

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
    <div className="bg-surface border border-border rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-wcs-red shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
      </svg>
      <div className="flex-1 min-w-[9rem]">
        <p className="text-sm font-medium text-text-primary truncate">{file.title || file.file_name}</p>
        <p className="text-[11px] text-text-muted truncate">
          {[file.title ? file.file_name : null, formatSize(file.size_bytes), formatDate(file.created_at), file.uploaded_by_name]
            .filter(Boolean).join(' · ')}
        </p>
        {error && <p className="text-[11px] text-red-600 mt-0.5">{error}</p>}
      </div>
      {file.paychex_status === 'sent' && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 shrink-0">Paychex</span>
      )}
      {file.paychex_status === 'failed' && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 shrink-0">Not in Paychex</span>
      )}
      {canViewHRFile(file) && (
        <button
          type="button"
          onClick={() => setViewing(true)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors shrink-0"
        >
          View
        </button>
      )}
      {viewing && <HRFileViewer file={file} onClose={() => setViewing(false)} />}
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-bg text-text-primary hover:border-text-muted transition-colors disabled:opacity-40 shrink-0"
      >
        {busy ? 'Downloading...' : 'Download'}
      </button>
    </div>
  )
}

function sameFile(a, b) {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

// The upload control on its own: pick one or more files, then send them. Each
// pick adds to the list, so files from different folders can go up together.
// Files are sent one at a time; any that fail stay in the list to retry.
// `locationSlug` is the club the worker was picked from; it travels with the
// file the same way it does with a written document.
export function HRFileUploader({ worker, locationSlug, onUploaded }) {
  const inputRef = useRef(null)
  const [picked, setPicked] = useState([])
  const [title, setTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  function handlePick(e) {
    const chosen = Array.from(e.target.files || [])
    // Clear the input so picking the same file again still fires onChange.
    e.target.value = ''
    const tooBig = chosen.filter(f => f.size > MAX_BYTES)
    const ok = chosen.filter(f => f.size <= MAX_BYTES)
    setNotice(null)
    setError(tooBig.length ? `Over the 15 MB limit, not added: ${tooBig.map(f => f.name).join(', ')}` : null)
    setPicked(prev => [...prev, ...ok.filter(f => !prev.some(p => sameFile(p, f)))])
  }

  function removeAt(i) {
    setPicked(prev => prev.filter((_, idx) => idx !== i))
  }

  function reset() {
    setPicked([])
    setTitle('')
    setError(null)
  }

  async function handleUpload() {
    if (picked.length === 0) return
    setUploading(true)
    setError(null)
    setNotice(null)
    const failed = []
    const notInPaychex = []
    let done = 0
    // A label only makes sense for a single file; several files keep their names.
    const label = picked.length === 1 ? title.trim() : ''
    for (let i = 0; i < picked.length; i++) {
      const file = picked[i]
      setProgress(`Uploading ${i + 1} of ${picked.length}...`)
      try {
        const row = await uploadHRFile({
          file,
          workerId: worker.workerId,
          employeeName: worker.displayName,
          locationSlug: locationSlug || undefined,
          title: label || undefined,
        })
        done++
        if (row.paychex_status === 'failed') notInPaychex.push(file.name)
        onUploaded?.(row)
      } catch (err) {
        failed.push({ file, message: err.message || 'Upload failed' })
      }
    }
    setPicked(failed.map(f => f.file))
    setTitle('')
    setProgress('')
    setUploading(false)

    const problems = []
    if (failed.length) problems.push(`Not uploaded: ${failed.map(f => `${f.file.name} (${f.message})`).join(', ')}.`)
    if (notInPaychex.length) problems.push(`Saved in the portal, but Paychex did not accept: ${notInPaychex.join(', ')}. Add ${notInPaychex.length === 1 ? 'it' : 'them'} in Paychex directly.`)
    setError(problems.length ? problems.join(' ') : null)
    if (done > 0) setNotice(`${done} file${done === 1 ? '' : 's'} uploaded`)
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        onChange={handlePick}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-lg border border-dashed border-border bg-bg text-text-primary hover:border-wcs-red hover:text-wcs-red transition-colors disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        {picked.length === 0 ? 'Choose Files' : 'Add More Files'}
      </button>

      {picked.length > 0 && (
        <>
          <ul className="space-y-1.5">
            {picked.map((f, i) => (
              <li key={`${f.name}-${f.size}-${f.lastModified}`} className="flex items-center gap-2 text-sm text-text-primary">
                <span className="flex-1 min-w-0 truncate">
                  <span className="font-semibold">{f.name}</span>
                  <span className="text-text-muted"> · {formatSize(f.size)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  disabled={uploading}
                  className="text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors disabled:opacity-40 shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {picked.length === 1 && (
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Label (optional), e.g. Doctor's note, Signed write-up"
              maxLength={200}
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
            />
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? progress || 'Uploading...' : `Upload ${picked.length} File${picked.length === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={uploading}
              className="px-5 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg transition-colors disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </>
      )}
      {notice && <p className="text-xs font-semibold text-green-700">{notice}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-[11px] text-text-muted">PDF, photo, Word, Excel, or text files, up to 15 MB each. Saved to this employee's record in the portal and sent to Paychex.</p>
    </div>
  )
}

// A plain list of uploaded files with download buttons.
export function HRFileList({ files }) {
  if (!files || files.length === 0) return null
  return (
    <div className="space-y-2">
      {files.map(f => <FileRow key={f.id} file={f} />)}
    </div>
  )
}

// Files a manager has uploaded to this employee's HR record, plus the control
// to add more. Shared by the desktop and mobile HR views.
export default function HRUploadedFiles({ worker, locationSlug, files, onUploaded }) {
  return (
    <div>
      <h3 className="inline-block bg-surface border border-border rounded-full px-3 py-1 text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
        Uploaded Files {files.length > 0 && `(${files.length})`}
      </h3>
      <div className="mb-2">
        <HRFileUploader worker={worker} locationSlug={locationSlug} onUploaded={onUploaded} />
      </div>
      <HRFileList files={files} />
    </div>
  )
}
