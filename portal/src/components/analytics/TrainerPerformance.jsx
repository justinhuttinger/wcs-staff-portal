import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtPct, fmtMoney } from './chartPalette'
import { zebra, HOVER_TINT } from './tableTints'
import PendingOutcomePanel from './PendingOutcomePanel'

// ---------------------------------------------------------------------------
// Trainer Performance — Analytics (admin only)
//
// ONE ROW CAN BELONG TO TWO PEOPLE, on purpose. The session and client columns
// are whoever DELIVERED the training; PT Close Amount is whoever the COMMISSION
// was paid to. For July 2026 those disagree on 40% of the money, so the header
// groups the columns and says which is which — otherwise a manager with no
// sessions and $5,860 closed reads as a data error.
//
// The columns for Available Hours and Utilization Rate from the source
// dashboard are deliberately absent: ABC holds no hire date or scheduled
// availability, so both would be invented.
//
// ZEBRA IS BY COLUMN, NOT BY ROW — thirteen columns wide, the risk is reading a
// number against the wrong HEADER, not against the wrong trainer. Row striping
// answers a problem this table does not have. The name column stays unstriped
// as the anchor, and hover highlights the row instead.
// ---------------------------------------------------------------------------

// Club is folded into the name rather than taking a column of its own, matching
// Salesperson Performance: the sticky first column carries the whole identity,
// and everything that scrolls is a number.
const rowLabel = (row) => [row.club, row.trainer].filter(Boolean).join('; ')

// Clicking a header cycles desc -> asc -> back to this.
const DEFAULT_SORT = { by: 'completedSessions', order: 'desc' }

// Bar tones match Salesperson Performance, and a tone is assigned per MEASURE
// so the eye can group columns without reading the header: counts blue, effort
// teal, intros amber, money orange.
const BAR_TONES = {
  blue: 'bg-sky-500/70',
  teal: 'bg-teal-500/70',
  amber: 'bg-amber-500/70',
  red: 'bg-rose-500/70',
  slate: 'bg-slate-400/70',
  orange: 'bg-orange-500/70',
}

const COLUMNS = [
  { key: 'lastSession', label: 'Last Session', format: 'date' },
  { key: 'uniqueClients', label: 'Clients', format: 'int', group: true, bar: true, barTone: 'blue' },
  { key: 'completedSessions', label: 'Sessions', format: 'int', bar: true, barTone: 'blue' },
  { key: 'cancellationRate', label: 'Cancel %', format: 'pct', bar: true, barTone: 'red' },
  { key: 'avgSessionMinutes', label: 'Avg Min', format: 'int', bar: true, barTone: 'slate' },
  { key: 'memberMonths', label: 'Months w/ Trainer', format: 'num', bar: true, barTone: 'teal' },
  { key: 'ptHours', label: 'PT Hours', format: 'num', bar: true, barTone: 'teal' },
  { key: 'classHours', label: 'Class Hours', format: 'num', bar: true, barTone: 'teal' },
  { key: 'dayOnesBooked', label: 'Day Ones Booked', format: 'int', group: true, bar: true, barTone: 'amber' },
  { key: 'dayOnesCompleted', label: 'Completed', format: 'int', bar: true, barTone: 'amber' },
  { key: 'dayOnesSold', label: 'Sold', format: 'int', bar: true, barTone: 'amber' },
  { key: 'closeRate', label: 'Close Rate', format: 'pct', bar: true, barTone: 'amber' },
  // Red, not amber: the rest of that block is what happened to the intros, and
  // this one is what has NOT happened to them. Counted on the appointment date
  // rather than the booking date the three columns before it use.
  { key: 'dayOnesPending', label: 'Pending Outcome', format: 'int', bar: true, barTone: 'red' },
  { key: 'closeAmount', label: 'PT Close Amount', format: 'money', group: true, bar: true, barTone: 'orange' },
]

function fmt(v, format) {
  if (v === null || v === undefined) return 'N/A'
  switch (format) {
    case 'money': return fmtMoney(v)
    case 'pct': return fmtPct(v)
    case 'num': return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })
    case 'date': return String(v)
    default: return fmtInt(v)
  }
}

function Tile({ tile }) {
  return (
    <div className="bg-surface rounded-xl border border-border px-3 py-2 text-center">
      <p className="text-lg font-bold tabular-nums text-text-primary">
        {tile.format === 'money' ? fmtMoney(tile.value)
          : tile.format === 'pct' ? fmtPct(tile.value)
          : tile.format === 'hours' ? fmt(tile.value, 'num')
          : fmtInt(tile.value)}
      </p>
      <p className="text-[10px] font-medium text-text-muted leading-tight mt-0.5">{tile.label}</p>
    </div>
  )
}

