import { useEffect, useMemo, useRef, useState } from 'react'
import { getSessionFrequency } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'

function fmtNum(n) {
  return Number(n || 0).toLocaleString()
}

function fmtPerWeek(n) {
  const v = Number(n || 0)
  if (!v) return '0.00'
  return v.toFixed(2)
}

function fmtDateRange(start, end) {
  if (!start || !end) return ''
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`
  return `${fmt(s)} – ${fmt(e)}`
}

export default function SessionFrequencyReport({ locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [onlyActive, setOnlyActive] = useState(false)

  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setData(null)
    setLoading(true)
    setError(null)
    getSessionFrequency({ location_slug: locationSlug || 'all' })
      .then(res => {
        if (id !== reqRef.current) return
        setData(res)
        setLoading(false)
      })
      .catch(err => {
        if (id !== reqRef.current) return
        setError(err.message)
        setLoading(false)
      })
  }, [locationSlug])

  const trainers = useMemo(() => {
    if (!data?.rows) return []
    return [...new Set(data.rows.map(r => r.serviceEmployee).filter(Boolean))].sort()
  }, [data])

  const filtered = useMemo(() => {
    if (!data?.rows) return []
    const q = search.trim().toLowerCase()
    return data.rows.filter(r => {
      if (trainerFilter !== 'all' && r.serviceEmployee !== trainerFilter) return false
      if (onlyActive && r.currentSessions === 0) return false
      if (q) {
        const hay = `${r.memberName} ${r.serviceEmployee || ''} ${r.clubName}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data, trainerFilter, search, onlyActive])

  const filteredSummary = useMemo(() => {
    const currentTotal = filtered.reduce((s, r) => s + r.currentSessions, 0)
    const lastTotal = filtered.reduce((s, r) => s + r.lastMonthSessions, 0)
    const currentWeeks = data?.period?.current_weeks || 0
    const lastWeeks = data?.period?.last_month_weeks || 0
    return {
      activeMembers: filtered.filter(r => r.currentSessions > 0).length,
      currentTotal,
      lastTotal,
      currentPerWeekAvg: currentWeeks > 0 ? currentTotal / currentWeeks : 0,
      lastPerWeekAvg: lastWeeks > 0 ? lastTotal / lastWeeks : 0,
    }
  }, [filtered, data])

  function handleExportCSV() {
    if (!filtered.length) return
    const header = [
      'Club', 'Member', 'Service Employee',
      'MTD Sessions', 'MTD / wk',
      'Last Month Sessions', 'Last Month / wk',
    ]
    const rows = filtered.map(r => [
      r.clubName,
      r.memberName,
      r.serviceEmployee || '',
      r.currentSessions,
      r.currentPerWeek.toFixed(2),
      r.lastMonthSessions,
      r.lastMonthPerWeek.toFixed(2),
    ])
    exportCSV([header, ...rows], `session-frequency-${data?.period?.current_start || 'mtd'}`)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-6 h-6 border-2 border-wcs-red/30 border-t-wcs-red rounded-full animate-spin" />
        <p className="loading-card">Loading session data from ABC Financial...</p>
        <p className="text-text-muted text-xs">This may take a minute for all locations</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>
    )
  }
  if (!data) return null

  const period = data.period || {}

  return (
    <div className="space-y-5">
      {/* Period header bubble */}
      <div className="bg-surface border border-border rounded-xl px-4 py-2.5 inline-flex items-center gap-2 text-sm">
        <span className="font-bold text-text-primary">MTD:</span>
        <span className="text-text-muted">{fmtDateRange(period.current_start, period.current_end)}</span>
        <span className="text-text-muted">·</span>
        <span className="font-bold text-text-primary">Last Month:</span>
        <span className="text-text-muted">{fmtDateRange(period.last_month_start, period.last_month_end)}</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Active Members (MTD)" value={fmtNum(filteredSummary.activeMembers)} tone="green" />
        <SummaryCard
          label="Sessions MTD"
          value={fmtNum(filteredSummary.currentTotal)}
          sub={`${fmtPerWeek(filteredSummary.currentPerWeekAvg)} / wk avg`}
          tone="green"
        />
        <SummaryCard
          label="Sessions Last Month"
          value={fmtNum(filteredSummary.lastTotal)}
          sub={`${fmtPerWeek(filteredSummary.lastPerWeekAvg)} / wk avg`}
          tone="blue"
        />
        <SummaryCard
          label="MTD vs Last Month / wk"
          value={<TrendInline current={filteredSummary.currentPerWeekAvg} previous={filteredSummary.lastPerWeekAvg} />}
          tone="default"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setOnlyActive(v => !v)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            onlyActive
              ? 'bg-wcs-red text-white border-wcs-red'
              : 'bg-surface text-text-muted border-border hover:text-text-primary'
          }`}
        >
          MTD-active only
        </button>

        <select
          value={trainerFilter}
          onChange={e => setTrainerFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red"
        >
          <option value="all">All service employees</option>
          {trainers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search member, trainer, club..."
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red min-w-[240px]"
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            disabled={!filtered.length}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-muted text-xs hover:text-text-primary disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            onClick={() => exportPDF('Session Frequency')}
            disabled={!filtered.length}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-muted text-xs hover:text-text-primary disabled:opacity-50"
          >
            Print / PDF
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-xs uppercase tracking-wide text-text-muted">
                <th className="text-left px-4 py-2 font-semibold">Member</th>
                <th className="text-left px-4 py-2 font-semibold">Service Employee</th>
                <th className="text-left px-4 py-2 font-semibold">Club</th>
                <th className="text-right px-4 py-2 font-semibold">MTD</th>
                <th className="text-right px-4 py-2 font-semibold">MTD / wk</th>
                <th className="text-right px-4 py-2 font-semibold">Last Month</th>
                <th className="text-right px-4 py-2 font-semibold">LM / wk</th>
                <th className="text-left px-4 py-2 font-semibold">Trend</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-text-muted text-sm">
                    No sessions found for these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={`${r.clubNumber}-${r.memberId}-${i}`} className="border-t border-border hover:bg-bg/60">
                    <td className="px-4 py-2 font-medium text-text-primary">{r.memberName}</td>
                    <td className="px-4 py-2 text-text-muted">{r.serviceEmployee || '—'}</td>
                    <td className="px-4 py-2 text-text-muted">{r.clubName}</td>
                    <td className="px-4 py-2 text-right font-semibold text-text-primary">{r.currentSessions}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{fmtPerWeek(r.currentPerWeek)}</td>
                    <td className="px-4 py-2 text-right text-text-primary">{r.lastMonthSessions}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{fmtPerWeek(r.lastMonthPerWeek)}</td>
                    <td className="px-4 py-2"><TrendChip current={r.currentPerWeek} previous={r.lastMonthPerWeek} /></td>
                  </tr>
                ))
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="border-t-2 border-border">
                <tr className="bg-bg font-semibold">
                  <td className="px-4 py-2 text-text-primary" colSpan={3}>
                    Totals — {filtered.length} {filtered.length === 1 ? 'member' : 'members'}
                  </td>
                  <td className="px-4 py-2 text-right text-text-primary">{fmtNum(filteredSummary.currentTotal)}</td>
                  <td className="px-4 py-2 text-right text-text-primary">{fmtPerWeek(filteredSummary.currentPerWeekAvg)}</td>
                  <td className="px-4 py-2 text-right text-text-primary">{fmtNum(filteredSummary.lastTotal)}</td>
                  <td className="px-4 py-2 text-right text-text-primary">{fmtPerWeek(filteredSummary.lastPerWeekAvg)}</td>
                  <td className="px-4 py-2">
                    <TrendChip current={filteredSummary.currentPerWeekAvg} previous={filteredSummary.lastPerWeekAvg} />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-xs text-text-muted">
        Counts include only <span className="font-semibold">Completed</span> calendar events tagged as PT-style training
        (Swim, Stretch, and admin entries are excluded). Per-week averages divide the period totals by the number of
        weeks elapsed: {fmtPerWeek(period.current_weeks)} wk for MTD, {fmtPerWeek(period.last_month_weeks)} wk for last month.
      </p>
    </div>
  )
}

function SummaryCard({ label, value, sub, tone }) {
  const toneCls = tone === 'green'
    ? 'border-green-200 bg-green-50'
    : tone === 'blue'
      ? 'border-blue-200 bg-blue-50'
      : 'border-border bg-surface'
  return (
    <div className={`rounded-xl border p-4 ${toneCls}`}>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</p>
      <div className="text-2xl font-bold text-text-primary mt-1">{value}</div>
      {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

function TrendChip({ current, previous }) {
  const cur = Number(current || 0)
  const prev = Number(previous || 0)
  if (prev === 0 && cur === 0) return <span className="text-[11px] text-text-muted">—</span>
  if (prev === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">
        <span>▲</span><span>new</span>
      </span>
    )
  }
  const delta = ((cur - prev) / prev) * 100
  const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const cls = trend === 'flat'
    ? 'bg-bg text-text-muted border-border'
    : trend === 'up'
      ? 'bg-green-50 text-green-700 border-green-200'
      : 'bg-red-50 text-red-700 border-red-200'
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–'
  const sign = delta > 0 ? '+' : ''
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      <span>{arrow}</span><span>{sign}{delta.toFixed(0)}%</span>
    </span>
  )
}

function TrendInline({ current, previous }) {
  const cur = Number(current || 0)
  const prev = Number(previous || 0)
  return (
    <div className="flex items-baseline gap-2">
      <span>{fmtPerWeek(cur)}</span>
      <span className="text-base text-text-muted font-normal">vs</span>
      <span className="text-base text-text-muted font-normal">{fmtPerWeek(prev)}</span>
      <TrendChip current={cur} previous={prev} />
    </div>
  )
}
