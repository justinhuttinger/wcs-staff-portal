import { useState, useEffect, useCallback } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const MAX_BYTES = 25 * 1024 * 1024

async function call(path, opts = {}) {
  const res = await fetch(API_URL + path, opts)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong, please try again')
  return data
}

function SlotCard({ token, slot, onDone }) {
  const [file, setFile] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    if (slot.kind !== 'text' && file && file.size > MAX_BYTES) { setError('That file is over 25 MB'); return }
    setBusy(true)
    try {
      const path = `/hub-upload/${encodeURIComponent(token)}/slots/${slot.id}`
      if (slot.kind === 'text') {
        await call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      } else {
        const fd = new FormData()
        fd.append('file', file)
        await call(path, { method: 'POST', body: fd })
      }
      onDone(slot.id)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (slot.received) {
    return (
      <div className="rounded-2xl border border-green-500/30 bg-green-500/10 px-4 py-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-text-primary">{slot.label}</span>
        <span className="text-sm font-bold text-green-700">Received ✓</span>
      </div>
    )
  }

  const ready = slot.kind === 'text' ? text.trim().length > 0 : !!file
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-4 space-y-3">
      <p className="text-sm font-bold text-text-primary">{slot.label}</p>
      {slot.kind === 'text' ? (
        <textarea rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="Type or paste it here"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-base text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30" />
      ) : (
        <label className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-bg px-3 py-3 cursor-pointer">
          <span className="text-sm text-text-muted truncate">{file ? file.name : slot.kind === 'image' ? 'Choose a photo' : 'Choose a file'}</span>
          <span className="shrink-0 text-sm font-semibold text-wcs-red">Browse</span>
          <input type="file" className="hidden" accept={slot.kind === 'image' ? 'image/*' : undefined}
            onChange={e => setFile(e.target.files?.[0] || null)} />
        </label>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={submit} disabled={!ready || busy}
        className="w-full rounded-lg bg-wcs-red text-white py-2.5 text-sm font-semibold disabled:bg-wcs-red/40">
        {busy ? 'Sending…' : 'Send'}
      </button>
    </div>
  )
}

export default function UploadApp({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!token) { setError('This link is missing its code.'); return }
    try { setData(await call(`/hub-upload/${encodeURIComponent(token)}`)) }
    catch (e) { setError(e.message) }
  }, [token])
  useEffect(() => { load() }, [load])

  const markDone = id => setData(d => ({ ...d, slots: d.slots.map(s => s.id === id ? { ...s, received: true } : s) }))

  const open = data?.slots.filter(s => !s.received).length ?? 0
  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-5">
      <div className="flex items-center gap-3">
        <img src="/wcs-logo.png" alt="" className="w-9 h-9" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">West Coast Strength</p>
          {data && <h1 className="text-lg font-bold text-text-primary leading-tight">{data.taskTitle}</h1>}
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {!data && !error && <p className="text-sm text-text-muted">Loading…</p>}

      {data && (
        <>
          <p className="text-sm text-text-primary">
            Hi {data.personFirstName}, {data.ownerFirstName ? `${data.ownerFirstName} is` : "we're"} asking for the items below.
            {data.dueDate && ` Needed by ${new Date(data.dueDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.`}
          </p>
          {data.slots.length === 0 && <p className="text-sm text-text-muted">Nothing to send right now.</p>}
          <div className="space-y-3">
            {data.slots.map(s => <SlotCard key={s.id} token={token} slot={s} onDone={markDone} />)}
          </div>
          {data.slots.length > 0 && open === 0 && (
            <p className="text-sm font-semibold text-green-700">All done. Thank you!</p>
          )}
        </>
      )}
    </div>
  )
}
