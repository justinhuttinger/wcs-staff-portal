import { useMemo, useState } from 'react'
import { getChildcareReport } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtDay, colorFor } from './chartPalette'
import { zebraColumn } from './charts'
import { LOCATION_NAMES } from '../../config/locations'

// ---------------------------------------------------------------------------
// Childcare — Analytics (admin only)
//
// THIS REPORT EXISTS TO STAFF A ROOM, so it is built around "how many children
// are usually here on a Tuesday evening" rather than a running total. Everything
// is split morning / evening, because those are two different shifts with two
// different staffing needs and averaging them produces a number that describes
// neither.
//
// AN UNREPORTED BLOCK IS UNKNOWN, NOT ZERO. It is left out of every average
// rather than counted as "nobody came" — a phantom zero drags the average down
// in exactly the direction that leaves a room short-staffed. The sample count
// travels beside each average so a two-day figure is never read as a settled one.
//
// UNDER-1 IS SHOWN SEPARATELY THROUGHOUT, never folded into a headcount. Infants
// carry a different ratio, so a total of twelve means something different
// depending on how many of them are under a year old.
// ---------------------------------------------------------------------------

const BLOCK_LABEL = { morning: 'Morning', evening: 'Evening' }
const DOW_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const CLUB_NAMES = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))
const CLUB_LABEL = s => (s ? (CLUB_NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1)) : s)

// A dash, never a 0. See the header note: the difference is the whole report.
const num = v => (typeof v === 'number' ? String(v) : '—')

// Fixed colours so morning and evening keep their identity between the chart,
// the planning table and the log. Slot-based rather than by rank.
const MORNING = colorFor('morning', 0)
const EVENING = colorFor('evening', 1)

export default function Childcare({ startDate, endDate, locationSlug }) {
  const { data, loading, error, retrying } = useCancellableFetch(
    signal => getChildcareReport(
      { start: startDate, end: endDate, locationSlug },
      { cache: true, signal }
    ),
    [startDate, endDate, locationSlug]
  )

  const t = data?.totals

  return (
    <div className="space-y-3">
      {loading && <DesktopLoading retrying={retrying} />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Warnings first. Every one of them means a number below is missing
              or ambiguous, so they cannot sit under the charts they qualify. */}
          {(data.warnings || []).map(w => (
            <div key={w} className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{w}</p>
            </div>
          ))}

          {data.entries === 0 ? (
            <div className="bg-surface rounded-xl border border-border p-8 text-center">
              <p className="text-sm text-text-muted">No childcare headcounts were recorded in this range.</p>
              <p className="text-[11px] text-text-muted/70 mt-2 max-w-md mx-auto">
                Headcounts come from the two number questions on the morning and evening childcare
                checklists in Operandio. A club that has the checklist but not those questions will
                never appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-surface rounded-xl border border-border overflow-x-auto">
                <div className="flex min-w-max divide-x divide-border">
                  {[
                    { label: 'Avg Over 1 Year', value: num(t.over1.avg), sub: `peak ${num(t.over1.peak)}` },
                    { label: 'Avg Under 1 Year', value: num(t.under1.avg), sub: `peak ${num(t.under1.peak)}` },
                    { label: 'Days Reported', value: fmtInt(t.days_reported), sub: `${fmtInt(t.blocks_reported)} blocks`, muted: true },
                    { label: 'Corrections', value: fmtInt(t.corrections), sub: 'resubmitted blocks', muted: true },
                  ].map(c => (
                    <div key={c.label} className="px-5 py-4 text-center min-w-[150px] flex-1">
                      <p className={`text-xl font-bold tabular-nums ${c.muted ? 'text-text-muted' : 'text-text-primary'}`}>
                        {c.value}
                      </p>
                      <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{c.label}</p>
                      <p className="text-[10px] text-text-muted/70 mt-0.5 leading-tight">{c.sub}</p>
                    </div>
                  ))}
                </div>
              </div>

              <WeekShape rows={data.day_of_week || []} />
              <PlanningTable rows={data.day_of_week || []} />
              <DailyTrend rows={data.trend || []} />
              <Ledger rows={data.ledger || []} />
            </>
          )}
        </>
      )}
    </div>
  )
}

