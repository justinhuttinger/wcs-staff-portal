import { Fragment, useEffect, useMemo, useState } from 'react'
import { getPTSessionsReport, getPTSessionsTrainer } from '../../lib/api'

const ALL_STATUSES = ['Completed', 'Canceled-Charge']

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

export default function PTSessionsReport({ startDate, endDate, locationSlug }) {
  const [statuses, setStatuses] = useState(ALL_STATUSES)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState('total')
  const [sortDir, setSortDir] = useState('desc')
  const [expanded, setExpanded] = useState(null)
  const [drill, setDrill] = useState({})

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
  }, [startDate, endDate, locationSlug, statuses.join(',')])

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

  async function toggleExpanded(employeeId) {
    if (expanded === employeeId) {
      setExpanded(null)
      return
    }
    setExpanded(employeeId)
    if (drill[employeeId]) return
    setDrill((c) => ({ ...c, [employeeId]: { loading: true, sessions: null } }))
    try {
      const d = await getPTSessionsTrainer(employeeId, {
        start_date: startDate,
        end_date: endDate,
        location_slug: locationSlug,
        status: statuses.join(','),
      })
      setDrill((c) => ({ ...c, [employeeId]: { loading: false, sessions: d.sessions } }))
    } catch (e) {
      setDrill((c) => ({ ...c, [employeeId]: { loading: false, sessions: [], error: e?.message } }))
    }
  }

  function exportCsv() {
    if (!data) return
    const cols = [
      'Trainer',
      ...data.event_types.flatMap((e) => [`${e} (Completed)`, `${e} (Canceled-Charge)`]),
      'Total',
      'Completed',
      'Canceled-Charge',
      '% Attended',
    ]
    const lines = [cols.join(',')]
    for (const t of sortedTrainers) {
      const row = [JSON.stringify(t.employee_name)]
      for (const ev of data.event_types) {
        row.push(t.by_event_type[ev]?.completed || 0)
        row.push(t.by_event_type[ev]?.canceled_charge || 0)
      }
      row.push(
        t.total,
        t.completed,
        t.canceled_charge,
        t.total ? Math.round((t.completed / t.total) * 100) + '%' : ''
      )
      lines.push(row.join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pt-sessions-${startDate}-to-${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <CenterCard>Loading…</CenterCard>
  if (error) return <CenterCard><span className="text-red-500">Error: {error}</span></CenterCard>
  if (!data || data.trainers.length === 0) return <CenterCard>No sessions in this date range.</CenterCard>

  const eventTypes = data.event_types

  return (
    <div className="space-y-6">
      {/* Status filter + export */}
      <div className="flex flex-wrap items-center gap-4">
        {ALL_STATUSES.map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={statuses.includes(s)}
              onChange={() => toggleStatus(s)}
            />
            {s}
          </label>
        ))}
        <button
          onClick={exportCsv}
          className="ml-auto px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary hover:bg-bg"
        >
          Export CSV
        </button>
      </div>

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
              <th />
            </tr>
          </thead>
          <tbody>
            {sortedTrainers.map((t) => {
              const att = t.total ? Math.round((t.completed / t.total) * 100) : 0
              const isOpen = expanded === t.employee_id
              const dr = drill[t.employee_id]
              return (
                <Fragment key={t.employee_id}>
                  <tr className="border-b border-border/50 hover:bg-bg">
                    <td className="py-2 pr-2 text-text-primary font-medium">{t.employee_name}</td>
                    {eventTypes.map((ev) => {
                      const c = t.by_event_type[ev]?.completed || 0
                      const cc = t.by_event_type[ev]?.canceled_charge || 0
                      const dim = c + cc === 0 ? 'text-text-muted' : 'text-text-primary'
                      return (
                        <td key={ev} className={`py-2 px-2 text-right tabular-nums ${dim}`}>
                          {c}/{cc}
                        </td>
                      )
                    })}
                    <td className="py-2 px-2 text-right font-semibold tabular-nums text-text-primary">
                      {t.total}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-text-muted">
                      {t.total ? att + '%' : '—'}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <button
                        onClick={() => toggleExpanded(t.employee_id)}
                        className="px-2 py-0.5 rounded text-xs text-text-muted hover:text-text-primary"
                      >
                        {isOpen ? '▼' : '▶'}
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
                                <th className="text-left py-1 pr-2">Event Type</th>
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
                                    <td className="py-1 pr-2">{s.event_name || '—'}</td>
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
