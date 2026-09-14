import { Fragment } from 'react'
import { fmtMoney, fmtMonth, GOOD_COLOR, BAD_COLOR, colorFor } from './chartPalette'
import { zebraColumn } from './charts'

// ---------------------------------------------------------------------------
// The profit-center category table, and the panel a row opens into.
//
// Lifted out of Revenue.jsx so Reporting's Revenue report draws the same table
// from the same code. The two reports have different audiences and different
// club scoping — see lib/revenueAnalysisReport for the server half of the same
// argument — but a category row must look and behave identically in both, or
// "click a row for its last six months" becomes a thing that is true in one
// place and not the other.
//
// Nothing here fetches. Both callers hand it rows and sparklines already built,
// and own the open-row state themselves so only one row is open at a time
// across both tables on a page.
// ---------------------------------------------------------------------------

const COLUMNS = [
  { label: 'Profit Center', align: 'left' },
  { label: 'This Period', align: 'right' },
  { label: 'Last Month', align: 'right' },
  { label: 'MoM', align: 'right' },
  { label: 'Last Year', align: 'right' },
  { label: 'YoY', align: 'right' },
]

/** A change, coloured, with its sign always printed. */
function Change({ pct, delta }) {
  if (pct === null || pct === undefined) {
    // No base to compare against. The absolute movement is still real, so it is
    // shown rather than leaving the cell empty.
    return (
      <span className="tabular-nums text-text-muted">
        {delta === null || delta === undefined || delta === 0 ? '—' : fmtMoney(delta)}
      </span>
    )
  }
  const colour = pct === 0 ? undefined : pct > 0 ? GOOD_COLOR : BAD_COLOR
  return (
    <span className="tabular-nums" style={colour ? { color: colour } : undefined}>
      {pct > 0 ? '+' : ''}{pct}%
    </span>
  )
}

/**
 * Six months of one category.
 *
 * FIXED SIZE AND PROPORTIONS. An earlier version told the SVG to fill the
 * container width while disabling aspect-ratio preservation, which does not
 * scale a drawing — it STRETCHES it, so the line and every label were distorted
 * horizontally by however wide the table happened to be. A chart with a
 * deliberate aspect ratio is drawn once at that ratio and centred in the space
 * it is given.
 *
 * Zero-based, because these are revenue amounts and a floating baseline turns a
 * 3% wobble into a cliff. Values sit on the points: the shape answers "which
 * way", the numbers answer "by how much".
 */
function Sparkline({ points, width = 460, height = 150 }) {
  const real = points.filter(p => Number.isFinite(p.value))
  if (real.length < 2) {
    return <p className="text-[11px] text-text-muted">Not enough history to draw a trend.</p>
  }

  const padL = 10
  const padT = 18
  const padB = 20
  const plotW = width - padL * 2
  const plotH = height - padT - padB
  const max = Math.max(...real.map(p => p.value)) * 1.2 || 1
  const n = points.length

  const x = i => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = v => padT + plotH - (Math.max(0, v) / max) * plotH
  const colour = colorFor('revenue', 0)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="block"
      role="img"
      aria-label="Revenue over the last six months"
    >
      <line x1={padL} x2={width - padL} y1={padT + plotH} y2={padT + plotH}
        stroke="currentColor" className="text-border" strokeWidth="1" />
      <polyline
        points={points.map((p, i) => `${x(i)},${y(p.value || 0)}`).join(' ')}
        fill="none" stroke={colour} strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round"
      />
      {points.map((p, i) => (
        <g key={p.month}>
          <circle cx={x(i)} cy={y(p.value || 0)} r="3" fill={colour}>
            <title>{`${fmtMonth(p.month)}: ${fmtMoney(p.value || 0)}`}</title>
          </circle>
          <text x={x(i)} y={y(p.value || 0) - 7} textAnchor="middle"
            className="fill-text-muted" style={{ fontSize: 9 }}>
            {fmtMoney(p.value || 0)}
          </text>
          <text x={x(i)} y={height - 5} textAnchor="middle"
            className="fill-text-muted" style={{ fontSize: 9 }}>
            {fmtMonth(p.month)}
          </text>
        </g>
      ))}
    </svg>
  )
}

/**
 * This period against the same span a month and a year ago, as bars.
 *
 * ONE HUE FOR ALL THREE. The same measure at three points in time is a
 * magnitude comparison, not three categories, and colouring them differently
 * would imply a distinction that is not there. The current period is solid; the
 * comparisons are dimmed so the eye knows which bar is being asked about
 * without a legend.
 *
 * THE PERCENTAGE SITS UNDER EACH COMPARISON, not the current bar — "this period
 * is +46% against last year" is a fact about the comparison, and printing it
 * under the current bar would leave the reader working out which way it points.
 * Green up, red down, and withheld entirely where the base is zero or the sign
 * flips, matching the table above.
 *
 * Bars are drawn from the ABSOLUTE value so a refund center does not draw off
 * the bottom of its own panel.
 */