// --- the staffing picture ----------------------------------------------------

/**
 * Average headcount per weekday, morning beside evening.
 *
 * The two shifts are drawn as neighbouring bars rather than stacked: nobody
 * staffs a whole day at once, so the number that matters is each shift's own
 * height, and a stack makes those impossible to compare by eye.
 */
function WeekShape({ rows }) {
  const byDay = useMemo(() => {
    const map = new Map(DOW_ORDER.map(d => [d, { day: d, morning: null, evening: null, samples: 0 }]))
    for (const r of rows) {
      const slot = map.get(r.day_of_week)
      if (!slot) continue
      slot[r.block] = r.combined.avg
      slot.samples += r.combined.occurrences || 0
    }
    // A day nobody has ever reported is left out entirely rather than drawn
    // as an empty column that reads like a quiet day.
    return [...map.values()].filter(d => d.morning !== null || d.evening !== null)
  }, [rows])

  if (byDay.length === 0) return null

  const max = Math.max(1, ...byDay.flatMap(d => [d.morning || 0, d.evening || 0]))
  const H = 150

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">Average Headcount by Day</p>
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          {[['Morning', MORNING], ['Evening', EVENING]].map(([label, colour]) => (
            <span key={label} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colour }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-4 overflow-x-auto pb-1" style={{ height: H + 34 }}>
        {byDay.map(d => (
          <div key={d.day} className="flex flex-col items-center gap-1 min-w-[64px] flex-1">
            <div className="flex items-end gap-1 w-full justify-center" style={{ height: H }}>
              {[['morning', MORNING], ['evening', EVENING]].map(([block, colour]) => {
                const v = d[block]
                if (v === null || v === undefined) {
                  // An unstaffed or unreported shift is a gap, not a zero bar.
                  return <div key={block} className="w-6 flex items-end justify-center text-[10px] text-border">—</div>
                }
                return (
                  <div key={block} className="w-6 flex flex-col items-center justify-end h-full">
                    <span className="text-[10px] text-text-muted tabular-nums mb-0.5">{v}</span>
                    <div className="w-full rounded-t-[3px]"
                      style={{ height: `${Math.max(2, (v / max) * (H - 16))}px`, background: colour }} />
                  </div>
                )
              })}
            </div>
            <span className="text-[11px] text-text-muted">{d.day.slice(0, 3)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The same shape as a table, with the numbers a chart cannot carry: the split
 * by age, the peak, and how many times the block was actually reported.
 */
function PlanningTable({ rows }) {
  if (rows.length === 0) return null
  const head = ['Day', 'Shift', 'Avg Over 1', 'Avg Under 1', 'Avg Total', 'Peak', 'Samples']
  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">By Day and Shift</p>
        {/* Not a footnote: a two-sample average and a thirty-sample one look
            identical on the page and mean entirely different things. */}
        <p className="text-[11px] text-text-muted">samples = times that shift reported</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted">
            {head.map((h, i) => (
              <th key={h} className={`py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide ${i >= 2 ? 'text-right' : 'text-left'}`}
                style={zebraColumn(i)}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.dow}-${r.block}`} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 px-2 text-text-primary" style={zebraColumn(0)}>{r.day_of_week}</td>
              <td className="py-1.5 px-2" style={zebraColumn(1)}>
                <span className="inline-flex items-center gap-1.5 text-text-muted">
                  <span className="w-2 h-2 rounded-sm"
                    style={{ background: r.block === 'morning' ? MORNING : EVENING }} />
                  {BLOCK_LABEL[r.block]}
                </span>
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(2)}>{num(r.over1.avg)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(3)}>{num(r.under1.avg)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-text-primary" style={zebraColumn(4)}>{num(r.combined.avg)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(5)}>{num(r.combined.peak)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(6)}>{fmtInt(r.combined.occurrences)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --- over time ---------------------------------------------------------------

/**
 * Daily totals, over-1 stacked on under-1.
 *
 * Stacked here and grouped in the week chart on purpose: this one answers "how
 * busy was that day", which is a single quantity, and the age split is the
 * texture inside it rather than two things being compared.
 */
function DailyTrend({ rows }) {
  if (rows.length === 0) return null
  const max = Math.max(1, ...rows.map(r => r.total))
  const H = 120
  // Past a few weeks the date under every bar becomes unreadable, so labels
  // thin out while every bar stays.
  const every = Math.ceil(rows.length / 16)

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">Daily Total</p>
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          {[['Over 1', MORNING], ['Under 1', EVENING]].map(([label, colour]) => (
            <span key={label} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colour }} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: H + 26 }}>
        {rows.map((r, i) => (
          <div key={r.date} className="flex flex-col items-center gap-1 min-w-[18px] flex-1" title={`${r.date}: ${r.total}`}>
            <div className="w-full flex flex-col justify-end items-center" style={{ height: H }}>
              <div className="w-full rounded-t-[3px]"
                style={{ height: `${(r.over1 / max) * H}px`, background: MORNING }} />
              <div className="w-full"
                style={{ height: `${(r.under1 / max) * H}px`, background: EVENING }} />
            </div>
            <span className="text-[9px] text-text-muted whitespace-nowrap">
              {i % every === 0 ? fmtDay(r.date) : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- the log -----------------------------------------------------------------

/** One row per club per day. Days nothing was submitted never appear. */
function Ledger({ rows }) {
  const [limit, setLimit] = useState(40)
  if (rows.length === 0) return null
  const shown = rows.slice(0, limit)
  const head = ['Date', 'Club', 'AM Over 1', 'AM Under 1', 'PM Over 1', 'PM Under 1', 'Day Total']

  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">Daily Log</p>
        <p className="text-[11px] text-text-muted">newest first</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted">
            {head.map((h, i) => (
              <th key={h} className={`py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide ${i >= 2 ? 'text-right' : 'text-left'}`}
                style={zebraColumn(i)}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map(r => (
            <tr key={`${r.date}-${r.location_slug}`} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 px-2 text-text-primary whitespace-nowrap" style={zebraColumn(0)}>
                {fmtDay(r.date)} <span className="text-text-muted">{r.day_of_week.slice(0, 3)}</span>
                {/* A block submitted twice is a correction; the latest count
                    wins, and saying so is how a real double-entry stays
                    visible instead of looking like clean data. */}
                {r.corrections > 0 && (
                  <span className="ml-2 text-[10px] text-text-muted border border-border rounded px-1 py-0.5"
                    title="This block was submitted more than once; the latest count is shown">
                    corrected
                  </span>
                )}
              </td>
              <td className="py-1.5 px-2 text-text-muted whitespace-nowrap" style={zebraColumn(1)}>{CLUB_LABEL(r.location_slug)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(2)}>{r.morning ? num(r.morning.over1) : '—'}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(3)}>{r.morning ? num(r.morning.under1) : '—'}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(4)}>{r.evening ? num(r.evening.over1) : '—'}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(5)}>{r.evening ? num(r.evening.under1) : '—'}</td>
              <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-text-primary" style={zebraColumn(6)}>{fmtInt(r.day_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <button type="button" onClick={() => setLimit(l => l + 100)}
          className="mt-2 w-full py-1.5 rounded-lg border border-border bg-bg text-xs text-text-muted hover:text-text-primary">
          Show more ({fmtInt(rows.length - shown.length)} older)
        </button>
      )}
    </div>
  )
}
