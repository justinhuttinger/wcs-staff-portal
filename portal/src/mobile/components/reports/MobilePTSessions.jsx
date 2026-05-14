import React, { useState, useEffect, useMemo } from 'react'
import { getPTSessionsReport, getPTSessionsTrainer } from '../../../lib/api'
import MobileLoading from '../MobileLoading'
import { useCancellableFetch } from '../../../hooks/useCancellableFetch'

const SORT_OPTIONS = [
  { key: 'top', label: 'Top Sessions' },
  { key: 'az', label: 'A-Z' },
  { key: 'completed', label: 'Top Completed' },
  { key: 'canceled', label: 'Top Canceled' },
]

const EVENT_TYPE_ORDER = [
  'PT60', 'PT30',
  'Partner60', 'Partner30',
  'Consult',
  'Floor Hour',
  'Stretch 30', 'Stretch 60',
  'Swim',
  'Small Group',
  'MISC',
]

function eventTypeRank(t) {
  const i = EVENT_TYPE_ORDER.indexOf(t)
  return i === -1 ? EVENT_TYPE_ORDER.length : i
}

const EVENT_TYPE_COLOR = {
  'PT60':        '#e53e3e',
  'PT30':        '#ed8936',
  'Partner60':   '#d69e2e',
  'Partner30':   '#ecc94b',
  'Consult':     '#319795',
  'Floor Hour':  '#3182ce',
  'Stretch 30':  '#805ad5',
  'Stretch 60':  '#b794f4',
  'Swim':        '#38b2ac',
  'Small Group': '#48bb78',
  'MISC':        '#718096',
}