export default function TrainerPerformance({ startDate, endDate, locationSlug }) {
  const [sortBy, setSortBy] = useState(DEFAULT_SORT.by)
  const [sortOrder, setSortOrder] = useState(DEFAULT_SORT.order)

  const query = useMemo(() => new URLSearchParams({
    start: startDate, end: endDate, clubs: locationSlug || 'all',
  }).toString(), [startDate, endDate, locationSlug])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/trainer-performance?${query}`, { cache: true, signal }),
    [query]
  )

  // Click a header: sort it high-to-low, again for low-to-high, again to drop
  // back to the default. Landing on a new column always starts high-to-low —
  // "who is on top" is the question a header click is usually asking.
  function cycleSort(key) {
    if (sortBy !== key) {
      setSortBy(key)
      setSortOrder('desc')
    } else if (sortOrder === 'desc') {
      setSortOrder('asc')
    } else {
      setSortBy(DEFAULT_SORT.by)
      setSortOrder(DEFAULT_SORT.order)
    }
  }

  const ariaSort = (key) =>
    sortBy !== key ? 'none' : sortOrder === 'asc' ? 'ascending' : 'descending'

  // Sorted here, not server-side, so a header click re-orders what is already
  // on screen rather than making a round trip.
  const rows = useMemo(() => {
    const list = [...(data?.rows || [])]
    const dir = sortOrder === 'asc' ? 1 : -1
    const valueOf = (row) => (sortBy === 'label' ? rowLabel(row) : row[sortBy])
    list.sort((a, b) => {
      const av = valueOf(a)
      const bv = valueOf(b)
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av || '').localeCompare(String(bv || '')) * dir
      }
      // Nulls always sink, whichever way the sort points — an N/A is not the
      // smallest value, it is the absence of one. A trainer never given an
      // intro must not top Close Rate for having no rate at all.
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      return (av - bv) * dir
    })
    return list
  }, [data, sortBy, sortOrder])

  // Bar scale per column.
  //
  // PERCENTAGE COLUMNS ARE PINNED TO A 0-100 TRACK, not to the column's own
  // maximum, so 50% always looks like half regardless of who else is on the
  // list. Count columns scale to the column max: there is no natural ceiling
  // for "how many sessions did you run", so relative length is the only useful
  // reading. Same rule as Salesperson Performance.
  const maxima = useMemo(() => {
    const out = {}
    for (const col of COLUMNS) {
      if (!col.bar) continue
      out[col.key] = col.format === 'pct'
        ? 100
        : rows.reduce((m, r) => {
          const v = r[col.key]
          return typeof v === 'number' && v > m ? v : m
        }, 0)
    }
    return out
  }, [rows])

  if (loading) return <DesktopLoading />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }

  const anyEstimated = rows.some(r => r.closeAmountEstimated)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-2">
        {(data?.tiles || []).map(t => <Tile key={t.key} tile={t} />)}
      </div>

      <div className="bg-surface rounded-xl border border-border">
        <div className="overflow-auto max-h-[calc(100vh-18rem)]">
          <table className="min-w-max w-full text-sm border-separate border-spacing-0">
            <thead>
              {/* Grouping header: the only thing stopping "Sessions" and "PT
                  Close Amount" from reading as one person's numbers. */}
              <tr>
                <th className="sticky left-0 top-0 z-40 bg-surface border-b border-border" />
                <th className="sticky top-0 z-30 bg-surface border-b border-border" colSpan={1} />
                <th className="sticky top-0 z-30 bg-surface border-b border-l border-border text-[10px] font-bold uppercase tracking-wide text-text-muted px-3 pt-2" colSpan={7}>
                  Delivered the training
                </th>
                <th className="sticky top-0 z-30 bg-surface border-b border-l border-border text-[10px] font-bold uppercase tracking-wide text-text-muted px-3 pt-2" colSpan={4}>
                  Ran the Day One
                </th>
                <th className="sticky top-0 z-30 bg-surface border-b border-l border-border text-[10px] font-bold uppercase tracking-wide text-text-muted px-3 pt-2" colSpan={1}>
                  Paid the commission
                </th>
              </tr>
              <tr>
                <th
                  scope="col"
                  aria-sort={ariaSort('label')}
                  className="sticky left-0 top-7 z-40 bg-surface text-left font-semibold text-text-primary px-4 py-2 min-w-[210px] border-b border-border"
                >
                  <SortButton active={sortBy === 'label'} order={sortOrder} onClick={() => cycleSort('label')}>
                    Club / Trainer
                  </SortButton>
                </th>
                {COLUMNS.map((col, ci) => (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSort(col.key)}
                    className={`sticky top-7 z-30 font-semibold text-text-muted px-3 py-2 text-xs whitespace-nowrap border-b border-border text-right ${zebra(ci)} ${col.group ? 'border-l' : ''}`}
                  >
                    <SortButton
                      active={sortBy === col.key}
                      order={sortOrder}
                      onClick={() => cycleSort(col.key)}
                      align="right"
                    >
                      {col.label}
                    </SortButton>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.trainer} className="group">
                  {/* The name column never stripes — it is the anchor the eye
                      comes back to, and being sticky it needs one solid opaque
                      background or the columns scroll through it. */}
                  <td className={`sticky left-0 z-20 bg-surface px-4 py-1.5 text-text-primary font-medium whitespace-nowrap border-b border-border/60 ${HOVER_TINT}`}>
                    {rowLabel(r)}
                  </td>
                  {COLUMNS.map((col, ci) => {
                    const value = r[col.key]
                    const max = maxima[col.key] || 0
                    const raw = col.bar && typeof value === 'number' && max > 0
                      ? Math.max(2, Math.round((value / max) * 100))
                      : 0
                    // A percentage above 100 runs off a fixed track, so clamp
                    // the drawn bar and notch it rather than letting it spill
                    // out of the cell. The number beside it stays true.
                    const overflows = raw > 100
                    const width = Math.min(100, raw)
                    const estimated = col.key === 'closeAmount' && r.closeAmountEstimated
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-1.5 text-xs tabular-nums whitespace-nowrap border-b border-border/60 ${col.bar ? '' : 'text-right'} ${col.group ? 'border-l border-border' : ''} ${value === null || value === undefined ? 'text-text-muted' : 'text-text-primary'} ${zebra(ci)} ${HOVER_TINT}`}
                      >
                        {col.bar ? (
                          <div className="relative flex items-center gap-2 h-5">
                            <div className="relative flex-1 h-3.5 min-w-[44px]">
                              <div
                                className={`absolute inset-y-0 left-0 ${overflows ? 'rounded-l-sm' : 'rounded-sm'} ${BAR_TONES[col.barTone]}`}
                                style={{ width: `${width}%` }}
                              />
                              {overflows && (
                                <div
                                  className={`absolute inset-y-0 right-0 w-1.5 ${BAR_TONES[col.barTone]}`}
                                  style={{ clipPath: 'polygon(0 0, 100% 50%, 0 100%)' }}
                                  title={`${fmt(value, col.format)} - beyond the 100% scale`}
                                />
                              )}
                            </div>
                            <span className="text-xs tabular-nums w-16 text-right flex-shrink-0">
                              {fmt(value, col.format)}
                              {estimated && (
                                <span
                                  className="ml-0.5 text-[10px] text-amber-600 font-bold"
                                  title="No commission record for at least one of these sales, so the trainer who delivered it stood in."
                                >*</span>
                              )}
                            </span>
                          </div>
                        ) : fmt(value, col.format)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="text-sm text-text-muted text-center py-10">No trainer activity in this range.</p>
        )}
      </div>

      {anyEstimated && (
        <p className="text-[11px] text-text-muted px-1">
          <span className="text-amber-600 font-bold">*</span> No commission record for at least one of
          those sales, so the trainer who delivered it stood in. Commission data starts April 2026.
        </p>
      )}

      {/* Which intros are outstanding, behind the Pending Outcome column. */}
      <PendingOutcomePanel pending={data?.pending} />
    </div>
  )
}

function SortButton({ active, order, onClick, children, align = 'left' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Sort by this column"
      className={`group/sort flex items-center gap-1 w-full transition-colors ${
        align === 'right' ? 'justify-end' : ''
      } ${active ? 'text-wcs-red' : 'hover:text-text-primary'}`}
    >
      <span className="truncate">{children}</span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden="true"
        className={`w-3 h-3 flex-shrink-0 transition-opacity ${
          active ? 'opacity-100' : 'opacity-0 group-hover/sort:opacity-40'
        } ${active && order === 'asc' ? 'rotate-180' : ''}`}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}
