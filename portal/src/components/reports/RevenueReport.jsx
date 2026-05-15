import React, { useEffect, useState } from 'react'
import { getRevenueSummary, getRevenueProfitCenterMtdTrend } from '../../lib/api'
import { exportCSV } from '../../lib/export'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'

const STACK_COLORS = ['#e53e3e', '#3182ce', '#38a169', '#805ad5', '#d69e2e', '#319795', '#a0aec0']

function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0)
}

function fmtPct(n) {
  return `${(n * 100).toFixed(1)}%`
}

function buildPoints(byDay, startDate, endDate) {
  const start = new Date(startDate + 'T00:00:00Z')
  const end = new Date(endDate + 'T00:00:00Z')
  const dateMap = {}
  byDay.forEach(d => { dateMap[d.date] = d.total })
  const points = []
  const cur = new Date(start)
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10)
    points.push({ date: iso, total: dateMap[iso] || 0 })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return points
}

function TrendChart({ points, label }) {
  if (!points || points.length === 0) return null
  const w = 720
  const h = 180
  const padL = 50
  const padR = 12
  const padT = 12
  const padB = 28
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const max = Math.max(1, ...points.map(p => p.total))
  const toX = i => padL + (points.length > 1 ? (i / (points.length - 1)) * chartW : chartW / 2)
  const toY = v => padT + chartH - (v / max) * chartH

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.total).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${toX(points.length - 1).toFixed(1)},${(padT + chartH).toFixed(1)} L${toX(0).toFixed(1)},${(padT + chartH).toFixed(1)} Z`

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{label}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '220px' }}>
        <path d={areaPath} fill={STACK_COLORS[0]} opacity="0.15" />
        <path d={linePath} fill="none" stroke={STACK_COLORS[0]} strokeWidth="1.5" />
        {points.map((p, i) => (
          <title key={i}>{`${p.date}: ${fmtMoney(p.total)}`}</title>
        ))}
        <text x={padL - 4} y={padT + 8} textAnchor="end" className="fill-gray-400" style={{ fontSize: '9px' }}>{fmtMoney(max)}</text>
        <text x={padL - 4} y={padT + chartH + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: '9px' }}>$0</text>
        <text x={padL} y={h - 6} className="fill-gray-400" style={{ fontSize: '9px' }}>{points[0]?.date}</text>
        <text x={padL + chartW} y={h - 6} textAnchor="end" className="fill-gray-400" style={{ fontSize: '9px' }}>{points[points.length - 1]?.date}</text>
      </svg>
    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-text-primary mt-1">{value}</p>
      {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

function DeltaChip({ current, prior }) {
  if (!prior || prior === 0) return <span className="text-xs text-text-muted">no prior</span>
  const delta = current - prior
  const pct = delta / prior
  const positive = delta >= 0
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${positive ? 'text-green-600' : 'text-red-600'}`}>
      {positive ? '▲' : '▼'} {fmtPct(Math.abs(pct))} ({fmtMoney(Math.abs(delta))})
    </span>
  )
}

