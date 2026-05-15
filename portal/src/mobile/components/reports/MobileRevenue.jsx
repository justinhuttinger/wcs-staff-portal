import React, { useEffect, useState } from 'react'
import { getRevenueSummary, getRevenueProfitCenterMtdTrend } from '../../../lib/api'
import MobileLoading from '../MobileLoading'
import { useCancellableFetch } from '../../../hooks/useCancellableFetch'

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function fmtMoney(n) {
  return fmt.format(n || 0)
}

function fmtPct(n) {
  return `${(n * 100).toFixed(1)}%`
}

// ── Stat card (horizontal-scroll row) ────────────────────────────────────────

function StatCard({ label, value, sub, valueClass }) {
  return (
    <div className="min-w-[150px] bg-surface rounded-2xl border border-border p-4 flex-shrink-0">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueClass || 'text-text-primary'}`}>{value}</p>
      {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

// ── Delta chip ────────────────────────────────────────────────────────────────

function DeltaChip({ current, prior }) {
  if (!prior || prior === 0) return <span className="text-xs text-text-muted">no prior</span>
  const delta = current - prior
  const pct = delta / prior
  const positive = delta >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
      positive
        ? 'bg-green-50 text-green-700 border border-green-200'
        : 'bg-red-50 text-red-700 border border-red-200'
    }`}>
      {positive ? '▲' : '▼'} {fmtPct(Math.abs(pct))}
    </span>
  )
}

// ── By-Club mini bar list ─────────────────────────────────────────────────────

