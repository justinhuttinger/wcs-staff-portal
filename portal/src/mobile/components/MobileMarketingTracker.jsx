import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { getMarketingEfforts } from '../../lib/api'
import { LOCATION_NAMES, LOCATION_OPTIONS } from '../../config/locations'
import LocationMultiSelect from '../../components/LocationMultiSelect'
import { MARKETING_TYPES, typeLabel, typeStyle, STATUS_BY_KEY } from '../../config/marketingTypes'
import { ViewModal, EffortModal } from '../../components/MarketingTrackerView'

// --- date helpers (local) ---
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function todayStr() { return toLocalDateStr(new Date()) }
function isoToDateStr(iso) { return iso ? toLocalDateStr(new Date(iso)) : '' }
function fmtDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
}

const ALL_SLUGS = LOCATION_NAMES.map(n => n.toLowerCase())
function locationsLabel(slugs) {
  if (!slugs || slugs.length === 0) return '—'
  if (slugs.length >= ALL_SLUGS.length) return 'All Locations'
  const bySlug = Object.fromEntries(LOCATION_OPTIONS.map(o => [o.slug, o.label]))
  return slugs.map(s => bySlug[s] || s).join(', ')
}

export default function MobileMarketingTracker() {
  const [efforts, setEfforts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeValue, setTypeValue] = useState('all')
  const [locationValue, setLocationValue] = useState('all')
  const [modal, setModal] = useState(null) // { view } | { effort } | { date } | null

  const TYPE_OPTIONS = useMemo(() => MARKETING_TYPES.map(t => ({ slug: t.slug, label: t.label })), [])

  function load() {
    setLoading(true)
    setError('')
    return getMarketingEfforts()
      .then(res => { const list = res.efforts || []; setEfforts(list); return list })
      .catch(err => { setError(err.message); return [] })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Near-live updates: poll every 15s while visible, and on refocus.
  useEffect(() => {
    let cancelled = false
    async function refresh() {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await getMarketingEfforts()
        if (!cancelled) setEfforts(res.efforts || [])
      } catch { /* keep last good */ }
    }
    const timer = setInterval(refresh, 15000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const typeSet = useMemo(() => {
    if (!typeValue || typeValue === 'all') return null
    return new Set(String(typeValue).split(',').map(s => s.trim()).filter(Boolean))
  }, [typeValue])

  const locationSet = useMemo(() => {
    if (!locationValue || locationValue === 'all') return null
    return new Set(String(locationValue).split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  }, [locationValue])

  const { upcoming, past } = useMemo(() => {
    const today = todayStr()
    const up = []
    const pa = []
    for (const e of efforts) {
      if (typeSet && !typeSet.has(e.type)) continue
      if (locationSet && !(e.locations || []).some(l => locationSet.has(l))) continue
      const end = e.end_at ? isoToDateStr(e.end_at) : isoToDateStr(e.start_at)
      if (end >= today) up.push(e); else pa.push(e)
    }
    up.sort((a, b) => (a.start_at < b.start_at ? -1 : a.start_at > b.start_at ? 1 : 0))
    pa.sort((a, b) => (a.start_at > b.start_at ? -1 : a.start_at < b.start_at ? 1 : 0))
    return { upcoming: up, past: pa }
  }, [efforts, typeSet, locationSet])

  const onOpen = (e) => setModal({ view: e })
  const total = upcoming.length + past.length

  return (
    <div className="pt-4 px-4 pb-24">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-text-primary">Marketing Tracker</h1>
        <span className="px-2 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red text-[10px] font-bold uppercase tracking-wider border border-wcs-red/20">Beta</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mt-3 mb-4 flex-wrap">
        <LocationMultiSelect value={locationValue} onChange={setLocationValue} options={LOCATION_OPTIONS.filter(o => o.slug !== 'all')} applyLabel="Apply" />
        <LocationMultiSelect value={typeValue} onChange={setTypeValue} options={TYPE_OPTIONS} allLabel="All Types" noneLabel="No Types" nounPlural="types" applyLabel="Apply" />
      </div>

      {error && <p className="text-sm text-wcs-red mb-3">{error}</p>}
      {loading && efforts.length === 0 && (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-wcs-red" />
        </div>
      )}

      {!loading && total === 0 && (
        <p className="text-sm text-text-muted text-center py-10">No marketing efforts yet. Tap + to add one.</p>
      )}

      {upcoming.length > 0 && (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Upcoming & Active</p>
          <div className="space-y-2.5 mb-6">
            {upcoming.map(e => <EffortCardWithDate key={e.id} effort={e} onOpen={onOpen} />)}
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Past</p>
          <div className="space-y-2.5">
            {past.map(e => <EffortCardWithDate key={e.id} effort={e} onOpen={onOpen} />)}
          </div>
        </>
      )}

      {/* Floating add button (sits above the bottom tab bar) */}
      <button
        onClick={() => setModal({ date: todayStr() })}
        className="fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-wcs-red text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Add marketing effort"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
      </button>

      {/* Modals — portaled to body so they sit above the fixed bottom nav */}
      {modal && modal.view && createPortal(
        <ViewModal
          effort={modal.view}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ effort: modal.view })}
          onChanged={async () => {
            const list = await load()
            setModal(m => (m && m.view) ? { view: list.find(x => x.id === m.view.id) || m.view } : m)
          }}
          onDeleted={() => { setModal(null); load() }}
        />, document.body)}

      {modal && !modal.view && createPortal(
        <EffortModal
          effort={modal.effort || null}
          defaultDate={modal.date || todayStr()}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
          onDeleted={() => { setModal(null); load() }}
        />, document.body)}
    </div>
  )
}

// Card that shows the effort date inline (used in both sections).
function EffortCardWithDate({ effort, onOpen }) {
  const st = typeStyle(effort.type)
  const status = STATUS_BY_KEY[effort.status]
  const startD = isoToDateStr(effort.start_at)
  const endD = effort.end_at ? isoToDateStr(effort.end_at) : null
  return (
    <button
      onClick={() => onOpen(effort)}
      className="w-full text-left bg-surface border border-border rounded-2xl p-4 active:scale-[0.99] transition-transform"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{typeLabel(effort.type)}</span>
          </div>
          <p className="text-sm font-semibold text-text-primary leading-tight">{effort.title}</p>
          <p className="text-xs text-text-muted mt-1">
            {fmtDate(startD)}{endD && endD !== startD ? ` – ${fmtDate(endD)}` : ''}{fmtTime(effort.start_at) ? ` · ${fmtTime(effort.start_at)}` : ''}
          </p>
          <p className="text-xs text-text-muted">{locationsLabel(effort.locations)}</p>
        </div>
        {status && (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${status.badge}`}>{status.label}</span>
        )}
      </div>
    </button>
  )
}