// Small inline chart used inside the profit-center expansion row. Months
// (oldest-left, newest-right) along the x-axis, MTD totals on the y. Highlights
// the most recent month and the previous month with circles + labels so the
// reader can see "vs last MTD" at a glance.
function MtdTrendChart({ series }) {
  if (!series || series.length === 0) {
    return <p className="text-xs text-text-muted">No transactions in the trailing 12 months.</p>
  }
  const w = 560
  const h = 140
  const padL = 50
  const padR = 16
  const padT = 12
  const padB = 28
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const max = Math.max(1, ...series.map(s => s.mtd_total))
  const toX = i => padL + (series.length > 1 ? (i / (series.length - 1)) * chartW : chartW / 2)
  const toY = v => padT + chartH - (v / max) * chartH
  const linePath = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(s.mtd_total).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${toX(series.length - 1).toFixed(1)},${(padT + chartH).toFixed(1)} L${toX(0).toFixed(1)},${(padT + chartH).toFixed(1)} Z`
  const last = series[series.length - 1]
  const prev = series[series.length - 2]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '170px' }}>
      <path d={areaPath} fill={STACK_COLORS[0]} opacity="0.15" />
      <path d={linePath} fill="none" stroke={STACK_COLORS[0]} strokeWidth="1.5" />
      {prev && (
        <circle cx={toX(series.length - 2)} cy={toY(prev.mtd_total)} r="3.5" fill="#fff" stroke={STACK_COLORS[0]} strokeWidth="1.5" />
      )}
      <circle cx={toX(series.length - 1)} cy={toY(last.mtd_total)} r="4.5" fill={STACK_COLORS[0]} />
      {series.map((s, i) => (
        <title key={i}>{`${s.month}: ${fmtMoney(s.mtd_total)} (through ${s.period_end})`}</title>
      ))}
      <text x={padL - 4} y={padT + 8} textAnchor="end" className="fill-gray-400" style={{ fontSize: '9px' }}>{fmtMoney(max)}</text>
      <text x={padL - 4} y={padT + chartH + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: '9px' }}>$0</text>
      <text x={padL} y={h - 6} className="fill-gray-400" style={{ fontSize: '9px' }}>{series[0].month}</text>
      <text x={padL + chartW} y={h - 6} textAnchor="end" className="fill-gray-400" style={{ fontSize: '9px' }}>{last.month}</text>
    </svg>
  )
}

function ProfitCenterExpansion({ name, series, loading }) {
  if (loading) {
    return (
      <div className="px-4 py-6 text-xs text-text-muted">Loading {name} trend…</div>
    )
  }
  if (!series) return null

  const last = series[series.length - 1]
  const prev = series[series.length - 2]
  const recent3 = series.slice(-4, -1) // 3 months before the current one
  const avg3 = recent3.length ? recent3.reduce((s, m) => s + m.mtd_total, 0) / recent3.length : 0

  return (
    <div className="bg-bg/60 px-4 py-4 border-t border-border">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-4">
        <div className="space-y-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-text-muted">This MTD</p>
            <p className="text-lg font-bold text-text-primary">{fmtMoney(last?.mtd_total || 0)}</p>
            <p className="text-[10px] text-text-muted">{last?.period_start} → {last?.period_end}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-text-muted">vs Last Month MTD</p>
            <p className="text-sm font-semibold text-text-primary">
              <DeltaChip current={last?.mtd_total || 0} prior={prev?.mtd_total || 0} />
            </p>
            <p className="text-[10px] text-text-muted">last month was {fmtMoney(prev?.mtd_total || 0)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-text-muted">vs 3-Mo Avg MTD</p>
            <p className="text-sm font-semibold text-text-primary">
              <DeltaChip current={last?.mtd_total || 0} prior={avg3} />
            </p>
            <p className="text-[10px] text-text-muted">avg was {fmtMoney(avg3)}</p>
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1">12-Month MTD Trend</p>
          <MtdTrendChart series={series} />
        </div>
      </div>
    </div>
  )
}

function ComparisonCard({ label, current, comparison }) {
  if (!comparison) return <StatCard label={label} value="—" sub="no data" />
  const delta = current - (comparison.total || 0)
  const positive = delta >= 0
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${positive ? 'text-green-600' : 'text-red-600'}`}>
        {positive ? '+' : '−'}{fmtMoney(Math.abs(delta))}
      </p>
      <p className="text-xs text-text-muted mt-1">
        {comparison.period?.start} → {comparison.period?.end}
      </p>
      <p className="text-xs text-text-muted">
        was {fmtMoney(comparison.total)} · <DeltaChip current={current} prior={comparison.total} />
      </p>
    </div>
  )
}