function colorFor(type) {
  return EVENT_TYPE_COLOR[type] || '#718096'
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function StatCard({ label, value }) {
  return (
    <div className="min-w-[130px] bg-surface rounded-2xl border border-border p-4 flex-shrink-0">
      <p className="text-3xl font-bold text-text-primary">{value}</p>
      <p className="text-xs text-text-muted uppercase mt-1">{label}</p>
    </div>
  )
}

function DrillSessions({ sessions }) {
  const groups = useMemo(() => {
    const byType = new Map()
    for (const s of sessions) {
      const key = s.event_type || 'MISC'
      if (!byType.has(key)) byType.set(key, [])
      byType.get(key).push(s)
    }
    const ordered = [...byType.entries()].sort((a, b) => {
      const ra = eventTypeRank(a[0])
      const rb = eventTypeRank(b[0])
      if (ra !== rb) return ra - rb
      return a[0].localeCompare(b[0])
    })
    for (const [, list] of ordered) {
      list.sort((a, b) => {
        const ta = a.event_timestamp_local || ''
        const tb = b.event_timestamp_local || ''
        return ta < tb ? -1 : ta > tb ? 1 : 0
      })
    }
    return ordered
  }, [sessions])

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      {groups.map(([type, list]) => {
        const color = colorFor(type)
        return (
          <div key={type}>
            <div
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold mb-2"
              style={{ backgroundColor: hexToRgba(color, 0.12), color }}
            >
              {type}
              <span className="opacity-70">({list.length})</span>
            </div>
            <div className="space-y-1.5">
              {list.map((s) => {
                const dt = (s.event_timestamp_local || '').replace('T', ' ').slice(0, 16)
                const [date, time] = dt.split(' ')
                return (
                  <div
                    key={s.event_id}
                    className="bg-bg rounded-xl p-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-medium text-text-primary">{s.member_name || '—'}</span>
                      <span className="text-text-muted tabular-nums">{date || '—'} {time || ''}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-text-secondary truncate">{s.event_name || '—'}</span>
                      <span
                        className={`ml-2 flex-shrink-0 font-medium ${
                          s.status === 'Completed' ? 'text-green-600' : 'text-orange-500'
                        }`}
                      >
                        {s.status || '—'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function MobilePTSessions({ startDate, endDate, locationSlug }) {
  const [sortKey, setSortKey] = useState('top')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [drill, setDrill] = useState({})

  // Reset drill state when filters change.
  useEffect(() => {
    setDrill({})
    setExpanded(null)
  }, [startDate, endDate, locationSlug])

  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      if (!startDate || !endDate || !locationSlug) return Promise.resolve(null)
      return getPTSessionsReport(
        { start_date: startDate, end_date: endDate, location_slug: locationSlug },
        { cache: true, signal }
      )
    },
    [startDate, endDate, locationSlug]
  )

  async function toggleExpanded(employeeId) {
    if (expanded === employeeId) {
      setExpanded(null)
      return
    }
    setExpanded(employeeId)
    if (drill[employeeId]) return

    setDrill(c => ({ ...c, [employeeId]: { loading: true, sessions: null } }))
    try {
      const res = await getPTSessionsTrainer(
        employeeId,
        { start_date: startDate, end_date: endDate, location_slug: locationSlug },
        { cache: true }
      )
      setDrill(c => ({ ...c, [employeeId]: { loading: false, sessions: res.sessions } }))
    } catch (e) {
      setDrill(c => ({ ...c, [employeeId]: { loading: false, sessions: [], error: e?.message } }))
    }
  }

  const sortedTrainers = useMemo(() => {
    if (!data?.trainers) return []
    let list = [...data.trainers]
    const q = search.toLowerCase()
    if (q) list = list.filter(t => (t.employee_name || '').toLowerCase().includes(q))
    switch (sortKey) {
      case 'top':       list.sort((a, b) => b.total - a.total); break
      case 'az':        list.sort((a, b) => (a.employee_name || '').localeCompare(b.employee_name || '')); break
      case 'completed': list.sort((a, b) => b.completed - a.completed); break
      case 'canceled':  list.sort((a, b) => b.canceled_charge - a.canceled_charge); break
    }
    return list
  }, [data, sortKey, search])

  if (loading) return <MobileLoading variant="report" />

  if (error) return (
    <div className="p-4">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-red-600">{error.message || String(error)}</p>
      </div>
    </div>
  )

  if (!data || !data.trainers || data.trainers.length === 0) {
    return (
      <div className="p-4">
        <div className="bg-surface border border-border rounded-2xl p-6 text-center">
          <p className="text-sm text-text-muted">No sessions in this date range.</p>
        </div>
      </div>
    )
  }

  const summary = data.summary || {}
  const eventTypes = data.event_types || []

  return (
    <div className="p-4 space-y-3">
      {/* Stat cards - horizontal scroll */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 min-w-max">
          <StatCard label="Total Sessions" value={(summary.total_sessions || 0).toLocaleString()} />
          <StatCard label="Completed" value={(summary.completed || 0).toLocaleString()} />
          <StatCard label="Canceled-Charge" value={(summary.canceled_charge || 0).toLocaleString()} />
          <StatCard label="Trainers" value={data.trainers.length} />
        </div>
      </div>

      {/* Sort pills */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSortKey(opt.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                sortKey === opt.key
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search trainer..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-text-muted"
      />

      {/* Trainer cards */}
      <div className="space-y-2">
        {sortedTrainers.map(t => {
          const isOpen = expanded === t.employee_id
          const dr = drill[t.employee_id]
          const eventPills = eventTypes
            .map(ev => {
              const cell = t.by_event_type?.[ev] || {}
              const total = (cell.completed || 0) + (cell.canceled_charge || 0)
              return total > 0 ? { ev, total } : null
            })
            .filter(Boolean)

          return (
            <div
              key={t.employee_id}
              className="bg-surface rounded-2xl border border-border p-4"
            >
              {/* Header row */}
              <button
                className="w-full flex items-center justify-between"
                onClick={() => toggleExpanded(t.employee_id)}
              >
                <div className="text-left">
                  <p className="text-sm font-semibold text-text-primary">{t.employee_name || 'Unknown'}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t.total} total &middot; {t.completed} completed &middot; {t.canceled_charge} canceled
                  </p>
                </div>
                <span className="text-text-muted text-xs ml-3 flex-shrink-0">
                  {isOpen ? '▼' : '▶'}
                </span>
              </button>

              {/* Event type pills */}
              {eventPills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {eventPills.map(({ ev, total }) => {
                    const color = colorFor(ev)
                    return (
                      <span
                        key={ev}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: hexToRgba(color, 0.12),
                          color,
                        }}
                      >
                        {ev}: {total}
                      </span>
                    )
                  })}
                </div>
              )}

              {/* Inline drill-down */}
              {isOpen && (
                <>
                  {dr?.loading && (
                    <div className="mt-3 pt-3 border-t border-border text-xs text-text-muted">
                      Loading sessions…
                    </div>
                  )}
                  {dr?.error && (
                    <div className="mt-3 pt-3 border-t border-border text-xs text-red-500">
                      Error: {dr.error}
                    </div>
                  )}
                  {dr?.sessions && dr.sessions.length === 0 && (
                    <div className="mt-3 pt-3 border-t border-border text-xs text-text-muted">
                      No sessions found.
                    </div>
                  )}
                  {dr?.sessions && dr.sessions.length > 0 && (
                    <DrillSessions sessions={dr.sessions} />
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Totals footer */}
      <div className="bg-surface rounded-2xl border-2 border-wcs-red p-4">
        <p className="text-sm font-bold text-text-primary mb-2">Totals</p>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-wcs-red border border-red-200">
            Total: {(summary.total_sessions || 0).toLocaleString()}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
            Completed: {(summary.completed || 0).toLocaleString()}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200">
            Canceled: {(summary.canceled_charge || 0).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  )
}
