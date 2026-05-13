import { useEffect, useMemo, useRef, useState } from 'react'
import { getSessionFrequency } from '../../../lib/api'
import MobileLoading from '../MobileLoading'

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// Always compare current MTD (1st of this month → today) against the same
// day-of-month window in the prior month. This mirrors the desktop report's
// mtdRange() helper exactly.
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

// ─── sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, tone }) {
  const toneCls =
    tone === 'green'
      ? 'border-green-200 bg-green-50'
      : tone === 'blue'
        ? 'border-blue-200 bg-blue-50'
        : 'border-border bg-surface'
  return (
    <div className={`min-w-[155px] flex-shrink-0 rounded-2xl border p-4 ${toneCls}`}>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide leading-tight">{label}</p>
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
  const cls =
    trend === 'flat'
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

function TrainerCard({ row }) {
  const droppedOff = (row.currentSessions || 0) === 0 && (row.priorSessions || 0) > 0
  return (
    <div className={`bg-surface rounded-2xl border border-border p-4 ${droppedOff ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-semibold text-text-primary leading-tight">{row.memberName}</p>
          <p className="text-xs text-text-muted mt-0.5">{row.serviceEmployee || 'No trainer'} · {row.clubName}</p>
        </div>
        <TrendChip current={row.currentPerWeek} previous={row.priorPerWeek} />
      </div>
      <div className="flex gap-2 flex-wrap mt-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-800 border border-green-200">
          Now: {row.currentSessions} <span className="font-normal text-green-600">({fmtPerWeek(row.currentPerWeek)}/wk)</span>
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200">
          Prior: {row.priorSessions} <span className="font-normal text-blue-600">({fmtPerWeek(row.priorPerWeek)}/wk)</span>
        </span>
      </div>
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

// NOTE: This report manages its OWN date range (always MTD vs prior-month MTD).
// startDate/endDate from the shell are intentionally ignored.
export default function MobileSessionFrequency({ locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [search, setSearch] = useState('')

  // Stable MTD window — recalculated only when locationSlug changes (effectively
  // once per mount since the location drives the fetch).
  const { start: startDate, end: endDate } = useMemo(mtdRange, [locationSlug])

  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setData(null)
    setLoading(true)
    setError(null)

    getSessionFrequency({
      start_date: startDate,
      end_date: endDate,
      location_slug: locationSlug || 'all',
    })
      .then(res => {
        if (id !== reqRef.current) return
        setData(res)
        setLoading(false)
      })
      .catch(err => {
        if (id !== reqRef.current) return
        setError(err.message || 'Failed to load session data')
        setLoading(false)
      })
  }, [startDate, endDate, locationSlug])

  // Unique trainer names from the full result set
  const trainers = useMemo(() => {
    if (!data?.rows) return []
    return [...new Set(data.rows.map(r => r.serviceEmployee).filter(Boolean))].sort()
  }, [data])

  // Filter rows by trainer pill + search text
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

  // Aggregate summary stats across filtered rows
  const summary = useMemo(() => {
    const currentWeeks = data?.period?.current_weeks || 0
    const priorWeeks = data?.period?.prior_weeks || 0
    const currentTotal = filtered.reduce((s, r) => s + (r.currentSessions || 0), 0)
    const priorTotal = filtered.reduce((s, r) => s + (r.priorSessions || 0), 0)
    return {
      activeMembers: filtered.filter(r => (r.currentSessions || 0) > 0).length,
      currentTotal,
      priorTotal,
      currentPerWeekAvg: currentWeeks > 0 ? currentTotal / currentWeeks : 0,
      priorPerWeekAvg: priorWeeks > 0 ? priorTotal / priorWeeks : 0,
    }
  }, [filtered, data])

  // ── render states ──────────────────────────────────────────────────────────

  if (loading) return <MobileLoading variant="report" />

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const period = data.period || {}

  // ── main render ────────────────────────────────────────────────────────────

  return (
    <div className="p-4 space-y-3">

      {/* MTD comparison chip */}
      <div className="bg-surface border border-border rounded-2xl px-4 py-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-bold text-text-primary">MTD:</span>
        <span className="text-text-muted">{fmtDateRange(period.current_start, period.current_end)}</span>
        <span className="text-text-muted">({fmtPerWeek(period.current_weeks)} wk)</span>
        <span className="text-text-muted mx-0.5">·</span>
        <span className="font-bold text-text-primary">vs prior:</span>
        <span className="text-text-muted">{fmtDateRange(period.prior_start, period.prior_end)}</span>
        <span className="text-text-muted">({fmtPerWeek(period.prior_weeks)} wk)</span>
        <span className="ml-1 text-[10px] text-text-muted uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-bg border border-border">MTD</span>
      </div>

      {/* Stat cards — horizontal scroll */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 min-w-max">
          <StatCard
            label="Active Members"
            value={fmtNum(summary.activeMembers)}
            sub="with sessions this MTD"
            tone="green"
          />
          <StatCard
            label="Current Sessions"
            value={fmtNum(summary.currentTotal)}
            sub={`${fmtPerWeek(summary.currentPerWeekAvg)}/wk avg`}
            tone="green"
          />
          <StatCard
            label="Prior Sessions"
            value={fmtNum(summary.priorTotal)}
            sub={`${fmtPerWeek(summary.priorPerWeekAvg)}/wk avg`}
            tone="blue"
          />
          <StatCard
            label="Sessions/wk delta"
            value={
              <span className="flex items-baseline gap-1.5">
                <span>{fmtPerWeek(summary.currentPerWeekAvg)}</span>
                <TrendChip current={summary.currentPerWeekAvg} previous={summary.priorPerWeekAvg} />
              </span>
            }
            tone="default"
          />
        </div>
      </div>

      {/* Trainer filter pills */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          <button
            onClick={() => setTrainerFilter('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              trainerFilter === 'all'
                ? 'bg-wcs-red text-white'
                : 'bg-surface border border-border text-text-secondary'
            }`}
          >
            All trainers
          </button>
          {trainers.map(t => (
            <button
              key={t}
              onClick={() => setTrainerFilter(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                trainerFilter === t
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search member, trainer, club..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-text-muted"
      />

      {/* Member / session cards */}
      {filtered.length === 0 ? (
        <div className="bg-surface border border-border rounded-2xl p-8 text-center">
          <p className="text-sm text-text-muted">No sessions found for these filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r, i) => (
            <TrainerCard key={`${r.clubNumber}-${r.memberId}-${i}`} row={r} />
          ))}
        </div>
      )}

      {/* Footer totals */}
      {filtered.length > 0 && (
        <div className="bg-surface rounded-2xl border-2 border-wcs-red p-4">
          <p className="text-sm font-bold text-text-primary mb-2">
            Totals — {filtered.length} {filtered.length === 1 ? 'member' : 'members'}
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-800 border border-green-200">
              Current: {fmtNum(summary.currentTotal)} ({fmtPerWeek(summary.currentPerWeekAvg)}/wk)
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200">
              Prior: {fmtNum(summary.priorTotal)} ({fmtPerWeek(summary.priorPerWeekAvg)}/wk)
            </span>
            <TrendChip current={summary.currentPerWeekAvg} previous={summary.priorPerWeekAvg} />
          </div>
        </div>
      )}

      {/* Drop-off note */}
      <div className="bg-surface border border-border rounded-2xl px-4 py-2.5 text-xs text-text-primary">
        Members with <span className="font-semibold">0 current sessions</span> trained only in the prior period — that is your drop-off list. Counts include only <span className="font-semibold">Completed</span> PT-style events (Swim, Stretch, and admin entries excluded).
      </div>

    </div>
  )
}
