import { useState } from 'react'
import { getRevenueAnalysis } from '../../lib/api'
import { exportCSV } from '../../lib/export'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { CategoryTable } from '../analytics/revenueCategoryTable'
import { MultiTrend } from '../analytics/charts'
import { fmtMoney, GOOD_COLOR, BAD_COLOR } from '../analytics/chartPalette'

// ---------------------------------------------------------------------------
// Revenue — the profit centres, and nothing else.
//
// This used to open with a daily trend line, a bar per club, three summary
// cards and a revenue-by-membership-type table before you reached the profit
// centres. All of that is gone: the question this report gets opened for is
// "which centre moved, and is that a trend", and everything above the tables
// was answering a different one.
//
// ONE QUERY NOW. The removed blocks were the only readers of
// /reports/revenue/summary, so the report is a single fetch of
// /reports/revenue/analysis rather than two loading at different speeds. The
// summary endpoint is untouched — mobile Revenue still uses it.
//
// The order is deliberate and is the order the question gets asked in: the
// headline, then what it is being compared against, then the shape over time,
// then the priority centres, then everything.
// ---------------------------------------------------------------------------

export default function RevenueReport({ startDate, endDate, locationSlug }) {
  // One open row across BOTH tables. A category appears in Priority and again
  // in All, and opening it in one while it sat open in the other showed the
  // same six months twice.
  const [openKey, setOpenKey] = useState(null)

  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug) params.location_slug = locationSlug
      return getRevenueAnalysis(params, { cache: true, signal })
    },
    [startDate, endDate, locationSlug]
  )

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>
  if (!data) return null

  const s = data.summary || {}
  const headline = data.headline || []
  const all = data.all || []
  const sparklines = data.sparklines || {}

  // The centres as shown, with the comparisons beside them — what is on screen,
  // rather than the flat profit-centre list the old summary export carried.
  function handleExportCsv() {
    const rows = [
      ['Profit Center', 'This Period', 'Last Month', 'MoM %', 'Last Year', 'YoY %'],
      ...all.map(r => [
        r.category,
        (r.revenue ?? 0).toFixed(2),
        (r.lastMonthRevenue ?? 0).toFixed(2),
        r.momChange == null ? '' : r.momChange,
        (r.lastYearRevenue ?? 0).toFixed(2),
        r.yoyChange == null ? '' : r.yoyChange,
      ]),
    ]
    exportCSV(rows, `revenue-${data.meta?.start || startDate}_to_${data.meta?.end || endDate}`)
  }

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
            { label: 'Gross Revenue', value: fmtMoney(s.gross) },
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
            { label: 'Refunds', value: fmtMoney(s.refunds), muted: true },
            { label: 'Net', value: fmtMoney(s.net), muted: true },
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
      <div className="bg-surface rounded-xl border border-border p-3 flex items-start justify-between gap-3">
        <p className="text-[11px] text-text-muted">
          {data.meta?.spanDays} days ending {data.meta?.end}, against{' '}
          {data.meta?.lastMonthStart} to {data.meta?.lastMonthEnd} and{' '}
          {data.meta?.lastYearStart} to {data.meta?.lastYearEnd} — the same number of days each
          time, so a short month cannot read as a decline. {data.notes?.totals}
        </p>
        <button
          onClick={handleExportCsv}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-bg flex-shrink-0"
        >
          Export CSV
        </button>
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
