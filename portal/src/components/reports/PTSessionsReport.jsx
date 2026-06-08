import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { getPTSessionsReport, getPTSessionsTrainer } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatBlock, StatCell } from './StatBlock'

const ALL_STATUSES = ['Completed', 'Canceled-Charge']

const EVENT_GROUPS = [
  { key: 'all',     label: 'All Sessions' },
  { key: 'pt',      label: 'PT' },
  { key: 'swim',    label: 'Swim' },
  { key: 'stretch', label: 'Stretch' },
]

// Mirror of the server's COLUMN_ORDER. Used to sort drill-down sessions
// by event-type group, then by date within each group.
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

// Stable color per canonical event type. Anything not listed falls to slate.
const EVENT_TYPE_COLOR = {
  'PT60':        '#e53e3e', // WCS red
  'PT30':        '#ed8936', // orange
  'Partner60':   '#d69e2e', // amber
  'Partner30':   '#ecc94b', // yellow
  'Consult':     '#319795', // teal
  'Floor Hour':  '#3182ce', // blue
  'Stretch 30':  '#805ad5', // purple
  'Stretch 60':  '#b794f4', // light purple
  'Swim':        '#38b2ac', // cyan
  'Small Group': '#48bb78', // green
  'MISC':        '#718096', // slate
}
function colorFor(type) {
  return EVENT_TYPE_COLOR[type] || '#718096'
}

function CenterCard({ children }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-6 text-center text-sm text-text-muted">
      {children}
    </div>
  )
}

