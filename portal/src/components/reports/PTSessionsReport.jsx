import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { getPTSessionsReport, getPTSessionsTrainer } from '../../lib/api'

const ALL_STATUSES = ['Completed', 'Canceled-Charge']

const EVENT_GROUPS = [
  { key: 'all',     label: 'All Sessions' },
  { key: 'pt',      label: 'PT' },
  { key: 'swim',    label: 'Swim' },
  { key: 'stretch', label: 'Stretch' },
]

function KpiCard({ label, value, sub }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-6 text-center">
      <p className="text-xs text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-4xl font-bold text-text-primary mt-2">{value}</p>
      {sub && <p className="text-[11px] text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

function CenterCard({ children }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-6 text-center text-sm text-text-muted">
      {children}
    </div>
  )
}

function Th({ children, onClick, active, dir, align = 'left' }) {
  return (
    <th
      onClick={onClick}
      className={`py-2 cursor-pointer select-none text-xs uppercase tracking-wide ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } ${active ? 'text-text-primary' : 'text-text-muted'}`}
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
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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

  // Re-fetch on filter changes
  useEffect(() => {
    if (!startDate || !endDate || !locationSlug) return
    let alive = true
    setLoading(true)
    setError('')
    setData(null)
    setDrill({})
    setExpanded(null)
    getPTSessionsReport({
      start_date: startDate,
      end_date: endDate,
      location_slug: locationSlug,
      status: statuses.join(','),
      event_group: eventGroup,
    })
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((e) => {
        if (alive) setError(e?.message || 'Failed to load')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [startDate, endDate, locationSlug, statuses.join(','), eventGroup])

  const sortedTrainers = useMemo(() => {
    if (!data) return []
    const rows = [...data.trainers]
    rows.sort((a, b) => {
      let va, vb
      if (sortKey === 'name') {
        va = a.employee_name
        vb = b.employee_name
      } else if (sortKey === 'attendance') {
        va = a.total ? a.completed / a.total : 0
        vb = b.total ? b.completed / b.total : 0
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
    const cols = ['Trainer', ...data.event_types, 'Total', 'Completed', 'Canceled-Charge', '% Attended']
    const lines = [cols.map(csvCell).join(',')]
    for (const t of sortedTrainers) {
      const row = [t.employee_name]
      for (const ev of data.event_types) {
        const c = t.by_event_type[ev]?.completed || 0
        const cc = t.by_event_type[ev]?.canceled_charge || 0
        row.push(c + cc)
      }
      row.push(
        t.total,
        t.completed,
        t.canceled_charge,
        t.total ? Math.round((t.completed / t.total) * 100) + '%' : ''
      )
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

  if (loading) return <CenterCard>Loading…</CenterCard>
  if (error) return <CenterCard><span className="text-red-500">Error: {error}</span></CenterCard>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Sessions" value={data.summary.total_sessions.toLocaleString()} />
        <KpiCard label="Completed" value={data.summary.completed.toLocaleString()} />
        <KpiCard label="Canceled-Charge" value={data.summary.canceled_charge.toLocaleString()} />
        <KpiCard
          label="Attendance"
          value={data.summary.total_sessions ? Math.round(data.summary.attendance_rate * 100) + '%' : '—'}
        />
      </div>

      {/* Pivot table */}
      <div className="bg-surface rounded-xl border border-border p-6 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <Th onClick={() => toggleSort('name')} active={sortKey === 'name'} dir={sortDir}>
                Trainer
              </Th>
              {eventTypes.map((ev) => (
                <Th
                  key={ev}
                  onClick={() => toggleSort('et:' + ev)}
                  active={sortKey === 'et:' + ev}
                  dir={sortDir}
                  align="right"
                >
                  {ev}
                </Th>
              ))}
              <Th onClick={() => toggleSort('total')} active={sortKey === 'total'} dir={sortDir} align="right">
                Total
              </Th>
              <Th
                onClick={() => toggleSort('attendance')}
                active={sortKey === 'attendance'}
                dir={sortDir}
                align="right"
              >
                % Att
              </Th>
              <th className="no-print" />
            </tr>
          </thead>
          <tbody>
            {sortedTrainers.map((t) => {
              const att = t.total ? Math.round((t.completed / t.total) * 100) : 0
              const isOpen = printDetail || expanded === t.employee_id
              const dr = drill[t.employee_id]
              return (
                <Fragment key={t.employee_id}>
                  <tr className="border-b border-border/50 hover:bg-bg">
                    <td className="py-2 pr-2 text-text-primary font-medium">{t.employee_name}</td>
                    {eventTypes.map((ev) => {
                      const c = t.by_event_type[ev]?.completed || 0
                      const cc = t.by_event_type[ev]?.canceled_charge || 0
                      const total = c + cc
                      const dim = total === 0 ? 'text-text-muted' : 'text-text-primary'
                      return (
                        <td key={ev} className={`py-2 px-2 text-right tabular-nums ${dim}`}>
                          {total}
                        </td>
                      )
                    })}
                    <td className="py-2 px-2 text-right font-semibold tabular-nums text-text-primary">
                      {t.total}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-text-muted">
                      {t.total ? att + '%' : '—'}
                    </td>
                    <td className="py-2 pl-2 text-right no-print">
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
                      <td colSpan={eventTypes.length + 4} className="px-3 py-3">
                        {dr?.loading && <div className="text-text-muted">Loading sessions…</div>}
                        {dr?.error && <div className="text-red-500">Error: {dr.error}</div>}
                        {dr?.sessions && dr.sessions.length === 0 && (
                          <div className="text-text-muted">No sessions.</div>
                        )}
                        {dr?.sessions && dr.sessions.length > 0 && (
                          <table className="min-w-full text-xs">
                            <thead>
                              <tr className="text-text-muted text-[10px] uppercase tracking-wide border-b border-border">
                                <th className="text-left py-1 pr-2">Date</th>
                                <th className="text-left py-1 pr-2">Time</th>
                                <th className="text-left py-1 pr-2">Member</th>
                                <th className="text-left py-1 pr-2">Event</th>
                                <th className="text-left py-1 pr-2">Status</th>
                                <th className="text-left py-1 pr-2">Attended</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dr.sessions.map((s) => {
                                const dt = (s.event_timestamp_local || '').replace('T', ' ').slice(0, 16)
                                const [date, time] = dt.split(' ')
                                return (
                                  <tr key={s.event_id} className="border-b border-border/30">
                                    <td className="py-1 pr-2 tabular-nums">{date || '—'}</td>
                                    <td className="py-1 pr-2 tabular-nums">{time || '—'}</td>
                                    <td className="py-1 pr-2">{s.member_name || '—'}</td>
                                    <td className="py-1 pr-2">
                                      {s.event_name || '—'}
                                      {s.event_type && s.event_type !== s.event_name && (
                                        <span className="ml-1 text-text-muted">({s.event_type})</span>
                                      )}
                                    </td>
                                    <td className="py-1 pr-2">{s.status || '—'}</td>
                                    <td className="py-1 pr-2">{s.attended_status || '—'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
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
