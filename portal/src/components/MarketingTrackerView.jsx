import { useState, useEffect, useMemo } from 'react'
import {
  getMarketingEfforts, createMarketingEffort, updateMarketingEffort, deleteMarketingEffort,
  updateMarketingEffortStatus, getMarketingEffortComments, addMarketingEffortComment,
  getMarketingDriveFolder, uploadMarketingAsset,
} from '../lib/api'
import { LOCATION_NAMES, LOCATION_OPTIONS } from '../config/locations'
import LocationMultiSelect from './LocationMultiSelect'
import MarketingNeeds from './MarketingNeeds'
import MarketingResearch from './MarketingResearch'
import DripCampaigns from './DripCampaigns'
import {
  MARKETING_TYPES, TYPE_BY_SLUG, typeLabel, typeStyle, STATUSES, STATUS_BY_KEY,
} from '../config/marketingTypes'

// --- Date helpers (local-time, noon-anchored to dodge UTC day-shift) ---

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayStr() {
  return toLocalDateStr(new Date())
}

function isoToDateStr(iso) {
  if (!iso) return ''
  return toLocalDateStr(new Date(iso))
}

function isoToParts(iso) {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  return {
    date: toLocalDateStr(d),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  }
}

function partsToIso(date, time) {
  if (!date) return null
  return new Date(`${date}T${time || '12:00'}:00`).toISOString()
}

function formatLongDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function getWeekDates(baseDate) {
  const d = new Date(baseDate + 'T12:00:00')
  const sunday = new Date(d)
  sunday.setDate(d.getDate() - d.getDay())
  const out = []
  for (let i = 0; i < 7; i++) {
    const x = new Date(sunday)
    x.setDate(sunday.getDate() + i)
    out.push(toLocalDateStr(x))
  }
  return out
}

