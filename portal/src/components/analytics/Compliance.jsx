import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtMonth } from './chartPalette'
import { MonthlyTrend, ShareColumns, RankedBars } from './charts'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'

// ---------------------------------------------------------------------------
// Compliance — Analytics (admin only)
//
// THE COMPANY AVERAGE IS NOT THE STORY, so it is never shown alone. Six clubs
// sit between 72% and 87% task completion and one sits at 3.8%, which drags the
// pooled figure to 56%. The median club sits beside the pooled number and the
// outlier is named above the charts.
//
// Definitions are the old report's, unchanged: a job is judged once it is done
// or past due, and pending / in_progress jobs are NOT YET DUE and stay out of
// every rate. The count of jobs being deliberately not judged is shown rather
// than hidden.
// ---------------------------------------------------------------------------

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CLUB_LABEL = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// Beyond this a feed is stale enough that a club's "missed" work may simply not
// have been reported yet.
const STALE_HOURS = 6

function hoursSince(iso) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return (Date.now() - t) / 3_600_000
}

export default function Compliance({ startDate, endDate, locationSlug }) {
  const [asTable, setAsTable] = useState(false)

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/compliance?${query}`, { cache: true, signal }),
    [query]
  )

  const s = data?.summary || {}
  const byClub = data?.byClub || []
  const checklists = data?.checklists || []
  const neverStarted = data?.neverStarted || []

  // Worst 12, so the panel answers "what do we fix" without becoming a dump.
  const worst = useMemo(() => checklists.slice(0, 12), [checklists])

  const stale = useMemo(
    () => (data?.syncState || []).filter(x => {
      const h = hoursSince(x.last_success_at)
      return x.last_error || h === null || h > STALE_HOURS
    }),
    [data]
  )

  return (
    <div className="space-y-3">
      <Toolbar asTable={asTable} setAsTable={setAsTable} />

      {loading && <DesktopLoading />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Above the numbers. A reader who has taken 56% as the company's
              performance will not come back for a footnote. */}
          {data.notes?.outlier && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.outlier}</p>
            </div>
          )}

          {/* A stale feed looks exactly like a club that stopped working. */}
          {stale.length > 0 && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">
                Operandio sync is behind for {stale.map(x => CLUB_LABEL(x.location_slug)).join(', ')}.
                Missed work at {stale.length === 1 ? 'that club' : 'those clubs'} may simply not have been reported yet.
              </p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              {[
                { label: 'Task Completion', value: s.taskPct === null || s.taskPct === undefined ? 'N/A' : `${s.taskPct}%` },
                { label: 'Median Club', value: s.medianClubTaskPct === null || s.medianClubTaskPct === undefined ? 'N/A' : `${s.medianClubTaskPct}%` },
                { label: 'On Time', value: s.onTimeRate === null || s.onTimeRate === undefined ? 'N/A' : `${s.onTimeRate}%` },
                { label: 'Jobs Judged', value: fmtInt(s.decided) },
                { label: 'Missed', value: fmtInt(s.missed) },
                // Shown rather than hidden: these are the jobs the report is
                // deliberately not judging because they are not due yet.
                { label: 'Not Yet Due', value: fmtInt(s.notYetDue), muted: true },
                {
                  label: `vs ${data.meta?.comparisonLabel || 'prior'}`,
                  value: s.taskPctChange === null || s.taskPctChange === undefined
                    ? 'N/A' : `${s.taskPctChange > 0 ? '+' : ''}${s.taskPctChange}pp`,
                },
              ].map(t => (
                <div key={t.label} className="px-5 py-4 text-center min-w-[120px] flex-1">
                  <p className={`text-xl font-bold tabular-nums ${t.muted ? 'text-text-muted' : 'text-text-primary'}`}>
                    {t.value}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
                </div>
              ))}
            </div>
          </div>

          {asTable ? (
            <TableView byClub={byClub} months={data.months || []} checklists={checklists} />
          ) : (
            <>
              <MonthlyTrend
                title="Task Completion by Month"
                months={data.months || []}
                valueKey="taskPct"
                format="pct"
                seriesName="compliance"
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <RankedBars
                  title="Task Completion by Club"
                  rows={byClub}
                  labelKey="slug"
                  valueKey="taskPct"
                  format="pct"
                  secondary={c => `${fmtInt(c.onTime)} on time of ${fmtInt(c.decided)}`}
                  emptyText="No jobs in this selection."
                />
                <ShareColumns
                  title="Task Completion by Day of Week"
                  rows={data.dow || []}
                  valueKey="taskPct"
                  format="pct"
                  labelFor={r => DOW_SHORT[r.dow] ?? r.dow}
                  subtitle="weekends run lowest"
                />
              </div>

              {/* Named per club, because pooled these read as a company-wide
                  collapse when they belong to one site. */}
              <RankedBars
                title="Worst Checklists (by completion, this window)"
                rows={worst.map(c => ({ ...c, label: `${c.name} — ${CLUB_LABEL(c.slug)}` }))}
                labelKey="label"
                valueKey="taskPct"
                format="pct"
                secondary={c => `${fmtInt(c.missed)} missed of ${fmtInt(c.decided)} · ${fmtInt(c.stepsTotal)} steps`}
                emptyText="No checklists with judged jobs in this selection."
              />

              {neverStarted.length > 0 && (
                <div className="bg-surface rounded-xl border border-border p-3">
                  <p className="text-xs font-bold text-text-primary mb-1">Never Started</p>
                  <p className="text-[11px] text-text-muted mb-2">
                    Checklists with steps to do and not one of them touched in this window. A
                    different problem from being behind.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                          <th className="text-left font-semibold py-1.5">Checklist</th>
                          <th className="text-left font-semibold py-1.5">Club</th>
                          <th className="text-right font-semibold py-1.5">Jobs Judged</th>
                          <th className="text-right font-semibold py-1.5">Steps Untouched</th>
                        </tr>
                      </thead>
                      <tbody>
                        {neverStarted.map((c, i) => (
                          <tr key={`${c.name}-${c.slug}-${i}`} className="border-b border-border/60 last:border-0">
                            <td className="py-1.5 text-text-primary">{c.name}</td>
                            <td className="py-1.5 text-text-muted">{CLUB_LABEL(c.slug)}</td>
                            <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(c.decided)}</td>
                            <td className="py-1.5 text-right tabular-nums text-wcs-red font-semibold">{fmtInt(c.stepsTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function TableView({ byClub, months, checklists }) {
  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
        <p className="text-xs font-bold text-text-primary mb-2">By Club</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-1.5">Club</th>
              <th className="text-right font-semibold py-1.5">Task %</th>
              <th className="text-right font-semibold py-1.5">On Time %</th>
              <th className="text-right font-semibold py-1.5">Judged</th>
              <th className="text-right font-semibold py-1.5">Missed</th>
              <th className="text-right font-semibold py-1.5">Not Yet Due</th>
            </tr>
          </thead>
          <tbody>
            {byClub.map(c => (
              <tr key={c.slug} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{CLUB_LABEL(c.slug)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary font-semibold">
                  {c.taskPct === null ? 'N/A' : `${c.taskPct}%`}
                </td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">
                  {c.onTimeRate === null ? 'N/A' : `${c.onTimeRate}%`}
                </td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(c.decided)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(c.missed)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(c.notYetDue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
        <p className="text-xs font-bold text-text-primary mb-2">By Month</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-1.5">Month</th>
              <th className="text-right font-semibold py-1.5">Task %</th>
              <th className="text-right font-semibold py-1.5">On Time %</th>
              <th className="text-right font-semibold py-1.5">Judged</th>
              <th className="text-right font-semibold py-1.5">Missed</th>
            </tr>
          </thead>
          <tbody>
            {months.map(m => (
              <tr key={m.month} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{fmtMonth(m.month)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{m.taskPct === null ? 'N/A' : `${m.taskPct}%`}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{m.onTimeRate === null ? 'N/A' : `${m.onTimeRate}%`}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(m.decided)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(m.missed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
        <p className="text-xs font-bold text-text-primary mb-2">Checklists</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-1.5">Checklist</th>
              <th className="text-left font-semibold py-1.5">Club</th>
              <th className="text-right font-semibold py-1.5">Task %</th>
              <th className="text-right font-semibold py-1.5">Missed</th>
              <th className="text-right font-semibold py-1.5">Judged</th>
              <th className="text-right font-semibold py-1.5">Steps</th>
            </tr>
          </thead>
          <tbody>
            {checklists.map((c, i) => (
              <tr key={`${c.name}-${c.slug}-${i}`} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{c.name}</td>
                <td className="py-1.5 text-text-muted">{CLUB_LABEL(c.slug)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{c.taskPct === null ? 'N/A' : `${c.taskPct}%`}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(c.missed)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(c.decided)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(c.stepsTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Toolbar({ asTable, setAsTable }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={() => setAsTable(v => !v)}
        className="text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors"
      >
        {asTable ? 'Show charts' : 'Show table'}
      </button>
    </div>,
    slot
  )
}
