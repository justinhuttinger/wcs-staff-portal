import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function CopyText({ text }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* ignore */ }
  }
  return (
    <button onClick={copy} className={`text-xs font-semibold ${done ? 'text-green-600' : 'text-wcs-red hover:underline'}`}>
      {done ? 'Copied!' : 'Copy'}
    </button>
  )
}

function Item({ item }) {
  // Only real images render inline (a HEIC or PDF in an image slot shows as a link).
  const isImage = item.isFile && !!item.imageUrl
  return (
    <div className="rounded-xl border border-border bg-surface p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text-primary">
          {item.deliverable}{item.person && <span className="font-normal text-text-muted"> · {item.person}</span>}
        </p>
        {!item.isFile && <CopyText text={item.text} />}
      </div>
      {isImage && (
        <a href={item.url} target="_blank" rel="noreferrer">
          <img src={item.imageUrl} alt={item.label} loading="lazy" className="w-full max-h-80 object-contain rounded-lg bg-bg" />
        </a>
      )}
      {item.isFile && !isImage && (
        <a href={item.url} target="_blank" rel="noreferrer" className="text-sm text-wcs-red hover:underline break-all">{item.fileName || 'Open file'}</a>
      )}
      {!item.isFile && <p className="text-sm text-text-primary whitespace-pre-wrap">{item.text}</p>}
    </div>
  )
}

export default function ShareApp({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!token) { setError('This link is missing its code.'); return }
    fetch(`${API_URL}/hub-share/${encodeURIComponent(token)}`)
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'This link is not valid'); return d })
      .then(setData).catch(e => setError(e.message))
  }, [token])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <img src="/wcs-logo.png" alt="" className="w-9 h-9" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">West Coast Strength</p>
          {data && <h1 className="text-lg font-bold text-text-primary leading-tight">{data.taskTitle}</h1>}
        </div>
      </div>
      {error && <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {!data && !error && <p className="text-sm text-text-muted">Loading…</p>}
      {data && data.groups.length === 0 && <p className="text-sm text-text-muted">Nothing submitted yet.</p>}
      {data?.groups.map(g => (
        <section key={g.club || 'none'} className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-text-muted">{g.clubName}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {g.items.map(i => <Item key={i.id} item={i} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