function getMonthWeeks(baseDate) {
  const d = new Date(baseDate + 'T12:00:00')
  const year = d.getFullYear()
  const month = d.getMonth()
  const gridStart = new Date(year, month, 1)
  gridStart.setDate(1 - gridStart.getDay()) // back up to Sunday
  const weeks = []
  const cur = new Date(gridStart)
  for (let w = 0; w < 6; w++) {
    const week = []
    for (let i = 0; i < 7; i++) {
      week.push(toLocalDateStr(cur))
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

const ALL_SLUGS = LOCATION_NAMES.map(n => n.toLowerCase())

function locationsLabel(slugs) {
  if (!slugs || slugs.length === 0) return '—'
  if (slugs.length >= ALL_SLUGS.length) return 'All Locations'
  const bySlug = Object.fromEntries(LOCATION_OPTIONS.map(o => [o.slug, o.label]))
  return slugs.map(s => bySlug[s] || s).join(', ')
}

// --- Asset preview detection (Google Drive files, direct image/video/pdf) ---

function driveFileId(url) {
  if (!url) return null
  const m = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  // Only the canonical open/uc forms carry a file id in `id=`; other Google
  // URLs (folders, forms, search) also have `id=` but aren't single files.
  if (/drive\.google\.com\/(open|uc)/.test(url)) {
    const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
    if (m2) return m2[1]
  }
  return null
}

function driveFolderId(url) {
  if (!url) return null
  const m = url.match(/drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

function googleDocPreview(url) {
  const m = url && url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/)
  return m ? `https://docs.google.com/${m[1]}/d/${m[2]}/preview` : null
}

function directAssetKind(url) {
  // Only embed https URLs directly — blocks mixed-content and non-http schemes
  // from ever reaching an iframe/img/video src.
  if (!url || !/^https:\/\//i.test(url)) return null
  const clean = url.split('?')[0].split('#')[0].toLowerCase()
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(clean)) return 'image'
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(clean)) return 'video'
  if (/\.pdf$/.test(clean)) return 'pdf'
  return null
}

// Renders an inline preview for a single-asset link when we can recognize it
// (Google Drive file, Google Doc/Sheet/Slide, or a direct image/video/pdf URL).
// Returns null when the URL isn't previewable — caller still shows the link.
// Scrollable preview of all media inside a Google Drive folder.
function FolderCarousel({ folderId }) {
  const [files, setFiles] = useState(null)
  const [idx, setIdx] = useState(0)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    setFiles(null); setErr(''); setIdx(0)
    getMarketingDriveFolder(folderId)
      .then(r => { if (alive) setFiles(r.files || []) })
      .catch(e => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [folderId])

  if (err) return <p className="text-xs text-text-muted">Couldn't load folder: {err}</p>
  if (files === null) return <p className="text-xs text-text-muted">Loading folder…</p>
  if (files.length === 0) return <p className="text-xs text-text-muted">No media found (the folder may not be shared with the portal).</p>

  const cur = files[idx]
  const go = (d) => setIdx(i => (i + d + files.length) % files.length)
  const arrow = 'shrink-0 w-8 h-8 rounded-full border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors'

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-bg">
      <iframe key={cur.id} src={`https://drive.google.com/file/d/${cur.id}/preview`} title={cur.name} className="w-full bg-black/5" style={{ height: 360 }} allow="autoplay" />
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border">
        <button type="button" onClick={() => go(-1)} disabled={files.length < 2} className={arrow} aria-label="Previous">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="min-w-0 text-center">
          <p className="text-xs font-medium text-text-primary truncate">{cur.name}</p>
          <p className="text-[10px] text-text-muted">{idx + 1} of {files.length}</p>
        </div>
        <button type="button" onClick={() => go(1)} disabled={files.length < 2} className={arrow} aria-label="Next">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  )
}

function AssetPreview({ url }) {
  const folderId = driveFolderId(url)
  if (folderId) return <FolderCarousel folderId={folderId} />
  const driveId = driveFileId(url)
  if (driveId) {
    return <iframe src={`https://drive.google.com/file/d/${driveId}/preview`} title="Asset preview" className="w-full rounded-lg border border-border bg-black/5" style={{ height: 360 }} allow="autoplay" />
  }
  const doc = googleDocPreview(url)
  if (doc) {
    return <iframe src={doc} title="Document preview" className="w-full rounded-lg border border-border" style={{ height: 360 }} />
  }
  const kind = directAssetKind(url)
  if (kind === 'image') {
    return <img src={url} alt="" loading="lazy" className="max-h-80 rounded-lg border border-border object-contain bg-bg" />
  }
  if (kind === 'video') {
    return <video src={url} controls className="max-h-80 w-full rounded-lg border border-border bg-black" />
  }
  if (kind === 'pdf') {
    return <iframe src={url} title="PDF preview" className="w-full rounded-lg border border-border" style={{ height: 360 }} />
  }
  return null
}

function ExternalLink({ url }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-wcs-red hover:underline break-all inline-flex items-center gap-1 text-sm">
      <span className="truncate max-w-full">{url}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
    </a>
  )
}

function formatCommentTime(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// --- Activity feed helpers (comments + recorded edits) ---

const FIELD_LABELS = {
  title: 'Title', type: 'Type', status: 'Status',
  start_at: 'Start date', end_at: 'End date',
  locations: 'Locations', notes: 'Notes',
}

// Resolve a change `field` (base column or `custom.<key>`) to a display label.
function activityFieldLabel(effort, field) {
  if (field && field.startsWith('custom.')) {
    const key = field.slice(7)
    const def = (TYPE_BY_SLUG[effort.type]?.fields || []).find(f => f.key === key)
    return def?.label || key.replace(/_/g, ' ')
  }
  return FIELD_LABELS[field] || field
}

// Human phrase for one recorded change, e.g. "edited Creative Link",
// "added Copy", "changed Status from Planned to Approved".
function changePhrase(effort, c) {
  const label = activityFieldLabel(effort, c.field)
  if (c.field === 'status') {
    const from = STATUS_BY_KEY[c.from]?.label || c.from
    const to = STATUS_BY_KEY[c.to]?.label || c.to
    return `changed Status from ${from} to ${to}`
  }
  if (c.field === 'locations') {
    if (c.action === 'removed') return 'cleared Locations'
    return `${c.action === 'added' ? 'set' : 'changed'} Locations to ${locationsLabel(c.to || [])}`
  }
  if (c.field === 'start_at' || c.field === 'end_at') {
    if (c.action === 'removed') return `removed ${label}`
    return `${c.action === 'added' ? 'set' : 'changed'} ${label} to ${formatLongDate(isoToDateStr(c.to))}`
  }
  if (c.action === 'added') return `added ${label}`
  if (c.action === 'removed') return `removed ${label}`
  return `edited ${label}`
}

// --- Main view ---

export default function MarketingTrackerView({ onBack, access }) {
  // Effective capabilities from marketingAccess(); default to full when the
  // prop is absent (e.g. legacy callers) so nothing regresses.
  const caps = access || { tracker: true, needs: true, research: true, types: null }
  const TABS = useMemo(() => [
    { key: 'tracker', label: 'Tracker', show: caps.tracker !== false },
    { key: 'needs', label: 'Needs List', show: !!caps.needs },
    { key: 'research', label: 'Research', show: !!caps.research },
    // Drip Campaigns edits the club's GHL custom values - the SMS templates the
    // drip workflows reference. Anyone who can open this tile can see it.
    { key: 'drip', label: 'Drip Campaigns', show: true },
  ].filter(t => t.show), [caps.tracker, caps.needs, caps.research])

  const [efforts, setEfforts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('calendar')          // 'calendar' | 'list'
  const [calView, setCalView] = useState('month')        // 'day' | 'week' | 'month'
  const [currentDate, setCurrentDate] = useState(todayStr())
  const [typeValue, setTypeValue] = useState('all')
  const [locationValue, setLocationValue] = useState('all')
  const [tab, setTab] = useState(() => (caps.tracker !== false ? 'tracker' : (caps.needs ? 'needs' : 'research')))

  // Keep the active tab within the granted set (e.g. a member with only the
  // Needs section should never land on a hidden Tracker tab).
  useEffect(() => {
    if (!TABS.some(t => t.key === tab)) setTab(TABS[0]?.key || 'tracker')
  }, [TABS, tab])

  // Type filter is limited to the member's granted effort types; null = all.
  const TYPE_OPTIONS = useMemo(() => {
    const allowed = Array.isArray(caps.types) ? new Set(caps.types) : null
    return MARKETING_TYPES
      .filter(t => !allowed || allowed.has(t.slug))
      .map(t => ({ slug: t.slug, label: t.label }))
  }, [caps.types])
  const [modal, setModal] = useState(null)               // { view } | { effort } | { date } | null

  function load() {
    setLoading(true)
    setError('')
    return getMarketingEfforts()
      .then(res => { const list = res.efforts || []; setEfforts(list); return list })
      .catch(err => { setError(err.message); return [] })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Near-live updates: while the tracker is open and the tab is visible,
  // silently re-poll so people working the board together see each other's
  // adds / edits / status changes without leaving and re-entering. Pauses when
  // the tab is hidden and refreshes immediately on refocus. Silent = no spinner
  // and last-good data is kept on a transient error.
  useEffect(() => {
    const POLL_MS = 15000
    let cancelled = false
    async function refresh() {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await getMarketingEfforts()
        if (!cancelled) setEfforts(res.efforts || [])
      } catch { /* keep last good data */ }
    }
    const timer = setInterval(refresh, POLL_MS)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const locationSet = useMemo(() => {
    if (!locationValue || locationValue === 'all') return null // null = all
    return new Set(String(locationValue).split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  }, [locationValue])

  const typeSet = useMemo(() => {
    if (!typeValue || typeValue === 'all') return null // null = all
    return new Set(String(typeValue).split(',').map(s => s.trim()).filter(Boolean))
  }, [typeValue])

  const filtered = useMemo(() => {
    return efforts.filter(e => {
      if (typeSet && !typeSet.has(e.type)) return false
      if (locationSet) {
        const locs = e.locations || []
        if (!locs.some(l => locationSet.has(l))) return false
      }
      return true
    })
  }, [efforts, typeSet, locationSet])

  // Items overlapping a given day (start_at..end_at inclusive; single-day if no end).
  function itemsForDate(dateStr) {
    return filtered
      .filter(e => {
        const start = isoToDateStr(e.start_at)
        const end = e.end_at ? isoToDateStr(e.end_at) : start
        return dateStr >= start && dateStr <= end
      })
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
  }

  function navigate(offset) {
    const d = new Date(currentDate + 'T12:00:00')
    if (calView === 'day') d.setDate(d.getDate() + offset)
    else if (calView === 'week') d.setDate(d.getDate() + offset * 7)
    else d.setMonth(d.getMonth() + offset)
    setCurrentDate(toLocalDateStr(d))
  }

  const weekDates = getWeekDates(currentDate)
  const monthWeeks = getMonthWeeks(currentDate)
  const monthOfCurrent = new Date(currentDate + 'T12:00:00').getMonth()
  const today = todayStr()

  const navLabel = calView === 'day'
    ? formatLongDate(currentDate)
    : calView === 'week'
      ? `${formatLongDate(weekDates[0])} — ${formatLongDate(weekDates[6])}`
      : new Date(currentDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="w-full max-w-6xl mx-auto px-8 py-6">
      {/* Header card */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-text-primary">Marketing</h2>
            </div>
            {/* Tab nav — inline with the title */}
            <div className="flex gap-1 bg-bg rounded-lg p-1">
              {TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${tab === t.key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
                >{t.label}</button>
              ))}
            </div>
          </div>
          {tab === 'tracker' && (
            <div className="flex items-center gap-3">
              {/* List / Calendar toggle */}
              <div className="flex gap-1 bg-bg rounded-lg p-1">
                {[{ key: 'calendar', label: 'Calendar' }, { key: 'list', label: 'List' }].map(m => (
                  <button
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === m.key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
                  >{m.label}</button>
                ))}
              </div>
              <button
                onClick={() => setModal({ date: currentDate })}
                className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red/90 transition-colors flex items-center gap-1.5"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add
              </button>
            </div>
          )}
        </div>

        {/* Filters (Tracker only) */}
        {tab === 'tracker' && (
        <div className="flex items-start gap-4 mt-4 flex-wrap">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Location</span>
            <LocationMultiSelect value={locationValue} onChange={setLocationValue} options={LOCATION_OPTIONS.filter(o => o.slug !== 'all')} />
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Type</span>
            <LocationMultiSelect
              value={typeValue}
              onChange={setTypeValue}
              options={TYPE_OPTIONS}
              allLabel="All Types"
              noneLabel="No Types"
              nounPlural="types"
            />
          </div>
        </div>
        )}
      </div>

      {/* Needs List + Research tabs */}
      {tab === 'needs' && <MarketingNeeds />}
      {tab === 'research' && <MarketingResearch />}
      {tab === 'drip' && <DripCampaigns />}

      {tab === 'tracker' && error && <p className="text-sm text-wcs-red mb-4">{error}</p>}
      {tab === 'tracker' && loading && <p className="loading-card mx-auto block my-6">Loading marketing tracker...</p>}

      {tab === 'tracker' && !loading && mode === 'calendar' && (
        <>
          {/* Date navigation */}
          <div className="flex items-center justify-between mb-5 bg-surface border border-border rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <button onClick={() => navigate(-1)} className="text-text-muted hover:text-text-primary transition-colors p-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <button onClick={() => navigate(1)} className="text-text-muted hover:text-text-primary transition-colors p-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
              <p className="text-sm font-semibold text-text-primary ml-1">{navLabel}</p>
              {currentDate !== today && (
                <button onClick={() => setCurrentDate(today)} className="ml-2 px-3 py-1 text-xs font-medium rounded-lg border border-wcs-red text-wcs-red hover:bg-wcs-red hover:text-white transition-colors">Today</button>
              )}
            </div>
            <div className="flex gap-1 bg-bg rounded-lg p-1">
              {['day', 'week', 'month'].map(v => (
                <button
                  key={v}
                  onClick={() => setCalView(v)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${calView === v ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
                >{v}</button>
              ))}
            </div>
          </div>

          {calView === 'day' && (
            <DayView items={itemsForDate(currentDate)} onAdd={() => setModal({ date: currentDate })} onEdit={e => setModal({ view: e })} />
          )}

          {calView === 'week' && (
            <WeekGrid weekDates={weekDates} today={today} itemsForDate={itemsForDate} onAdd={d => setModal({ date: d })} onEdit={e => setModal({ view: e })} />
          )}

          {calView === 'month' && (
            <MonthGrid weeks={monthWeeks} month={monthOfCurrent} today={today} itemsForDate={itemsForDate} onAdd={d => setModal({ date: d })} onEdit={e => setModal({ view: e })} />
          )}
        </>
      )}

      {tab === 'tracker' && !loading && mode === 'list' && (
        <ListView efforts={filtered} onEdit={e => setModal({ view: e })} />
      )}

      {modal && modal.view && (
        <ViewModal
          effort={modal.view}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ effort: modal.view })}
          onChanged={async () => {
            const list = await load()
            setModal(m => (m && m.view) ? { view: list.find(x => x.id === m.view.id) || m.view } : m)
          }}
          onDeleted={() => { setModal(null); load() }}
        />
      )}

      {modal && !modal.view && (
        <EffortModal
          effort={modal.effort || null}
          defaultDate={modal.date || currentDate}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
          onDeleted={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}

// --- Calendar sub-views ---

function EffortChip({ effort, onEdit, compact }) {
  const st = typeStyle(effort.type)
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onEdit(effort) }}
      className={`w-full text-left rounded-md border px-1.5 py-1 transition-all cursor-pointer hover:ring-1 hover:ring-wcs-red/30 ${st.chip}`}
      title={`${typeLabel(effort.type)} · ${effort.title}`}
    >
      <div className="flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
        <span className="text-[11px] font-medium text-text-primary truncate leading-tight">{effort.title}</span>
      </div>
      {!compact && (
        <span className="block text-[9px] font-semibold uppercase tracking-wide text-text-muted truncate">{typeLabel(effort.type)}</span>
      )}
    </button>
  )
}

function DayView({ items, onAdd, onEdit }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 bg-surface border border-border rounded-xl">
        <p className="text-sm text-text-muted mb-3">Nothing scheduled for this day</p>
        <button onClick={onAdd} className="px-3 py-1.5 rounded-lg border border-wcs-red text-wcs-red text-xs font-semibold hover:bg-wcs-red hover:text-white transition-colors">+ Add effort</button>
      </div>
    )
  }
  return (
    <div className="space-y-2.5">
      {items.map(e => {
        const st = typeStyle(e.type)
        const status = STATUS_BY_KEY[e.status]
        return (
          <div
            key={e.id}
            onClick={() => onEdit(e)}
            className="bg-surface border border-border rounded-xl p-4 flex items-center gap-4 cursor-pointer hover:border-wcs-red/50 transition-all"
          >
            <div className="text-center min-w-[64px]">
              <p className="text-sm font-bold text-wcs-red">{formatTime(e.start_at) || '—'}</p>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <p className="text-sm font-semibold text-text-primary">{e.title}</p>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border uppercase tracking-wide inline-flex items-center gap-1 ${st.badge}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{typeLabel(e.type)}
                </span>
              </div>
              <p className="text-xs text-text-muted">{locationsLabel(e.locations)}</p>
            </div>
            {status && <span className={`px-2.5 py-1 rounded-full text-xs font-medium border shrink-0 ${status.badge}`}>{status.label}</span>}
          </div>
        )
      })}
    </div>
  )
}

function WeekGrid({ weekDates, today, itemsForDate, onAdd, onEdit }) {
  return (
    <div className="border border-border rounded-xl overflow-hidden bg-surface">
      <div className="grid grid-cols-7 border-b border-border">
        {weekDates.map((date, i) => {
          const isToday = date === today
          const d = new Date(date + 'T12:00:00')
          return (
            <div key={date} className={`text-center py-2.5 ${isToday ? 'bg-wcs-red/5' : ''} ${i !== 0 ? 'border-l border-border' : ''}`}>
              <p className="text-[11px] font-medium text-text-muted uppercase tracking-wider">{d.toLocaleDateString('en-US', { weekday: 'short' })}</p>
              <p className={`text-lg font-bold mt-0.5 ${isToday ? 'text-white bg-wcs-red w-8 h-8 rounded-full flex items-center justify-center mx-auto' : 'text-text-primary'}`}>{d.getDate()}</p>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-7 min-h-[420px]">
        {weekDates.map((date, i) => {
          const items = itemsForDate(date)
          const isToday = date === today
          return (
            <div
              key={date}
              onClick={() => onAdd(date)}
              className={`${isToday ? 'bg-wcs-red/[0.02]' : ''} ${i !== 0 ? 'border-l border-border' : ''} p-1.5 flex flex-col gap-1 cursor-pointer hover:bg-wcs-red/[0.03] transition-colors`}
            >
              {items.map(e => <EffortChip key={e.id} effort={e} onEdit={onEdit} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthGrid({ weeks, month, today, itemsForDate, onAdd, onEdit }) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return (
    <div className="border border-border rounded-xl overflow-hidden bg-surface">
      <div className="grid grid-cols-7 border-b border-border">
        {dayNames.map(n => (
          <div key={n} className="text-center py-2 text-[11px] font-medium text-text-muted uppercase tracking-wider border-l border-border first:border-l-0">{n}</div>
        ))}
      </div>
      <div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-border last:border-b-0">
            {week.map((date, di) => {
              const d = new Date(date + 'T12:00:00')
              const inMonth = d.getMonth() === month
              const isToday = date === today
              const items = itemsForDate(date)
              return (
                <div
                  key={date}
                  onClick={() => onAdd(date)}
                  className={`min-h-[96px] p-1.5 flex flex-col gap-1 cursor-pointer transition-colors ${di !== 0 ? 'border-l border-border' : ''} ${inMonth ? 'hover:bg-wcs-red/[0.03]' : 'bg-bg/40'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${isToday ? 'text-white bg-wcs-red w-5 h-5 rounded-full flex items-center justify-center' : inMonth ? 'text-text-primary' : 'text-text-muted/50'}`}>{d.getDate()}</span>
                  </div>
                  {/* Show every item — the cell (and its week row, via grid
                      stretch) grows to fit. min-h floor keeps quiet days at the
                      current size. */}
                  <div className="flex flex-col gap-0.5">
                    {items.map(e => <EffortChip key={e.id} effort={e} onEdit={onEdit} compact />)}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function ListView({ efforts, onEdit }) {
  const sorted = useMemo(() => [...efforts].sort((a, b) => new Date(b.start_at) - new Date(a.start_at)), [efforts])
  if (sorted.length === 0) {
    return <p className="empty-card mx-auto block my-8">No marketing efforts match these filters.</p>
  }
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted">
            <th className="px-4 py-2.5 font-semibold">Date</th>
            <th className="px-4 py-2.5 font-semibold">Title</th>
            <th className="px-4 py-2.5 font-semibold">Type</th>
            <th className="px-4 py-2.5 font-semibold">Locations</th>
            <th className="px-4 py-2.5 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(e => {
            const st = typeStyle(e.type)
            const status = STATUS_BY_KEY[e.status]
            return (
              <tr key={e.id} onClick={() => onEdit(e)} className="border-b border-border last:border-b-0 cursor-pointer hover:bg-bg/60 transition-colors">
                <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                  {new Date(e.start_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {e.end_at && <span className="text-text-muted/60"> – {new Date(e.end_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                </td>
                <td className="px-4 py-3 font-medium text-text-primary">{e.title}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border uppercase tracking-wide inline-flex items-center gap-1 ${st.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{typeLabel(e.type)}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted">{locationsLabel(e.locations)}</td>
                <td className="px-4 py-3">{status && <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${status.badge}`}>{status.label}</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// --- Read-only detail view (with inline status + comments) ---

export function ViewModal({ effort, onClose, onEdit, onChanged, onDeleted }) {
  const typeDef = TYPE_BY_SLUG[effort.type]
  const st = typeStyle(effort.type)

  const [status, setStatus] = useState(effort.status)
  const [statusSaving, setStatusSaving] = useState(false)
  const [comments, setComments] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    function loadComments(initial) {
      getMarketingEffortComments(effort.id)
        .then(r => { if (alive) setComments(r.comments || []) })
        .catch(() => { if (alive && initial) setComments([]) })
    }
    loadComments(true)
    // Poll so a teammate's comment appears while you have the effort open.
    const timer = setInterval(() => { if (document.visibilityState === 'visible') loadComments(false) }, 15000)
    return () => { alive = false; clearInterval(timer) }
  }, [effort.id])

  async function changeStatus(next) {
    if (next === status || statusSaving) return
    const prev = status
    setStatus(next); setStatusSaving(true); setErr('')
    try {
      await updateMarketingEffortStatus(effort.id, next)
      if (onChanged) onChanged()
    } catch (e) {
      setStatus(prev); setErr(e.message)
    } finally {
      setStatusSaving(false)
    }
  }

  async function postComment() {
    const body = commentText.trim()
    if (!body || posting) return
    setPosting(true); setErr('')
    try {
      const r = await addMarketingEffortComment(effort.id, body)
      setComments(prev => [...(prev || []), r.comment])
      setCommentText('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setPosting(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this marketing effort?')) return
    setDeleting(true); setErr('')
    try {
      await deleteMarketingEffort(effort.id)
      onDeleted()
    } catch (e) {
      setErr(e.message); setDeleting(false)
    }
  }

  const filledFields = (typeDef?.fields || []).filter(f => {
    const v = effort.custom?.[f.key]
    return v !== undefined && v !== null && String(v).trim() !== ''
  })

  const startStr = formatLongDate(isoToDateStr(effort.start_at))
  const startT = formatTime(effort.start_at)
  const endStr = effort.end_at ? formatLongDate(isoToDateStr(effort.end_at)) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3 sticky top-0 bg-surface z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-text-primary">{effort.title}</h3>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border uppercase tracking-wide inline-flex items-center gap-1 ${st.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{typeLabel(effort.type)}
              </span>
            </div>
            {effort.created_by_name && (
              <p className="text-[11px] text-text-muted mt-1">
                Created by <span className="font-semibold text-text-primary">{effort.created_by_name}</span>
                {effort.created_at && <> · {formatCommentTime(effort.created_at)}</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onEdit} className="px-2.5 py-1.5 rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-text-muted text-xs font-semibold transition-colors">Edit</button>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {err && <p className="text-sm text-wcs-red">{err}</p>}

          {/* Status — the only editable field here */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Status</span>
              {statusSaving && <span className="text-[10px] text-text-muted">saving…</span>}
            </div>
            <div className="inline-flex rounded-lg border border-border overflow-hidden">
              {STATUSES.map((s, i) => (
                <button
                  key={s.key}
                  onClick={() => changeStatus(s.key)}
                  disabled={statusSaving}
                  className={`px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${i !== 0 ? 'border-l border-border' : ''} ${status === s.key ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted hover:text-text-primary'}`}
                >{s.label}</button>
              ))}
            </div>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">When</span>
              <p className="text-sm text-text-primary">{startStr}{startT ? `, ${startT}` : ''}</p>
              {endStr && <p className="text-sm text-text-muted">through {endStr}</p>}
            </div>
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Locations</span>
              <p className="text-sm text-text-primary">{locationsLabel(effort.locations)}</p>
            </div>
          </div>

          {/* Type-specific details */}
          {filledFields.length > 0 && (
            <div className="space-y-4 pt-1 border-t border-border">
              {filledFields.map(f => {
                const v = effort.custom[f.key]
                return (
                  <div key={f.key}>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">{f.label}</span>
                    {f.type === 'url' ? (
                      <div className="space-y-2">
                        <ExternalLink url={v} />
                        <AssetPreview url={v} />
                      </div>
                    ) : f.type === 'textarea' ? (
                      <p className="text-sm text-text-primary whitespace-pre-wrap">{v}</p>
                    ) : (
                      <p className="text-sm text-text-primary">{v}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Notes */}
          {effort.notes && (
            <div className="pt-1 border-t border-border">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1 pt-1">Notes</span>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{effort.notes}</p>
            </div>
          )}

          {/* Activity — comments + recorded edits, oldest first. The first
              entry is always "created by", derived from the effort itself. */}
          <div className="pt-1 border-t border-border">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2 pt-1">
              Activity
            </span>
            <div className="space-y-2.5 mb-3">
              {comments === null && <p className="text-xs text-text-muted">Loading…</p>}
              {comments !== null && (
                <>
                  {/* Created-by — synthetic first item from the effort record */}
                  <div className="flex items-baseline justify-between gap-2 text-xs px-1">
                    <span className="text-text-muted">
                      <span className="font-semibold text-text-primary">{effort.created_by_name || 'Someone'}</span> created this effort
                    </span>
                    {effort.created_at && <span className="text-[10px] text-text-muted/80 shrink-0">{formatCommentTime(effort.created_at)}</span>}
                  </div>
                  {comments.map(c => c.kind === 'edit' ? (
                    <div key={c.id} className="flex items-baseline justify-between gap-2 text-xs px-1">
                      <span className="text-text-muted">
                        <span className="font-semibold text-text-primary">{c.created_by_name || 'Someone'}</span>{' '}
                        {(c.meta?.changes && c.meta.changes.length > 0)
                          ? c.meta.changes.map((ch, i) => <span key={i}>{i > 0 ? ', ' : ''}{changePhrase(effort, ch)}</span>)
                          : (c.body || 'made a change')}
                      </span>
                      <span className="text-[10px] text-text-muted/80 shrink-0">{formatCommentTime(c.created_at)}</span>
                    </div>
                  ) : (
                    <div key={c.id} className="rounded-lg bg-bg border border-border p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-text-primary">{c.created_by_name || 'Unknown'}</span>
                        <span className="text-[10px] text-text-muted">{formatCommentTime(c.created_at)}</span>
                      </div>
                      <p className="text-sm text-text-primary whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComment() }}
                placeholder="Add a comment…"
                className="flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red resize-none"
              />
              <button
                onClick={postComment}
                disabled={posting || !commentText.trim()}
                className="px-3 py-2 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50 shrink-0"
              >{posting ? 'Posting…' : 'Add Comment'}</button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between sticky bottom-0 bg-surface">
          <button onClick={handleDelete} disabled={deleting} className="px-3 py-2 rounded-lg text-xs font-semibold text-wcs-red border border-wcs-red/30 hover:bg-wcs-red/10 transition-colors disabled:opacity-50">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-primary transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}

// --- Add / Edit modal ---

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red'
const labelClass = 'block text-xs font-medium text-text-muted mb-1'

export function EffortModal({ effort, defaultDate, onClose, onSaved, onDeleted }) {
  const editing = !!effort
  const startParts = effort ? isoToParts(effort.start_at) : { date: defaultDate, time: '' }
  const endParts = effort?.end_at ? isoToParts(effort.end_at) : { date: '', time: '' }

  const [title, setTitle] = useState(effort?.title || '')
  const [type, setType] = useState(effort?.type || MARKETING_TYPES[0].slug)
  const [status, setStatus] = useState(effort?.status || 'planned')
  const [startDate, setStartDate] = useState(startParts.date)
  const [startTime, setStartTime] = useState(startParts.time)
  const [endDate, setEndDate] = useState(endParts.date)
  const [endTime, setEndTime] = useState(endParts.time)
  const [locations, setLocations] = useState(() => new Set(effort?.locations || []))
  const [custom, setCustom] = useState(() => ({ ...(effort?.custom || {}) }))
  const [notes, setNotes] = useState(effort?.notes || '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState('')

  const typeDef = TYPE_BY_SLUG[type] || MARKETING_TYPES[0]
  const allOn = locations.size >= ALL_SLUGS.length

  function toggleLocation(slug) {
    setLocations(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const [uploading, setUploading] = useState({})
  const [uploadErr, setUploadErr] = useState('')

  function setCustomField(key, value) {
    setCustom(prev => ({ ...prev, [key]: value }))
  }

  async function handleUpload(key, file) {
    if (!file) return
    setUploadErr('')
    setUploading(u => ({ ...u, [key]: true }))
    try {
      const r = await uploadMarketingAsset(file)
      setCustomField(key, r.link)
    } catch (e) {
      setUploadErr(e.message)
    } finally {
      setUploading(u => ({ ...u, [key]: false }))
    }
  }

  async function handleSave() {
    setErr('')
    if (!title.trim()) return setErr('Title is required')
    if (!startDate) return setErr('Start date is required')
    if (locations.size === 0) return setErr('Pick at least one location')

    // Trim custom to only the fields relevant to the chosen type.
    const trimmedCustom = {}
    for (const f of typeDef.fields) {
      const v = custom[f.key]
      if (v !== undefined && v !== null && String(v).trim() !== '') trimmedCustom[f.key] = v
    }

    const payload = {
      title: title.trim(),
      type,
      status,
      start_at: partsToIso(startDate, startTime),
      end_at: endDate ? partsToIso(endDate, endTime) : null,
      locations: [...locations],
      custom: trimmedCustom,
      notes: notes.trim() || null,
    }

    setSaving(true)
    try {
      if (editing) await updateMarketingEffort(effort.id, payload)
      else await createMarketingEffort(payload)
      onSaved()
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editing) return
    if (!window.confirm('Delete this marketing effort?')) return
    setDeleting(true)
    try {
      await deleteMarketingEffort(effort.id)
      onDeleted()
    } catch (e) {
      setErr(e.message)
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <h3 className="text-lg font-bold text-text-primary">{editing ? 'Edit Effort' : 'New Marketing Effort'}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {err && <p className="text-sm text-wcs-red">{err}</p>}
          {uploadErr && <p className="text-sm text-wcs-red">{uploadErr}</p>}

          <label className="block">
            <span className={labelClass}>Title <span className="text-wcs-red">*</span></span>
            <input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} placeholder="What is this effort?" autoFocus />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Type <span className="text-wcs-red">*</span></span>
              <select className={inputClass} value={type} onChange={e => setType(e.target.value)}>
                {MARKETING_TYPES.map(t => <option key={t.slug} value={t.slug}>{t.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Status</span>
              <select className={inputClass} value={status} onChange={e => setStatus(e.target.value)}>
                {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Start date <span className="text-wcs-red">*</span></span>
              <input type="date" className={inputClass} value={startDate} onChange={e => setStartDate(e.target.value)} />
            </label>
            <label className="block">
              <span className={labelClass}>Start time</span>
              <input type="time" className={inputClass} value={startTime} onChange={e => setStartTime(e.target.value)} />
            </label>
            <label className="block">
              <span className={labelClass}>End date <span className="text-text-muted/60">(optional)</span></span>
              <input type="date" className={inputClass} value={endDate} min={startDate} onChange={e => { setEndDate(e.target.value); if (!e.target.value) setEndTime('') }} />
            </label>
            <label className="block">
              <span className={labelClass}>End time</span>
              <input type="time" className={inputClass} value={endTime} onChange={e => setEndTime(e.target.value)} disabled={!endDate} />
            </label>
          </div>

          {/* Locations */}
          <div>
            <span className={labelClass}>Locations <span className="text-wcs-red">*</span></span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setLocations(allOn ? new Set() : new Set(ALL_SLUGS))}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${allOn ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
              >All</button>
              {LOCATION_NAMES.map(name => {
                const slug = name.toLowerCase()
                const on = locations.has(slug)
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => toggleLocation(slug)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${on ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
                  >{name}</button>
                )
              })}
            </div>
          </div>

          {/* Type-specific custom fields */}
          {typeDef.fields.length > 0 && (
            <div className="space-y-4 pt-1 border-t border-border">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted pt-2">{typeDef.label} details</p>
              {typeDef.fields.map(f => (
                <div key={f.key}>
                  <span className={labelClass}>{f.label}</span>
                  {f.type === 'textarea' ? (
                    <textarea rows={3} className={inputClass + ' resize-none'} value={custom[f.key] || ''} onChange={e => setCustomField(f.key, e.target.value)} />
                  ) : f.type === 'select' ? (
                    <select className={inputClass} value={custom[f.key] || ''} onChange={e => setCustomField(f.key, e.target.value)}>
                      <option value="">Select...</option>
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'url' ? (
                    <>
                      <div className="flex items-center gap-2">
                        <input type="url" className={inputClass} value={custom[f.key] || ''} onChange={e => setCustomField(f.key, e.target.value)} placeholder="https://… or upload" />
                        <label className={`shrink-0 px-3 py-2 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${uploading[f.key] ? 'border-border text-text-muted' : 'border-border text-text-muted hover:text-wcs-red hover:border-wcs-red'}`}>
                          {uploading[f.key] ? 'Uploading…' : 'Upload'}
                          <input
                            type="file"
                            accept="image/*,video/*,application/pdf"
                            className="hidden"
                            disabled={uploading[f.key]}
                            onChange={e => { const file = e.target.files?.[0]; if (file) handleUpload(f.key, file); e.target.value = '' }}
                          />
                        </label>
                      </div>
                      <span className="block text-[10px] text-text-muted mt-1">Upload a photo/video/PDF — it’s saved to Drive at full quality and the link is filled in.</span>
                    </>
                  ) : (
                    <input type="text" className={inputClass} value={custom[f.key] || ''} onChange={e => setCustomField(f.key, e.target.value)} />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          <label className="block">
            <span className={labelClass}>Notes</span>
            <textarea rows={2} className={inputClass + ' resize-none'} value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
        </div>

        <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3 sticky bottom-0 bg-surface">
          {editing ? (
            <button onClick={handleDelete} disabled={deleting || saving} className="px-3 py-2 rounded-lg text-xs font-semibold text-wcs-red border border-wcs-red/30 hover:bg-wcs-red/10 transition-colors disabled:opacity-50">
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-primary transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50">
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
