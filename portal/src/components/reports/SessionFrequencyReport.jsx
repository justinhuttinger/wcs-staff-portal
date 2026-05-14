import { useMemo, useState } from 'react'
import { getSessionFrequency } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'

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

// Always compare month-to-date (1st of this month through today) against the
// same MTD window in the prior month. Date pickers in ReportingView are
// hidden for this report so users can't accidentally pick something else.
function mtdRange() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const d = now.getDate()
  return {
    start: `${y}-${pad(m)}-01`,
    end: `${y}-${pad(m)}-${pad(d)}`,
  }
}

export default function SessionFrequencyReport({ locationSlug }) {
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [search, setSearch] = useState('')

  const { start: startDate, end: endDate } = useMemo(mtdRange, [locationSlug])

  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      if (!startDate || !endDate) return Promise.resolve(null)
      return getSessionFrequency(
        { start_date: startDate, end_date: endDate, location_slug: locationSlug || 'all' },
        { cache: true, signal }
      )
    },
    [startDate, endDate, locationSlug]
  )

  const trainers = useMemo(() => {
    if (!data?.rows) return []
    return [...new Set(data.rows.map(r => r.serviceEmployee).filter(Boolean))].sort()
  }, [data])

  // Always include members with sessions in EITHER window so drop-offs stay
  // visible (e.g. trained last month, none this month).
  const filtered = useMemo(() => {
    if (!data?.rows) return []
    const q = search.trim().toLowerCase()
    return data.rows.filter(r => {
      if (trainerFilter !== 'all' && r.serviceEmployee !== trainerFilter) return false
      if (q) {
        const hay = `${r.memberName} ${r.serviceEmployee || ''} ${r.clubName}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data, trainerFilter, search])

  const filteredSummary = useMemo(() => {
    const currentTotal = filtered.reduce((s, r) => s + r.currentSessions, 0)
    const priorTotal = filtered.reduce((s, r) => s + r.priorSessions, 0)
    const currentWeeks = data?.period?.current_weeks || 0
    const priorWeeks = data?.period?.prior_weeks || 0
    return {
      activeMembers: filtered.filter(r => r.currentSessions > 0).length,
      currentTotal,
      priorTotal,
      currentPerWeekAvg: currentWeeks > 0 ? currentTotal / currentWeeks : 0,
      priorPerWeekAvg: priorWeeks > 0 ? priorTotal / priorWeeks : 0,
    }
  }, [filtered, data])

  function handleExportCSV() {
    if (!filtered.length) return
    const header = [
      'Club', 'Member', 'Service Employee',
      'Current Sessions', 'Current / wk',
      'Prior Sessions', 'Prior / wk',
    ]
    const rows = filtered.map(r => [
      r.clubName,
      r.memberName,
      r.serviceEmployee || '',
      r.currentSessions,
      r.currentPerWeek.toFixed(2),
      r.priorSessions,
      r.priorPerWeek.toFixed(2),
    ])
    exportCSV([header, ...rows], `session-frequency-${data?.period?.current_start || 'range'}`)
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-text-muted italic">Loading session data from ABC Financial — this may take a minute for all locations…</p>
        <DesktopLoading variant="report" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error.message || String(error)}</div>
    )
  }
  if (!data) return null

  const period = data.period || {}

  return (
    <div className="space-y-5">
      {/* Period header bubble — fixed to month-to-date */}
      <div className="bg-surface border border-border rounded-xl px-4 py-2.5 inline-flex items-center gap-2 text-sm flex-wrap">
        <span className="font-bold text-text-primary">Month-to-date:</span>
        <span className="text-text-muted">{fmtDateRange(period.current_start, period.current_end)}</span>
        <span className="text-text-muted">({fmtPerWeek(period.current_weeks)} wk)</span>
        <span className="text-text-muted">·</span>
        <span className="font-bold text-text-primary">vs prior month:</span>
        <span className="text-text-muted">{fmtDateRange(period.prior_start, period.prior_end)}</span>
        <span className="text-text-muted">({fmtPerWeek(period.prior_weeks)} wk)</span>
        <span className="ml-1 text-[10px] text-text-muted uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-bg border border-border">MTD</span>
      </div>

      {/* Explainer */}
      <div className="bg-surface border border-border rounded-xl px-4 py-2.5 text-xs text-text-primary">
        Showing members with at least one completed session in EITHER the current
        or prior window. Members with <span className="font-semibold">0 in the Current column</span> trained
        only in the prior period — that's your drop-off list.
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Active Members (Current)" value={fmtNum(filteredSummary.activeMembers)} tone="green" />
        <SummaryCard
          label="Current Sessions"
          value={fmtNum(filteredSummary.currentTotal)}
          sub={`${fmtPerWeek(filteredSummary.currentPerWeekAvg)} sessions per week average`}
          tone="green"
        />
        <SummaryCard
          label="Prior Sessions"
          value={fmtNum(filteredSummary.priorTotal)}
          sub={`${fmtPerWeek(filteredSummary.priorPerWeekAvg)} sessions per week average`}
          tone="blue"
        />
        <SummaryCard
          label="Current vs Prior sessions per week"
          value={<TrendInline current={filteredSummary.currentPerWeekAvg} previous={filteredSummary.priorPerWeekAvg} />}
          tone="default"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
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

      {/* Table — Current and Prior are grouped column-pairs with color tinting
          so the eye picks them apart at a glance. */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              {/* Top header row — three identity columns span both rows, then
                  two grouped period headers, then Trend spans both rows. */}
              <tr className="text-xs uppercase tracking-wide text-text-muted bg-bg">
                <th rowSpan={2} className="text-left px-4 py-2 font-semibold align-bottom border-b border-border">Member</th>
                <th rowSpan={2} className="text-left px-4 py-2 font-semibold align-bottom border-b border-border">Service Employee</th>
                <th rowSpan={2} className="text-left px-4 py-2 font-semibold align-bottom border-b border-border">Club</th>
                <th
                  colSpan={2}
                  className="text-center px-4 py-2 font-bold text-green-800 bg-green-100 border-l-2 border-green-300 border-b border-border"
                >
                  Current Period
                </th>
                <th
                  colSpan={2}
                  className="text-center px-4 py-2 font-bold text-blue-800 bg-blue-100 border-l-2 border-blue-300 border-r-2 border-blue-300 border-b border-border"
                >
                  Prior Period
                </th>
                <th rowSpan={2} className="text-left px-4 py-2 font-semibold align-bottom border-b border-border">Trend</th>
              </tr>
              {/* Sub-headers — Sessions / Sessions Per Week under each period. */}
              <tr className="text-[10px] uppercase tracking-wide text-text-muted bg-bg">
                <th className="text-right px-4 py-1.5 font-semibold bg-green-50 border-l-2 border-green-300 border-b border-border">Sessions</th>
                <th
                  className="text-right px-4 py-1.5 font-semibold bg-green-50 border-b border-border"
                  title="sessions ÷ (days in current period ÷ 7)"
                >
                  Sessions Per Week
                </th>
                <th className="text-right px-4 py-1.5 font-semibold bg-blue-50 border-l-2 border-blue-300 border-b border-border">Sessions</th>
                <th
                  className="text-right px-4 py-1.5 font-semibold bg-blue-50 border-r-2 border-blue-300 border-b border-border"
                  title="sessions ÷ (days in prior period ÷ 7)"
                >
                  Sessions Per Week
                </th>
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
                filtered.map((r, i) => {
                  const droppedOff = (r.currentSessions || 0) === 0 && (r.priorSessions || 0) > 0
                  return (
                    <tr
                      key={`${r.clubNumber}-${r.memberId}-${i}`}
                      className={`border-t border-border hover:bg-bg/60 ${droppedOff ? 'opacity-70' : ''}`}
                    >
                      <td className="px-4 py-2 font-medium text-text-primary">{r.memberName}</td>
                      <td className="px-4 py-2 text-text-muted">{r.serviceEmployee || '—'}</td>
                      <td className="px-4 py-2 text-text-muted">{r.clubName}</td>
                      <td className="px-4 py-2 text-right font-bold text-green-900 bg-green-50/40 border-l-2 border-green-200">{r.currentSessions}</td>
                      <td className="px-4 py-2 text-right text-green-900/70 bg-green-50/40">{fmtPerWeek(r.currentPerWeek)}</td>
                      <td className="px-4 py-2 text-right font-bold text-blue-900 bg-blue-50/40 border-l-2 border-blue-200">{r.priorSessions}</td>
                      <td className="px-4 py-2 text-right text-blue-900/70 bg-blue-50/40 border-r-2 border-blue-200">{fmtPerWeek(r.priorPerWeek)}</td>
                      <td className="px-4 py-2"><TrendChip current={r.currentPerWeek} previous={r.priorPerWeek} /></td>
                    </tr>
                  )
                })
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="border-t-2 border-border">
                <tr className="font-semibold">
                  <td className="px-4 py-2 text-text-primary bg-bg" colSpan={3}>
                    Totals — {filtered.length} {filtered.length === 1 ? 'member' : 'members'}
                  </td>
                  <td className="px-4 py-2 text-right text-green-900 bg-green-100 border-l-2 border-green-300">{fmtNum(filteredSummary.currentTotal)}</td>
                  <td className="px-4 py-2 text-right text-green-900 bg-green-100">{fmtPerWeek(filteredSummary.currentPerWeekAvg)}</td>
                  <td className="px-4 py-2 text-right text-blue-900 bg-blue-100 border-l-2 border-blue-300">{fmtNum(filteredSummary.priorTotal)}</td>
                  <td className="px-4 py-2 text-right text-blue-900 bg-blue-100 border-r-2 border-blue-300">{fmtPerWeek(filteredSummary.priorPerWeekAvg)}</td>
                  <td className="px-4 py-2 bg-bg">
                    <TrendChip current={filteredSummary.currentPerWeekAvg} previous={filteredSummary.priorPerWeekAvg} />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl px-4 py-2.5 text-xs text-text-primary">
        Counts include only <span className="font-semibold">Completed</span> calendar events tagged as PT-style training
        (Swim, Stretch, and admin entries are excluded). The comparison window is the prior calendar month when the
        current range is exactly one calendar month; otherwise it's a same-length window ending the day before the
        current range starts. <span className="font-semibold">Per-week math:</span> sessions ÷ (days in that period ÷ 7).
        Example: 12 sessions across the {period.current_days || '—'} days of the current period = 12 ÷ (
        {period.current_days || '—'} ÷ 7) ≈ {period.current_days ? fmtPerWeek(12 / (period.current_days / 7)) : '—'}/wk.
      </div>
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