function ComparisonBars({ row, meta, height = 150, width = 240 }) {
  const bars = [
    { key: 'now', label: 'This period', value: row.revenue, strong: true },
    { key: 'mom', label: 'Last month', value: row.lastMonthRevenue, pct: row.momChange },
    { key: 'yoy', label: 'Last year', value: row.lastYearRevenue, pct: row.yoyChange },
  ]

  const max = Math.max(1, ...bars.map(b => Math.abs(b.value || 0)))
  const colour = colorFor('revenue', 0)

  return (
    <div style={{ width, height }} className="flex flex-col">
      <p className="text-[11px] font-semibold text-text-primary mb-1 text-center">
        Same {meta?.spanDays ?? ''} days, three periods
      </p>
      <div className="flex-1 flex items-end gap-3">
        {bars.map(b => {
          const h = (Math.abs(b.value || 0) / max) * 100
          return (
            <div key={b.key} className="flex-1 flex flex-col items-center justify-end h-full">
              <span className="text-[10px] tabular-nums text-text-primary mb-0.5">
                {fmtMoney(b.value || 0)}
              </span>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.max(2, h)}%`,
                  background: colour,
                  opacity: b.strong ? 1 : 0.42,
                }}
                title={`${b.label}: ${fmtMoney(b.value || 0)}`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-3 pt-1">
        {bars.map(b => (
          <div key={b.key} className="flex-1 text-center leading-tight">
            <p className="text-[10px] text-text-muted">{b.label}</p>
            {b.key !== 'now' && (
              <p
                className="text-[10px] font-semibold tabular-nums"
                style={b.pct === null || b.pct === undefined || b.pct === 0
                  ? undefined
                  : { color: b.pct > 0 ? GOOD_COLOR : BAD_COLOR }}
              >
                {b.pct === null || b.pct === undefined
                  ? '—'
                  : `${b.pct > 0 ? '+' : ''}${b.pct}%`}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function CategoryTable({ title, subtitle, rows, sparklines, meta, openKey, setOpenKey }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">{title}</p>
        <p className="text-[11px] text-text-muted">{subtitle}</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
            {COLUMNS.map((c, i) => (
              <th
                key={c.label}
                className={`py-1.5 px-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                style={zebraColumn(i)}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const open = openKey === r.category
            const points = sparklines[r.category] || []
            return (
              <Fragment key={r.category}>
                <tr
                  className="border-b border-border/60 cursor-pointer hover:bg-black/[0.03]"
                  onClick={() => setOpenKey(open ? null : r.category)}
                >
                  <td className="py-1.5 px-2 text-text-primary" style={zebraColumn(0)}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-text-muted text-[10px] w-2" aria-hidden="true">
                        {open ? '▼' : '▶'}
                      </span>
                      {r.category}
                      {r.negative && (
                        <span className="text-[10px] text-text-muted border border-border rounded px-1">
                          reduces revenue
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-text-primary font-semibold" style={zebraColumn(1)}>
                    {fmtMoney(r.revenue)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(2)}>
                    {fmtMoney(r.lastMonthRevenue)}
                  </td>
                  <td className="py-1.5 px-2 text-right" style={zebraColumn(3)}>
                    <Change pct={r.momChange} delta={r.momDelta} />
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(4)}>
                    {fmtMoney(r.lastYearRevenue)}
                  </td>
                  <td className="py-1.5 px-2 text-right" style={zebraColumn(5)}>
                    <Change pct={r.yoyChange} delta={r.yoyDelta} />
                  </td>
                </tr>

                {open && (
                  <tr className="border-b border-border/60">
                    <td colSpan={6} className="p-0">
                      <div className="px-6 py-3" style={{ background: 'rgba(128,128,128,0.05)' }}>
                        {/* Both charts are fixed-size, so the pair is centred
                            in whatever width the table has rather than stretched
                            to fill it. */}
                        <div className="flex flex-col lg:flex-row gap-8 justify-center items-start">
                          <div>
                            <p className="text-[11px] font-semibold text-text-primary mb-1 text-center">
                              {r.category} — last six months
                            </p>
                            <Sparkline points={points} />
                          </div>
                          <ComparisonBars row={r} meta={meta} />
                        </div>

                        {/* The centers folded into this category. A reader has
                            no way to audit a mapping, or to notice a new code
                            landing in the wrong place, unless it is shown. */}
                        {r.centers && r.centers.length > 1 && (
                          <div className="mt-2">
                            <p className="text-[11px] text-text-muted mb-1">
                              Profit centers folded into {r.category}. One showing nothing this period
                              and something last year has been renamed, not lost.
                            </p>
                            <table className="w-full text-sm">
                              <tbody>
                                {r.centers.map(c => (
                                  <tr key={c.profitCenter} className="border-b border-border/30 last:border-0">
                                    <td className="py-1 text-text-muted">{c.profitCenter}</td>
                                    <td className="py-1 text-right tabular-nums text-text-primary">{fmtMoney(c.revenue)}</td>
                                    <td className="py-1 text-right tabular-nums text-text-muted">{fmtMoney(c.lastMonthRevenue)}</td>
                                    <td className="py-1 text-right tabular-nums text-text-muted">{fmtMoney(c.lastYearRevenue)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="text-sm text-text-muted text-center py-8">Nothing in this selection.</p>
      )}
    </div>
  )
}