function ClubBars({ byClub, total }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">By Club</p>
      <div className="space-y-2">
        {byClub.map(c => {
          const pct = total > 0 ? c.total / total : 0
          return (
            <div key={c.slug} className="space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-text-primary">{c.label}</span>
                <span className="font-semibold text-text-primary">{fmtMoney(c.total)}</span>
              </div>
              <div className="h-2 bg-bg rounded overflow-hidden">
                <div
                  className="h-full bg-wcs-red rounded"
                  style={{ width: `${(pct * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Mini 12-month MTD trend chart (mobile-sized) ─────────────────────────────

function MiniMtdChart({ series }) {
  if (!series || series.length === 0) return null
  const w = 320
  const h = 90
  const padL = 6
  const padR = 6
  const padT = 6
  const padB = 14
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const max = Math.max(1, ...series.map(s => s.mtd_total))
  const toX = i => padL + (series.length > 1 ? (i / (series.length - 1)) * chartW : chartW / 2)
  const toY = v => padT + chartH - (v / max) * chartH
  const linePath = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(s.mtd_total).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${toX(series.length - 1).toFixed(1)},${(padT + chartH).toFixed(1)} L${toX(0).toFixed(1)},${(padT + chartH).toFixed(1)} Z`
  const last = series[series.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '110px' }}>
      <path d={areaPath} fill="#e53e3e" opacity="0.15" />
      <path d={linePath} fill="none" stroke="#e53e3e" strokeWidth="1.5" />
      <circle cx={toX(series.length - 1)} cy={toY(last.mtd_total)} r="3.5" fill="#e53e3e" />
      <text x={padL} y={h - 2} className="fill-gray-400" style={{ fontSize: '9px' }}>{series[0].month}</text>
      <text x={padL + chartW} y={h - 2} textAnchor="end" className="fill-gray-400" style={{ fontSize: '9px' }}>{last.month}</text>
    </svg>
  )
}

// ── Profit Center breakdown (tap a card to expand its 12-month MTD trend) ─────

function ProfitCenterList({ items, total, compare, endDate, locationSlug }) {
  const [activeName, setActiveName] = useState(null)
  const [series, setSeries] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setActiveName(null)
    setSeries(null)
    setLoading(false)
  }, [endDate, locationSlug])

  function toggle(name) {
    if (activeName === name) {
      setActiveName(null)
      setSeries(null)
      setLoading(false)
      return
    }
    setActiveName(name)
    setSeries(null)
    setLoading(true)
    getRevenueProfitCenterMtdTrend(
      { end_date: endDate, location_slug: locationSlug, profit_center: name },
      { cache: true }
    )
      .then(d => { setSeries(d.series); setLoading(false) })
      .catch(() => { setSeries([]); setLoading(false) })
  }

  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Profit Center Breakdown</p>
      <p className="text-[10px] text-text-muted mb-3">Tap a row to see its 12-month MTD trend.</p>
      <div className="space-y-2">
        {items.map(item => {
          const prior = compare?.find(x => x.name === item.name)
          const isActive = activeName === item.name
          const last = series && series[series.length - 1]
          const prev = series && series[series.length - 2]
          const recent3 = series ? series.slice(-4, -1) : []
          const avg3 = recent3.length ? recent3.reduce((s, m) => s + m.mtd_total, 0) / recent3.length : 0
          return (
            <div key={item.name} className="rounded-xl overflow-hidden border border-border">
              <button
                type="button"
                onClick={() => toggle(item.name)}
                className={`w-full text-left bg-bg p-3 space-y-1.5 ${isActive ? 'bg-wcs-red/5' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-text-primary leading-tight flex items-center gap-1.5">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      className={`w-3 h-3 text-text-muted transition-transform ${isActive ? 'rotate-90' : ''}`}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                    {item.name}
                  </span>
                  <span className="text-sm font-bold text-text-primary whitespace-nowrap">{fmtMoney(item.total)}</span>
                </div>
                <div className="flex items-center justify-between pl-5">
                  <span className="text-xs text-text-muted">{fmtPct(item.pct_of_total)} of total</span>
                  <DeltaChip current={item.total} prior={prior?.total} />
                </div>
              </button>

              {isActive && (
                <div className="p-3 border-t border-border bg-surface">
                  {loading ? (
                    <p className="text-xs text-text-muted">Loading 12-month MTD…</p>
                  ) : !series || series.length === 0 ? (
                    <p className="text-xs text-text-muted">No transactions in the trailing 12 months.</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-text-muted">This MTD</p>
                          <p className="text-sm font-bold text-text-primary">{fmtMoney(last?.mtd_total || 0)}</p>
                          <p className="text-[10px] text-text-muted">{last?.period_start} → {last?.period_end}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-text-muted">vs Last MTD</p>
                          <p className="text-sm font-semibold">
                            <DeltaChip current={last?.mtd_total || 0} prior={prev?.mtd_total || 0} />
                          </p>
                          <p className="text-[10px] text-text-muted">was {fmtMoney(prev?.mtd_total || 0)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-text-muted">vs 3-Mo Avg</p>
                          <p className="text-sm font-semibold">
                            <DeltaChip current={last?.mtd_total || 0} prior={avg3} />
                          </p>
                          <p className="text-[10px] text-text-muted">avg {fmtMoney(avg3)}</p>
                        </div>
                      </div>
                      <MiniMtdChart series={series} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Generic breakdown card list ───────────────────────────────────────────────

function BreakdownList({ title, items, idKey, labelKey, total, compare }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{title}</p>
      <div className="space-y-2">
        {items.map(item => {
          const prior = compare?.find(x => x[idKey] === item[idKey])
          return (
            <div key={item[idKey]} className="bg-bg rounded-xl p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-text-primary leading-tight">{item[labelKey]}</span>
                <span className="text-sm font-bold text-text-primary whitespace-nowrap">{fmtMoney(item.total)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{fmtPct(item.pct_of_total)} of total</span>
                <DeltaChip current={item.total} prior={prior?.total} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MobileRevenue({ startDate, endDate, locationSlug }) {
  const { data, loading, error } = useCancellableFetch(
    (signal) => getRevenueSummary(
      { start_date: startDate, end_date: endDate, location_slug: locationSlug },
      { cache: true, signal }
    ),
    [startDate, endDate, locationSlug]
  )

  if (loading) return <MobileLoading variant="report" />

  if (error) return (
    <div className="p-4">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-red-600">{error.message || String(error)}</p>
      </div>
    </div>
  )

  if (!data) return null

  const lmDelta = data.compare_last_month ? data.total - (data.compare_last_month.total || 0) : null
  const lyDelta = data.compare_last_year ? data.total - (data.compare_last_year.total || 0) : null

  const lmPct = data.compare_last_month?.total
    ? lmDelta / data.compare_last_month.total
    : null
  const lyPct = data.compare_last_year?.total
    ? lyDelta / data.compare_last_year.total
    : null

  function deltaLabel(delta, pct) {
    if (delta === null) return '—'
    const sign = delta >= 0 ? '+' : '−'
    const pctStr = pct !== null ? ` (${(pct * 100).toFixed(1)}%)` : ''
    return `${sign}${fmtMoney(Math.abs(delta))}${pctStr}`
  }

  function deltaClass(delta) {
    if (delta === null) return 'text-text-muted'
    return delta >= 0 ? 'text-green-600' : 'text-red-600'
  }

  return (
    <div className="p-4 space-y-3">

      {/* Horizontal-scroll stat cards */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 min-w-max">
          <StatCard
            label="Total Revenue"
            value={fmtMoney(data.total)}
            sub={`${startDate} → ${endDate}`}
          />
          <StatCard
            label="vs Last Month"
            value={deltaLabel(lmDelta, lmPct)}
            valueClass={deltaClass(lmDelta)}
            sub={data.compare_last_month
              ? `was ${fmtMoney(data.compare_last_month.total)}`
              : 'no data'}
          />
          <StatCard
            label="vs Last Year"
            value={deltaLabel(lyDelta, lyPct)}
            valueClass={deltaClass(lyDelta)}
            sub={data.compare_last_year
              ? `was ${fmtMoney(data.compare_last_year.total)}`
              : 'no data'}
          />
        </div>
      </div>

      {/* By Club bars (only when multiple clubs) */}
      {data.by_club && data.by_club.length > 1 && (
        <ClubBars byClub={data.by_club} total={data.total} />
      )}

      {/* Profit Center Breakdown — tap to expand 12-month MTD trend */}
      {data.by_profit_center && data.by_profit_center.length > 0 && (
        <ProfitCenterList
          items={data.by_profit_center}
          total={data.total}
          compare={data.compare?.by_profit_center}
          endDate={endDate}
          locationSlug={locationSlug}
        />
      )}

      {/* Revenue by Membership Type */}
      {data.by_membership_type && data.by_membership_type.length > 0 && (
        <BreakdownList
          title="Revenue by Membership Type"
          items={data.by_membership_type}
          idKey="code"
          labelKey="code"
          total={data.total}
          compare={data.compare?.by_membership_type}
        />
      )}

    </div>
  )
}