export default function RevenueReport({ startDate, endDate, locationSlug }) {
  const [activeProfitCenter, setActiveProfitCenter] = useState(null)
  const [pcSeries, setPcSeries] = useState(null)
  const [pcLoading, setPcLoading] = useState(false)

  const { data, loading, error } = useCancellableFetch(
    (signal) => getRevenueSummary(
      { start_date: startDate, end_date: endDate, location_slug: locationSlug },
      { cache: true, signal }
    ),
    [startDate, endDate, locationSlug]
  )

  // Reset profit-center drill-down whenever the top-level params change —
  // the 12-month MTD chart anchors on end_date, so changing dates invalidates
  // the currently-open expansion.
  useEffect(() => {
    setActiveProfitCenter(null)
    setPcSeries(null)
    setPcLoading(false)
  }, [startDate, endDate, locationSlug])

  function selectProfitCenter(pc) {
    if (activeProfitCenter === pc) {
      setActiveProfitCenter(null)
      setPcSeries(null)
      setPcLoading(false)
      return
    }
    setActiveProfitCenter(pc)
    setPcSeries(null)
    setPcLoading(true)
    getRevenueProfitCenterMtdTrend(
      { end_date: endDate, location_slug: locationSlug, profit_center: pc },
      { cache: true }
    )
      .then(d => { setPcSeries(d.series); setPcLoading(false) })
      .catch(() => { setPcSeries([]); setPcLoading(false) })
  }

  function handleExportCsv() {
    if (!data) return
    const rows = [
      ['Profit Center', 'Total', 'Pct of Total'],
      ...data.by_profit_center.map(p => [p.name, p.total.toFixed(2), (p.pct_of_total * 100).toFixed(2) + '%']),
    ]
    exportCSV(rows, `revenue-${startDate}_to_${endDate}`)
  }

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <div className="text-red-600">Error: {error.message || String(error)}</div>
  if (!data) return null

  const points = buildPoints(data.by_day, startDate, endDate)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="Total Revenue"
          value={fmtMoney(data.total)}
          sub={<>{startDate} → {endDate}</>}
        />
        <ComparisonCard
          label="vs Last Month"
          current={data.total}
          comparison={data.compare_last_month}
        />
        <ComparisonCard
          label="vs Last Year"
          current={data.total}
          comparison={data.compare_last_year}
        />
      </div>

      <TrendChart points={points} label="Daily Revenue Trend" />

      {data.by_club.length > 1 && (
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">By Club</p>
          <div className="space-y-2">
            {data.by_club.map(c => {
              const pct = data.total > 0 ? c.total / data.total : 0
              return (
                <div key={c.slug} className="flex items-center gap-3">
                  <div className="w-24 text-xs font-medium">{c.label}</div>
                  <div className="flex-1 bg-bg rounded h-5 overflow-hidden">
                    <div className="h-full bg-wcs-red" style={{ width: `${(pct * 100).toFixed(1)}%` }} />
                  </div>
                  <div className="w-24 text-right text-xs font-semibold">{fmtMoney(c.total)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="bg-surface rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Profit Center Breakdown</p>
            <p className="text-[10px] text-text-muted mt-0.5">Click a row to see its 12-month MTD trend.</p>
          </div>
          <button onClick={handleExportCsv} className="text-xs px-2 py-1 rounded border border-border hover:bg-bg">
            Export CSV
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="text-left py-2 w-6"></th>
              <th className="text-left py-2">Profit Center</th>
              <th className="text-right">Total</th>
              <th className="text-right">% of Total</th>
              <th className="text-right">Δ vs Prior</th>
            </tr>
          </thead>
          <tbody>
            {data.by_profit_center.map(p => {
              const priorPc = data.compare?.by_profit_center?.find(x => x.name === p.name)
              const isActive = p.name === activeProfitCenter
              return (
                <React.Fragment key={p.name}>
                  <tr
                    onClick={() => selectProfitCenter(p.name)}
                    className={`cursor-pointer border-t border-border ${isActive ? 'bg-wcs-red/5' : 'hover:bg-bg'}`}
                  >
                    <td className="py-2 text-text-muted">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        className={`w-3 h-3 transition-transform ${isActive ? 'rotate-90' : ''}`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </td>
                    <td className="py-2">{p.name}</td>
                    <td className="text-right font-semibold">{fmtMoney(p.total)}</td>
                    <td className="text-right text-text-muted">{fmtPct(p.pct_of_total)}</td>
                    <td className="text-right"><DeltaChip current={p.total} prior={priorPc?.total} /></td>
                  </tr>
                  {isActive && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <ProfitCenterExpansion name={p.name} series={pcSeries} loading={pcLoading} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {data.by_membership_type && data.by_membership_type.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Revenue by Membership Type</p>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-text-muted">
              <tr><th className="text-left py-2">Type</th><th className="text-right">Total</th><th className="text-right">% of Total</th><th className="text-right">Δ vs Prior</th></tr>
            </thead>
            <tbody>
              {data.by_membership_type.map(m => {
                const priorMt = data.compare?.by_membership_type?.find(x => x.code === m.code)
                return (
                  <tr key={m.code} className="border-t border-border">
                    <td className="py-2 font-mono">{m.code}</td>
                    <td className="text-right font-semibold">{fmtMoney(m.total)}</td>
                    <td className="text-right text-text-muted">{fmtPct(m.pct_of_total)}</td>
                    <td className="text-right"><DeltaChip current={m.total} prior={priorMt?.total} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