function Th({ children, onClick, active, dir, align = 'left', minWidth }) {
  const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 cursor-pointer select-none text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${alignClass} ${
        active ? 'text-text-primary' : 'text-text-muted'
      }`}
      style={minWidth ? { minWidth } : undefined}
    >
      {children}
      {active && <span className="ml-1">{dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )
}

function csvCell(v) {
  const s = v == null ? '' : String(v)
  // RFC 4180-ish: quote if comma, quote, or newline; double up internal quotes
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function PTSessionsReport({ startDate, endDate, locationSlug }) {
  const [statuses, setStatuses] = useState(ALL_STATUSES)
  const [eventGroup, setEventGroup] = useState('all')
  const [sortKey, setSortKey] = useState('total')
  const [sortDir, setSortDir] = useState('desc')
  const [expanded, setExpanded] = useState(null)
  const [drill, setDrill] = useState({})
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [printDetail, setPrintDetail] = useState(false) // when true, render every trainer expanded for print
  const exportMenuRef = useRef(null)

  // Close export menu on outside click
  useEffect(() => {
    if (!exportMenuOpen) return
    function onDoc(e) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [exportMenuOpen])

  const statusKey = statuses.join(',')

  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      if (!startDate || !endDate || !locationSlug) return Promise.resolve(null)
      return getPTSessionsReport(
        {
          start_date: startDate,
          end_date: endDate,
          location_slug: locationSlug,
          status: statusKey,
          event_group: eventGroup,
        },
        { cache: true, signal }
      )
    },
    [startDate, endDate, locationSlug, statusKey, eventGroup]
  )

  // Reset drill-down state whenever the top-level filters change.
  useEffect(() => {
    setDrill({})
    setExpanded(null)
  }, [startDate, endDate, locationSlug, statusKey, eventGroup])

  const sortedTrainers = useMemo(() => {
    if (!data) return []
    const rows = [...data.trainers]
    rows.sort((a, b) => {
      let va, vb
      if (sortKey === 'name') {
        va = a.employee_name
        vb = b.employee_name
      } else if (sortKey.startsWith('et:')) {
        const ev = sortKey.slice(3)
        va = (a.by_event_type[ev]?.completed || 0) + (a.by_event_type[ev]?.canceled_charge || 0)
        vb = (b.by_event_type[ev]?.completed || 0) + (b.by_event_type[ev]?.canceled_charge || 0)
      } else {
        va = a[sortKey]
        vb = b[sortKey]
      }
      if (va === vb) return 0
      const cmp = va < vb ? -1 : 1
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [data, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  function toggleStatus(s) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  async function fetchTrainerSessions(employeeId) {
    return getPTSessionsTrainer(employeeId, {
      start_date: startDate,
      end_date: endDate,
      location_slug: locationSlug,
      status: statuses.join(','),
      event_group: eventGroup,
    })
  }

  async function toggleExpanded(employeeId) {
    if (expanded === employeeId) {
      setExpanded(null)
      return
    }
    setExpanded(employeeId)
    if (drill[employeeId]) return
    setDrill((c) => ({ ...c, [employeeId]: { loading: true, sessions: null } }))
    try {
      const d = await fetchTrainerSessions(employeeId)
      setDrill((c) => ({ ...c, [employeeId]: { loading: false, sessions: d.sessions } }))
    } catch (e) {
      setDrill((c) => ({ ...c, [employeeId]: { loading: false, sessions: [], error: e?.message } }))
    }
  }

  // Pre-fetch every trainer's drill-down sessions (used for Detail exports + Print Detail).
  // Returns a map { employee_id: sessions[] }.
  async function fetchAllDrills() {
    const result = {}
    const tasks = sortedTrainers.map(async (t) => {
      if (drill[t.employee_id]?.sessions) {
        result[t.employee_id] = drill[t.employee_id].sessions
        return
      }
      try {
        const d = await fetchTrainerSessions(t.employee_id)
        result[t.employee_id] = d.sessions
        setDrill((c) => ({ ...c, [t.employee_id]: { loading: false, sessions: d.sessions } }))
      } catch {
        result[t.employee_id] = []
      }
    })
    await Promise.all(tasks)
    return result
  }

  // -------- Exports --------

  function buildOverviewCsvLines() {
    if (!data) return []
    const cols = ['Trainer', ...data.event_types, 'Total', 'Completed', 'Canceled-Charge']
    const lines = [cols.map(csvCell).join(',')]
    for (const t of sortedTrainers) {
      const row = [t.employee_name]
      for (const ev of data.event_types) {
        const c = t.by_event_type[ev]?.completed || 0
        const cc = t.by_event_type[ev]?.canceled_charge || 0
        row.push(c + cc)
      }
      row.push(t.total, t.completed, t.canceled_charge)
      lines.push(row.map(csvCell).join(','))
    }
    return lines
  }

  async function exportCsvOverview() {
    const lines = buildOverviewCsvLines()
    if (lines.length === 0) return
    downloadBlob(lines.join('\n'), `pt-sessions-${startDate}-to-${endDate}.csv`, 'text/csv')
  }

  async function exportCsvDetail() {
    setExporting(true)
    try {
      const drills = await fetchAllDrills()
      const cols = ['Trainer', 'Date', 'Time', 'Member', 'Event Type', 'Original Event Name', 'Status', 'Attended', 'Duration (min)', 'Location']
      const lines = [cols.map(csvCell).join(',')]
      for (const t of sortedTrainers) {
        const sessions = drills[t.employee_id] || []
        for (const s of sessions) {
          const dt = (s.event_timestamp_local || '').replace('T', ' ').slice(0, 16)
          const [date, time] = dt.split(' ')
          lines.push([
            t.employee_name,
            date || '',
            time || '',
            s.member_name || '',
            s.event_type || '',
            s.event_name || '',
            s.status || '',
            s.attended_status || '',
            s.duration_minutes ?? '',
            s.location_name || '',
          ].map(csvCell).join(','))
        }
      }
      downloadBlob(lines.join('\n'), `pt-sessions-detail-${startDate}-to-${endDate}.csv`, 'text/csv')
    } finally {
      setExporting(false)
    }
  }

  async function exportPdfOverview() {
    setExporting(true)
    try {
      // Collapse any expanded rows so the printed view is just the pivot
      setPrintDetail(false)
      setExpanded(null)
      // Wait for re-render before printing
      await new Promise((r) => setTimeout(r, 60))
      window.print()
    } finally {
      setExporting(false)
    }
  }

  async function exportPdfDetail() {
    setExporting(true)
    try {
      const drills = await fetchAllDrills()
      // Push drills into state so the print render uses them
      setDrill((c) => {
        const next = { ...c }
        for (const [eid, sessions] of Object.entries(drills)) {
          next[eid] = { loading: false, sessions }
        }
        return next
      })
      setPrintDetail(true)
      // Wait for re-render before printing
      await new Promise((r) => setTimeout(r, 100))
      window.print()
      setPrintDetail(false)
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <CenterCard><span className="text-red-500">Error: {error.message || String(error)}</span></CenterCard>
  if (!data || data.trainers.length === 0) {
    return (
      <div className="space-y-4">
        <FilterBar
          eventGroup={eventGroup}
          onEventGroup={setEventGroup}
          statuses={statuses}
          onToggleStatus={toggleStatus}
          exportMenuOpen={false}
          onExportToggle={() => {}}
          onExport={() => {}}
          exporting={false}
          exportMenuRef={exportMenuRef}
          disabled
        />
        <CenterCard>No sessions in this date range.</CenterCard>
      </div>
    )
  }

  const eventTypes = data.event_types

  return (
    <div className="space-y-6 pt-sessions-report">
      <PrintStyles />

      {/* Filter row: event-group buttons, status checkboxes, export menu */}
      <FilterBar
        eventGroup={eventGroup}
        onEventGroup={setEventGroup}
        statuses={statuses}
        onToggleStatus={toggleStatus}
        exportMenuOpen={exportMenuOpen}
        onExportToggle={() => setExportMenuOpen((v) => !v)}
        onExport={(kind) => {
          setExportMenuOpen(false)
          if (kind === 'csv-overview')      exportCsvOverview()
          else if (kind === 'csv-detail')   exportCsvDetail()
          else if (kind === 'pdf-overview') exportPdfOverview()
          else if (kind === 'pdf-detail')   exportPdfDetail()
        }}
        exporting={exporting}
        exportMenuRef={exportMenuRef}
      />

      {/* Summary KPIs */}
      <StatBlock cols={3}>
        <StatCell label="Total Sessions" value={data.summary.total_sessions.toLocaleString()} />
        <StatCell label="Completed" value={data.summary.completed.toLocaleString()} />
        <StatCell label="Canceled-Charge" value={data.summary.canceled_charge.toLocaleString()} />
      </StatBlock>

      {/* Pivot table */}
      <div className="bg-surface rounded-xl border border-border p-6 overflow-x-auto">
        <table className="min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="border-b border-border">
              <Th onClick={() => toggleSort('name')} active={sortKey === 'name'} dir={sortDir} align="left" minWidth="160px">
                Trainer
              </Th>
              {eventTypes.map((ev) => (
                <Th
                  key={ev}
                  onClick={() => toggleSort('et:' + ev)}
                  active={sortKey === 'et:' + ev}
                  dir={sortDir}
                  align="center"
                  minWidth="90px"
                >
                  {ev}
                </Th>
              ))}
              <Th onClick={() => toggleSort('total')} active={sortKey === 'total'} dir={sortDir} align="center" minWidth="80px">
                Total
              </Th>
              <th className="no-print" style={{ minWidth: '40px' }} />
            </tr>
          </thead>
          <tbody>
            {sortedTrainers.map((t) => {
              const isOpen = printDetail || expanded === t.employee_id
              const dr = drill[t.employee_id]
              return (
                <Fragment key={t.employee_id}>
                  <tr className="border-b border-border/50 hover:bg-bg">
                    <td className="px-3 py-2 text-text-primary font-medium border-b border-border/50">{t.employee_name}</td>
                    {eventTypes.map((ev) => {
                      const c = t.by_event_type[ev]?.completed || 0
                      const cc = t.by_event_type[ev]?.canceled_charge || 0
                      const total = c + cc
                      const dim = total === 0 ? 'text-text-muted' : 'text-text-primary'
                      return (
                        <td key={ev} className={`px-3 py-2 text-center tabular-nums border-b border-border/50 ${dim}`}>
                          {total}
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-center font-semibold tabular-nums text-text-primary border-b border-border/50">
                      {t.total}
                    </td>
                    <td className="px-3 py-2 text-right border-b border-border/50 no-print">
                      <button
                        onClick={() => toggleExpanded(t.employee_id)}
                        className="px-2 py-0.5 rounded text-xs text-text-muted hover:text-text-primary"
                      >
                        {expanded === t.employee_id ? '▼' : '▶'}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-bg">
                      <td colSpan={eventTypes.length + 3} className="px-3 py-3">
                        {dr?.loading && <div className="text-text-muted">Loading sessions…</div>}
                        {dr?.error && <div className="text-red-500">Error: {dr.error}</div>}
                        {dr?.sessions && dr.sessions.length === 0 && (
                          <div className="text-text-muted">No sessions.</div>
                        )}
                        {dr?.sessions && dr.sessions.length > 0 && (
                          <DrillSessions sessions={dr.sessions} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FilterBar({
  eventGroup,
  onEventGroup,
  statuses,
  onToggleStatus,
  exportMenuOpen,
  onExportToggle,
  onExport,
  exporting,
  exportMenuRef,
  disabled,
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 no-print">
      <div className="flex gap-1">
        {EVENT_GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => onEventGroup(g.key)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
              eventGroup === g.key
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-surface text-text-primary border-border hover:bg-bg'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="h-6 w-px bg-border" />
      {ALL_STATUSES.map((s) => (
        <label key={s} className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={statuses.includes(s)}
            onChange={() => onToggleStatus(s)}
            disabled={disabled}
          />
          {s}
        </label>
      ))}
      <div ref={exportMenuRef} className="ml-auto relative">
        <button
          onClick={onExportToggle}
          disabled={exporting || disabled}
          className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary hover:bg-bg disabled:opacity-50"
        >
          {exporting ? 'Exporting…' : 'Export ▾'}
        </button>
        {exportMenuOpen && (
          <div className="absolute right-0 mt-1 w-56 rounded-lg border border-border bg-surface shadow-lg z-10">
            <ExportMenuItem onClick={() => onExport('csv-overview')}>CSV — Overview</ExportMenuItem>
            <ExportMenuItem onClick={() => onExport('csv-detail')}>CSV — Detail</ExportMenuItem>
            <div className="h-px bg-border" />
            <ExportMenuItem onClick={() => onExport('pdf-overview')}>PDF — Overview</ExportMenuItem>
            <ExportMenuItem onClick={() => onExport('pdf-detail')}>PDF — Detail</ExportMenuItem>
          </div>
        )}
      </div>
    </div>
  )
}

// Drill-down sessions view: groups sessions by normalized event_type
// (in the same fixed order as the pivot columns), then sorts by date asc
// within each group. Renders one table with headers per group.
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
    <div className="space-y-3">
      {groups.map(([type, list]) => (
        <div key={type}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">
            {type} <span className="text-text-muted/70">({list.length})</span>
          </div>
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-text-muted text-[10px] uppercase tracking-wide border-b border-border">
                <th className="text-left py-1 px-2 w-24">Date</th>
                <th className="text-left py-1 px-2 w-16">Time</th>
                <th className="text-left py-1 px-2">Member</th>
                <th className="text-left py-1 px-2">Original Event Name</th>
                <th className="text-left py-1 px-2 w-32">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const dt = (s.event_timestamp_local || '').replace('T', ' ').slice(0, 16)
                const [date, time] = dt.split(' ')
                return (
                  <tr key={s.event_id} className="border-b border-border/30">
                    <td className="py-1 px-2 tabular-nums">{date || '—'}</td>
                    <td className="py-1 px-2 tabular-nums">{time || '—'}</td>
                    <td className="py-1 px-2">{s.member_name || '—'}</td>
                    <td className="py-1 px-2">{s.event_name || '—'}</td>
                    <td className="py-1 px-2">{s.status || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function ExportMenuItem({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="block w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg first:rounded-t-lg last:rounded-b-lg"
    >
      {children}
    </button>
  )
}

// Donut + legend for session-type breakdown. Aggregates totals across all
// trainers (completed + canceled_charge) per event_type.
function SessionTypeChart({ trainers, eventTypes, total }) {
  const slices = useMemo(() => {
    const totals = new Map()
    for (const t of trainers) {
      for (const [ev, cell] of Object.entries(t.by_event_type || {})) {
        const v = (cell.completed || 0) + (cell.canceled_charge || 0)
        if (v > 0) totals.set(ev, (totals.get(ev) || 0) + v)
      }
    }
    const ordered = eventTypes
      .map((ev) => ({ label: ev, value: totals.get(ev) || 0 }))
      .filter((s) => s.value > 0)
    // append any types totals has but eventTypes doesn't (defensive)
    for (const [ev, v] of totals.entries()) {
      if (!ordered.find((s) => s.label === ev)) ordered.push({ label: ev, value: v })
    }
    return ordered
  }, [trainers, eventTypes])

  const sum = slices.reduce((s, x) => s + x.value, 0) || 1

  // SVG geometry
  const size = 220
  const cx = size / 2
  const cy = size / 2
  const ringR = 78
  const stroke = 28
  let angle = -Math.PI / 2 // start at top

  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">
        Sessions by Type
      </p>
      {slices.length === 0 ? (
        <p className="text-sm text-text-muted py-6 text-center">No data</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <svg viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0" style={{ width: size, height: size }}>
            {slices.map((s) => {
              const sliceAngle = (s.value / sum) * 2 * Math.PI
              // Pad zero-slice protection: if only one slice, draw full circle
              if (slices.length === 1) {
                angle += sliceAngle
                return (
                  <circle
                    key={s.label}
                    cx={cx}
                    cy={cy}
                    r={ringR}
                    fill="none"
                    stroke={colorFor(s.label)}
                    strokeWidth={stroke}
                  />
                )
              }
              const startA = angle
              const endA = angle + sliceAngle
              const x1 = cx + Math.cos(startA) * ringR
              const y1 = cy + Math.sin(startA) * ringR
              const x2 = cx + Math.cos(endA) * ringR
              const y2 = cy + Math.sin(endA) * ringR
              const largeArc = sliceAngle > Math.PI ? 1 : 0
              const path = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${ringR} ${ringR} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
              angle = endA
              return (
                <path
                  key={s.label}
                  d={path}
                  fill="none"
                  stroke={colorFor(s.label)}
                  strokeWidth={stroke}
                />
              )
            })}
            <text x={cx} y={cy - 4} textAnchor="middle" className="fill-text-muted" style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Total
            </text>
            <text x={cx} y={cy + 18} textAnchor="middle" className="fill-text-primary" style={{ fontSize: '24px', fontWeight: 700 }}>
              {total.toLocaleString()}
            </text>
          </svg>

          <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {slices.map((s) => {
              const pct = Math.round((s.value / sum) * 100)
              return (
                <div key={s.label} className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: colorFor(s.label) }}
                  />
                  <span className="flex-1 truncate text-text-primary">{s.label}</span>
                  <span className="tabular-nums text-text-primary font-medium">{s.value}</span>
                  <span className="tabular-nums text-text-muted text-xs w-9 text-right">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Horizontal bar chart of total sessions per trainer. Sorted desc.
function TrainerChart({ trainers }) {
  const rows = useMemo(() => {
    return [...trainers]
      .filter((t) => t.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [trainers])

  const max = rows.length > 0 ? Math.max(...rows.map((r) => r.total), 1) : 1

  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">
        Sessions by Trainer
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted py-6 text-center">No data</p>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <div key={t.employee_id} className="flex items-center gap-3 text-sm">
              <span className="w-32 truncate text-text-primary">{t.employee_name}</span>
              <div className="flex-1 h-5 bg-bg rounded overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${(t.total / max) * 100}%`,
                    backgroundColor: '#e53e3e',
                  }}
                />
              </div>
              <span className="w-12 text-right font-semibold text-text-primary tabular-nums">
                {t.total}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Print stylesheet: hide everything except the report when window.print() runs.
function PrintStyles() {
  return (
    <style>{`
      @media print {
        body * { visibility: hidden; }
        .pt-sessions-report, .pt-sessions-report * { visibility: visible; }
        .pt-sessions-report { position: absolute; left: 0; top: 0; width: 100%; padding: 0.5in; background: white; }
        .no-print { display: none !important; }
        .pt-sessions-report .bg-surface { background: white !important; box-shadow: none !important; border-color: #ccc !important; }
        .pt-sessions-report .bg-bg { background: #f5f5f5 !important; }
        .pt-sessions-report table { font-size: 11px; }
        .pt-sessions-report .text-text-primary { color: #000 !important; }
        .pt-sessions-report .text-text-muted { color: #555 !important; }
        @page { margin: 0.4in; size: landscape; }
      }
    `}</style>
  )
}
