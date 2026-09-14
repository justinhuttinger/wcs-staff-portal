import { useState } from 'react'
import { api, getRevenueSummary } from '../../lib/api'
import { exportCSV } from '../../lib/export'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { CategoryTable } from '../analytics/revenueCategoryTable'
import { MultiTrend } from '../analytics/charts'
import { fmtMoney as fmtMoneyShared, GOOD_COLOR, BAD_COLOR } from '../analytics/chartPalette'

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
// ---------------------------------------------------------------------------
// Revenue Analysis, as Analytics draws it.
//
// The profit-centre table this report used to end with listed ABC's raw centre
// codes: DUES next to A2EXECDUES next to GYMSTRDUES, three names for the same
// money, and sixty-odd rows in no order a manager reads by. Analytics already
// folds those into priority categories — Dues first — against the same span a
// month and a year ago, and opens any row into its last six months.
//
// So this draws that, from the same builder: GET /revenue/analysis is
// lib/revenueAnalysisReport, the same code behind GET /analytics/revenue, with
// this report's gate and this report's club scoping in front of it. Two
// audiences, one definition of what a month of Dues was.
//
// IT LOADS SEPARATELY from the summary above it. The summary is one query and
// arrives fast; the analysis is five, across three windows and twenty-five
// months. Making the whole report wait on the slower half would have made the
// fast half feel broken.
// ---------------------------------------------------------------------------
function RevenueAnalysis({ startDate, endDate, locationSlug }) {
  // One open row across BOTH tables. A category appears in Priority and again
  // in All, and opening it in one while it sat open in the other showed the
  // same six months twice.
  const [openKey, setOpenKey] = useState(null)

  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const p = new URLSearchParams()
      if (startDate) p.set('start_date', startDate)
      if (endDate) p.set('end_date', endDate)
      if (locationSlug) p.set('location_slug', locationSlug)
      return api(`/revenue/analysis?${p.toString()}`, { cache: true, signal })
    },
    [startDate, endDate, locationSlug]
  )

  if (loading) return <DesktopLoading variant="report" />
  // A failure here must not take the summary above it down with it, so it says
  // so and stops rather than throwing.
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-6 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the profit-centre analysis</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }
  if (!data) return null

  const s = data.summary || {}
  const headline = data.headline || []
  const all = data.all || []
  const sparklines = data.sparklines || {}

  return (
    <div className="space-y-3">
      {/* Above the numbers: a window shorter than the one asked for is not
          something to discover afterwards. */}
      {data.notes?.dataEdge && (
        <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
          <p className="text-[11px] text-amber-600">{data.notes.dataEdge}</p>
        </div>
      )}

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <div className="flex min-w-max divide-x divide-border">
          {[
            { label: 'Gross Revenue', value: fmtMoneyShared(s.gross) },
            {
              label: 'vs Last Month',
              value: s.grossMom === null || s.grossMom === undefined
                ? '—' : `${s.grossMom > 0 ? '+' : ''}${s.grossMom}%`,
              tone: s.grossMom,
            },
            {
              label: 'vs Last Year',
              value: s.grossYoy === null || s.grossYoy === undefined
                ? '—' : `${s.grossYoy > 0 ? '+' : ''}${s.grossYoy}%`,
              tone: s.grossYoy,
            },
            { label: 'Refunds', value: fmtMoneyShared(s.refunds), muted: true },
            { label: 'Net', value: fmtMoneyShared(s.net), muted: true },
            { label: 'Profit Centers', value: s.categories ?? '—', muted: true },
          ].map(t => (
            <div key={t.label} className="px-5 py-4 text-center min-w-[130px] flex-1">
              <p
                className={`text-xl font-bold tabular-nums ${t.muted ? 'text-text-muted' : 'text-text-primary'}`}
                style={t.tone !== undefined && t.tone !== null && t.tone !== 0
                  ? { color: t.tone > 0 ? GOOD_COLOR : BAD_COLOR } : undefined}
              >
                {t.value}
              </p>
              <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* The windows being compared, stated plainly. A percentage against an
          unnamed period is a number nobody can check. */}
      <div className="bg-surface rounded-xl border border-border p-3">
        <p className="text-[11px] text-text-muted">
          {data.meta?.spanDays} days ending {data.meta?.end}, against{' '}
          {data.meta?.lastMonthStart} to {data.meta?.lastMonthEnd} and{' '}
          {data.meta?.lastYearStart} to {data.meta?.lastYearEnd} — the same number of days each
          time, so a short month cannot read as a decline. {data.notes?.totals}
        </p>
      </div>

      <MultiTrend
        title="Revenue by Priority Profit Center"
        months={data.trendMonths || []}
        series={data.trendSeries || []}
        format="int"
        subtitle={`${(data.trendSeries || []).length} centers`}
      />

      <CategoryTable
        title="Priority Profit Centers"
        subtitle="click a row for its last six months"
        rows={headline}
        sparklines={sparklines}
        meta={data.meta}
        openKey={openKey}
        setOpenKey={setOpenKey}
      />

      <CategoryTable
        title="All Profit Centers"
        subtitle={`every center, A to Z — ${all.length} in total`}
        rows={all}
        sparklines={sparklines}
        meta={data.meta}
        openKey={openKey}
        setOpenKey={setOpenKey}
      />

      <p className="text-[11px] text-text-muted px-1">{data.notes?.mapping}</p>
    </div>
  )
}

export default function RevenueReport({ startDate, endDate, locationSlug }) {
  const { data, loading, error } = useCancellableFetch(
    (signal) => getRevenueSummary(
      { start_date: startDate, end_date: endDate, location_slug: locationSlug },
      { cache: true, signal }
    ),
    [startDate, endDate, locationSlug]
  )

  function handleExportCsv() {
    if (!data) return
    const rows = [
      ['Profit Center', 'Total', 'Pct of Total'],
      ...data.by_profit_center.map(p => [p.name, p.total.toFixed(2), (p.pct_of_total * 100).toFixed(2) + '%']),
    ]
    exportCSV(rows, `revenue-${data.period?.start || startDate}_to_${data.period?.end || endDate}`)
  }

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <div className="text-red-600">Error: {error.message || String(error)}</div>
  if (!data) return null

  // Use the server's effective period — it caps end at yesterday since today's
  // revenue isn't in yet — so the label and chart match the totals.
  const periodStart = data.period?.start || startDate
  const periodEnd = data.period?.end || endDate
  const points = buildPoints(data.by_day, periodStart, periodEnd)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="Total Revenue"
          value={fmtMoney(data.total)}
          sub={<>{periodStart} → {periodEnd}</>}
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

      {/* Dues & Fees against Discretionary. Two very different kinds of money
          sit in the one total above — dues are contracted and predictable,
          discretionary is sold again every month — and a total that moved tells
          you nothing about which one did. Above the profit-centre table because
          it is the shape of the month; the table is where you go once you know
          which half to look at. */}
      {data.by_revenue_class?.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Dues vs Discretionary</p>
          <div className="space-y-2">
            {data.by_revenue_class.map(c => (
              <div key={c.name} className="flex items-center gap-3 text-sm">
                <span className="text-text-primary w-40 flex-shrink-0 truncate" title={c.name}>{c.name}</span>
                <span className="flex-1 h-2.5 rounded-full bg-bg overflow-hidden min-w-[3rem]">
                  <span
                    className="block h-full rounded-full bg-wcs-red/70"
                    style={{ width: `${Math.max(2, (c.pct_of_total || 0) * 100)}%` }}
                  />
                </span>
                <span className="font-semibold text-text-primary tabular-nums w-28 text-right">
                  ${Math.round(c.total).toLocaleString()}
                </span>
                <span className="text-xs text-text-muted tabular-nums w-12 text-right">
                  {Math.round((c.pct_of_total || 0) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The profit centres, folded into their priority categories and drawn
          the way Analytics draws them. Replaces a flat list of ABC's raw centre
          codes — DUES beside A2EXECDUES beside GYMSTRDUES, three names for the
          same money — in sixty-odd rows with no order a manager reads by.

          Its own component because it loads separately: the summary above is
          one query, this is five across three windows and twenty-five months,
          and making the fast half wait on the slow one made the fast half feel
          broken. */}
      <div className="flex items-center justify-end">
        <button onClick={handleExportCsv} className="text-xs px-2 py-1 rounded border border-border hover:bg-bg">
          Export CSV
        </button>
      </div>

      <RevenueAnalysis startDate={startDate} endDate={endDate} locationSlug={locationSlug} />

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
