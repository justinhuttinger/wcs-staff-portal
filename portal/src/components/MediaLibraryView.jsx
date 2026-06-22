// portal/src/components/MediaLibraryView.jsx
import { useState } from 'react'
import { searchMedia, reindexMedia } from '../lib/api'
import AuthImg from './AuthImg'

const LOCATIONS = ['Salem', 'Eugene', 'Springfield', 'Clackamas', 'Keizer', 'Milwaukie', 'Medford', 'Etc.']
const inputCls = 'px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-primary focus:outline-none focus:border-wcs-red'
const btnPrimary = 'px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50'

function fmtTime(s) {
  if (s == null) return null
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function MediaLibraryView({ onBack, userRole }) {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [kind, setKind] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searched, setSearched] = useState(false)
  const [lightbox, setLightbox] = useState(null)

  async function runSearch(e) {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true); setError(null)
    try {
      const { results } = await searchMedia({ query: query.trim(), location: location || undefined, kind: kind || undefined })
      setResults(results || []); setSearched(true)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  return (
    <div className="bg-white min-h-screen">
    <div className="max-w-6xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="text-sm text-tile-sub hover:text-text-primary">&larr; Back</button>
        {userRole === 'admin' && (
          <button onClick={() => reindexMedia().then(() => alert('Reindex started')).catch((e) => alert(e.message))}
            className="text-xs text-tile-sub hover:text-wcs-red">Reindex</button>
        )}
      </div>
      <h1 className="text-xl font-bold text-text-primary mb-1">Media Library</h1>
      <p className="text-sm text-tile-sub mb-4">Search photos and videos by what is in them, like "deadlift" or "front desk".</p>

      <form onSubmit={runSearch} className="flex flex-wrap gap-2 mb-5">
        <input className={inputCls + ' flex-1 min-w-[200px]'} placeholder="Search the media library..."
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">All locations</option>
          {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Photos and video</option>
          <option value="image">Photos</option>
          <option value="video">Video</option>
        </select>
        <button className={btnPrimary} disabled={loading}>{loading ? 'Searching...' : 'Search'}</button>
      </form>

      {error && <div className="text-sm text-wcs-red mb-3">{error}</div>}
      {searched && !loading && !results.length && <div className="text-sm text-tile-sub">No matches found.</div>}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {results.map((r) => (
          <button key={r.asset_id} onClick={() => setLightbox(r)}
            className="group relative rounded-lg overflow-hidden border border-border bg-surface aspect-square">
            <AuthImg driveFileId={r.drive_file_id} alt={r.title} className="w-full h-full object-cover" />
            {r.kind === 'video' && (
              <span className="absolute bottom-1 right-1 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded">
                {r.frame_time_seconds != null ? 'match at ' + fmtTime(r.frame_time_seconds) : 'video'}
              </span>
            )}
            <span className="absolute top-1 left-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">{r.location}</span>
          </button>
        ))}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="bg-surface rounded-2xl border border-border max-w-2xl w-full p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-text-primary truncate">{lightbox.title}</h3>
              <button onClick={() => setLightbox(null)} className="text-tile-sub hover:text-text-primary text-lg leading-none">&times;</button>
            </div>
            <AuthImg driveFileId={lightbox.drive_file_id} alt={lightbox.title} className="w-full max-h-[60vh] object-contain rounded-lg bg-bg" />
            <div className="flex items-center justify-between mt-3 text-xs text-tile-sub">
              <span>{lightbox.location} &middot; {lightbox.folder_path}</span>
              <a href={lightbox.web_view_link} target="_blank" rel="noreferrer" className="text-wcs-red font-semibold">Open in Drive</a>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
