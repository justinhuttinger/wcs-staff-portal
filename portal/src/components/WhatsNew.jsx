import { useMemo, useState, useEffect } from 'react'
import { visibleChangelog } from '../config/changelog'
import { getChangelogSeen, setChangelogSeen } from '../lib/api'

// Read state is per-user (stored server-side); localStorage is only an instant
// cache so the badge doesn't flicker on load before the server value arrives.
const SEEN_KEY = 'wcs_whatsnew_last_seen'

function readCache() {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 0 } catch { return 0 }
}
function writeCache(id) {
  try { localStorage.setItem(SEEN_KEY, String(id)) } catch { /* ignore */ }
}

function fmtDate(d) {
  const dt = new Date(`${d}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// "What's New" top-bar bell. Shows the changelog entries this user can actually
// use (audience-filtered), with an unread dot until they open it. bgImage styles
// the button to match the Admin/Sign Out buttons on background-image locations.
export default function WhatsNew({ user, bgImage }) {
  const [open, setOpen] = useState(false)
  const [lastSeen, setLastSeen] = useState(readCache) // instant cache; server reconciles below

  const entries = useMemo(() => visibleChangelog({
    role: user?.staff?.role,
    visibleTools: user?.visible_tools,
    customReports: user?.staff?.custom_reports,
  }), [user])

  // Pull the authoritative per-user read marker on mount (server wins).
  useEffect(() => {
    let ignore = false
    getChangelogSeen()
      .then(({ last_seen_id }) => {
        if (ignore) return
        const v = Number(last_seen_id) || 0
        setLastSeen(v); writeCache(v)
      })
      .catch(() => { /* keep cached value */ })
    return () => { ignore = true }
  }, [])

  // Nothing relevant to this user -> no bell at all.
  if (entries.length === 0) return null

  const latestId = entries[0].id
  const unseen = entries.filter(e => e.id > lastSeen).length

  function openPanel() {
    setOpen(true)
    if (latestId > lastSeen) {
      setLastSeen(latestId); writeCache(latestId)
      setChangelogSeen(latestId).catch(() => { /* cache still holds it */ })
    }
  }

  const btnCls = `relative p-1.5 rounded-lg border transition-colors ${
    bgImage
      ? 'border-white/30 bg-white/10 text-white/80 hover:text-white hover:border-white/60'
      : 'border-border bg-surface text-text-muted hover:text-wcs-red hover:border-wcs-red'
  }`

  return (
    <>
      <button onClick={openPanel} className={btnCls} title="What's New" aria-label="What's New">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {unseen > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-wcs-red text-white text-[10px] font-bold leading-4 text-center">
            {unseen}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 pt-20" onClick={() => setOpen(false)}>
          <div
            className="bg-surface rounded-2xl border border-border w-full max-w-lg max-h-[75vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-lg font-bold text-text-primary">What&rsquo;s New</h3>
              <button onClick={() => setOpen(false)} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-5">
              {entries.map(e => (
                <div key={e.id} className="flex gap-3">
                  <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${e.id > lastSeen ? 'bg-wcs-red' : 'bg-border'}`} />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h4 className="text-sm font-bold text-text-primary">{e.title}</h4>
                      <span className="text-[11px] text-text-muted">{fmtDate(e.date)}</span>
                    </div>
                    <p className="text-sm text-text-muted mt-0.5">{e.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
