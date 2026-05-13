import React, { useEffect, useState } from 'react'
import { getRevenueSummary } from '../../../lib/api'
import MobileLoading from '../MobileLoading'

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
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setLoading(true)
    setError(null)
    getRevenueSummary({ start_date: startDate, end_date: endDate, location_slug: locationSlug })
      .then(res => { if (!cancelled) setData(res) })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load revenue summary') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, locationSlug])

  if (loading) return <MobileLoading variant="report" />

  if (error) return (
    <div className="p-4">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-red-600">{error}</p>
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

      {/* Profit Center Breakdown */}
      {data.by_profit_center && data.by_profit_center.length > 0 && (
        <BreakdownList
          title="Profit Center Breakdown"
          items={data.by_profit_center}
          idKey="name"
          labelKey="name"
          total={data.total}
          compare={data.compare?.by_profit_center}
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
