import { useState, useEffect, useCallback, useRef } from 'react'
import { projects } from '../../lib/api'
import { Button, ErrorBanner, TextInput } from '../adsmanager/ui'

const ICON = {
  // paperclip
  file: 'm18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13',
  // link
  link: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244',
}

function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

function size(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const isImage = f => f.kind === 'file' && /^image\//.test(f.content_type || '')

function FileRow({ f, nameOf, onRemove }) {
  const [confirm, setConfirm] = useState(false)
  const meta = [f.kind === 'file' ? size(f.size_bytes) : null, f.added_by ? nameOf(f.added_by) : null].filter(Boolean).join(' · ')
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg px-3 py-2">
      {isImage(f) && f.url
        ? <img src={f.url} alt="" className="w-10 h-10 rounded object-cover shrink-0 border border-border" />
        : <span className="text-text-muted"><Icon d={ICON[f.kind]} /></span>}
      <div className="min-w-0 flex-1">
        <a href={f.url || undefined} target="_blank" rel="noreferrer"
          className="block text-sm font-semibold text-text-primary hover:text-wcs-red truncate">{f.title}</a>
        {meta && <p className="text-[11px] text-text-muted truncate">{meta}</p>}
      </div>
      {confirm ? (
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
          <Button variant="secondary" onClick={() => onRemove(f)}>Remove</Button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} title="Remove"
          className="text-text-muted hover:text-text-primary text-lg leading-none px-1 shrink-0">×</button>
      )}
    </div>
  )
}

// Files and links on one task. Files upload to private storage and open
// through short-lived links; Google Drive (or any) links are stored as-is.
// Remove hides an item but keeps it on record.
export default function TaskFiles({ taskId, nameOf, onCountChange }) {
  const [files, setFiles] = useState(null)
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [link, setLink] = useState({ url: '', title: '' })
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const load = useCallback(async () => {
    try { setFiles((await projects.tasks.files(taskId)).files) } catch (e) { setError(e.message) }
  }, [taskId])
  useEffect(() => { load() }, [load])

  const changed = next => { setFiles(next); onCountChange?.(next.length) }

  const upload = async list => {
    if (!list?.length) return
    setBusy(true); setError('')
    try {
      const { files: added } = await projects.tasks.upload(taskId, list)
      changed([...(files || []), ...added])
    } catch (e) { setError(e.message) } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const addLink = async () => {
    setBusy(true); setError('')
    try {
      const { file } = await projects.tasks.addLink(taskId, link)
      changed([...(files || []), file])
      setLink({ url: '', title: '' }); setLinking(false)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const remove = async f => {
    setError('')
    try {
      await projects.tasks.removeFile(taskId, f.id)
      changed(files.filter(x => x.id !== f.id))
    } catch (e) { setError(e.message) }
  }

  return (
    <div className="space-y-3 border-t border-border pt-5"
      onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }}
      onDrop={e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); upload(e.dataTransfer.files) } }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-bold text-text-primary">Files & links</h4>
        <div className="flex gap-2">
          <input ref={inputRef} type="file" multiple className="hidden" onChange={e => upload(e.target.files)} />
          <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Uploading…' : 'Upload files'}</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setLinking(v => !v)}>Add link</Button>
        </div>
      </div>
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {linking && (
        <div className="rounded-lg border border-border bg-bg p-3 space-y-2">
          <TextInput placeholder="Paste a Google Drive or other link" value={link.url} autoFocus
            onChange={e => setLink({ ...link, url: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && link.url.trim() && !busy) { e.preventDefault(); addLink() } }} />
          <TextInput placeholder="Name (optional)" value={link.title}
            onChange={e => setLink({ ...link, title: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && link.url.trim() && !busy) { e.preventDefault(); addLink() } }} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setLinking(false)}>Cancel</Button>
            <Button onClick={addLink} disabled={busy || !link.url.trim()}>Add link</Button>
          </div>
        </div>
      )}

      {files && files.length === 0 && !linking && (
        <p className="text-xs text-text-muted">No files yet. Upload files (25 MB each) or drop them here, or add a Google Drive link.</p>
      )}
      {files && files.length > 0 && (
        <div className="space-y-2">
          {files.map(f => <FileRow key={f.id} f={f} nameOf={nameOf} onRemove={remove} />)}
        </div>
      )}
    </div>
  )
}
