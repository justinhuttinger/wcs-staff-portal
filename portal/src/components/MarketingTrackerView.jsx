import { useState, useEffect, useMemo } from 'react'
import {
  getMarketingEfforts, createMarketingEffort, updateMarketingEffort, deleteMarketingEffort,
} from '../lib/api'
import { LOCATION_NAMES, LOCATION_OPTIONS } from '../config/locations'
import LocationMultiSelect from './LocationMultiSelect'
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

// --- Main view ---

export default function MarketingTrackerView({ onBack }) {
  const [efforts, setEfforts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('calendar')          // 'calendar' | 'list'
  const [calView, setCalView] = useState('month')        // 'day' | 'week' | 'month'
  const [currentDate, setCurrentDate] = useState(todayStr())
  const [typeFilter, setTypeFilter] = useState(() => new Set(MARKETING_TYPES.map(t => t.slug)))
  const [locationValue, setLocationValue] = useState('all')
  const [modal, setModal] = useState(null)               // { effort } | { date } | null

  function load() {
    setLoading(true)
    setError('')
    getMarketingEfforts()
      .then(res => setEfforts(res.efforts || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const locationSet = useMemo(() => {
    if (!locationValue || locationValue === 'all') return null // null = all
    return new Set(String(locationValue).split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  }, [locationValue])

  const filtered = useMemo(() => {
    return efforts.filter(e => {
      if (!typeFilter.has(e.type)) return false
      if (locationSet) {
        const locs = e.locations || []
        if (!locs.some(l => locationSet.has(l))) return false
      }
      return true
    })
  }, [efforts, typeFilter, locationSet])

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

  function toggleType(slug) {
    setTypeFilter(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const allTypesOn = typeFilter.size === MARKETING_TYPES.length
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
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-text-primary">Marketing Tracker</h2>
            <span className="px-2 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red text-[10px] font-bold uppercase tracking-wider border border-wcs-red/20">Experimental</span>
          </div>
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
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <LocationMultiSelect value={locationValue} onChange={setLocationValue} options={LOCATION_OPTIONS.filter(o => o.slug !== 'all')} />
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setTypeFilter(allTypesOn ? new Set() : new Set(MARKETING_TYPES.map(t => t.slug)))}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${allTypesOn ? 'bg-text-primary text-white border-text-primary' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
            >
              All Types
            </button>
            {MARKETING_TYPES.map(t => {
              const on = typeFilter.has(t.slug)
              const st = typeStyle(t.slug)
              return (
                <button
                  key={t.slug}
                  onClick={() => toggleType(t.slug)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors inline-flex items-center gap-1.5 ${on ? st.badge : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${on ? st.dot : 'bg-text-muted/40'}`} />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}
      {loading && <p className="loading-card mx-auto block my-6">Loading marketing tracker...</p>}

      {!loading && mode === 'calendar' && (
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
            <DayView items={itemsForDate(currentDate)} onAdd={() => setModal({ date: currentDate })} onEdit={e => setModal({ effort: e })} />
          )}

          {calView === 'week' && (
            <WeekGrid weekDates={weekDates} today={today} itemsForDate={itemsForDate} onAdd={d => setModal({ date: d })} onEdit={e => setModal({ effort: e })} />
          )}

          {calView === 'month' && (
            <MonthGrid weeks={monthWeeks} month={monthOfCurrent} today={today} itemsForDate={itemsForDate} onAdd={d => setModal({ date: d })} onEdit={e => setModal({ effort: e })} />
          )}
        </>
      )}

      {!loading && mode === 'list' && (
        <ListView efforts={filtered} onEdit={e => setModal({ effort: e })} />
      )}

      {modal && (
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
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {items.slice(0, 3).map(e => <EffortChip key={e.id} effort={e} onEdit={onEdit} compact />)}
                    {items.length > 3 && <span className="text-[10px] text-text-muted pl-1">+{items.length - 3} more</span>}
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

// --- Add / Edit modal ---

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red'
const labelClass = 'block text-xs font-medium text-text-muted mb-1'

function EffortModal({ effort, defaultDate, onClose, onSaved, onDeleted }) {
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

  function setCustomField(key, value) {
    setCustom(prev => ({ ...prev, [key]: value }))
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
                <label key={f.key} className="block">
                  <span className={labelClass}>{f.label}</span>
                  {f.type === 'textarea' ? (
                    <textarea rows={3} className={inputClass + ' resize-none'} value={custom[f.key] || ''} onChange={e => setCustomField(f.key, e.target.value)} />
                  ) : f.type === 'select' ? (
                    <select className={inputClass} value={custom[f.key] || ''} onChange={e => setCustomField(f.key, e.target.value)}>
                      <option value="">Select...</option>
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={f.type === 'url' ? 'url' : 'text'} className={inputClass} value={custom[f.key] || ''} onChange={e => setCustomField(f.key, e.target.value)} placeholder={f.type === 'url' ? 'https://...' : ''} />
                  )}
                </label>
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
