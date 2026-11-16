import { useState, useEffect } from 'react'
import { hub } from '../../lib/api'

// "From their email": files copied in when this task was added from an email
// suggestion. Hidden when there are none.
export default function EmailFiles({ taskId }) {
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    hub.taskFiles(taskId).then(r => { if (live) setFiles(r.files || []) }).catch(() => {})
    return () => { live = false }
  }, [taskId])
  if (!files.length) return null

  const open = async f => {
    setError('')
    // Open the tab first so the browser doesn't block it after the await.
    const w = window.open('', '_blank')
    try {
      const { url } = await hub.openTaskFile(f.id)
      if (w) w.location = url
      else window.open(url, '_blank')
    } catch (e) { if (w) w.close(); setError(e.message) }
  }

  return (
    <div className="rounded-xl border border-border bg-bg/60 p-3 space-y-1.5">
      <p className="text-xs font-bold uppercase tracking-widest text-text-muted">From their email</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {files.map(f => (
        <div key={f.id} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-text-primary">{f.file_name}</span>
          {f.too_large
            ? <span className="text-xs text-text-muted">Too large, open in Gmail</span>
            : <button onClick={() => open(f)} className="text-xs font-semibold text-wcs-red hover:underline">Open</button>}
        </div>
      ))}
    </div>
  )
}
