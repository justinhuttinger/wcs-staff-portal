import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtMonth } from './chartPalette'
import { MultiTrend, RankedBars } from './charts'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { LOCATION_NAMES } from '../../config/locations'
import { getOperandioQaReport } from '../../lib/api'
import { openAuditReport } from '../../lib/qaReportHtml'

// ---------------------------------------------------------------------------
// Audits — Analytics (admin only)
//
// COVERAGE IS THE REPORT, NOT THE SCORE. Scores sit in a narrow 74-97% band at
// sample sizes of one to seven, where ranking is mostly noise. Who is NOT being
// audited is the fact worth acting on, so the department x club grid leads and
// the averages follow it.
//
// THREE STATES PER CELL, AND THEY ARE NOT SHADES OF ONE THING:
//
//   off      switched off in Admin. Not expected, not counted, not a failure.
//   never    enabled and never once audited. Cannot be fixed by waiting.
//   stale    audited, but not within the cycle.
//
// Salem's Childcare and Group X audits are switched off deliberately. Reading
// those as gaps would invent work and bury the pairs that genuinely are not
// being done.
// ---------------------------------------------------------------------------

// Proper names from the shared config, so a rename lands everywhere at once.
const CLUB_NAMES = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))
const CLUB_LABEL = s => (s ? (CLUB_NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1)) : s)

// Scores live in a narrow band, so the scale is anchored to that band rather
// than to 0-100, where every club would look identical.
function scoreTone(pct) {
  if (pct === null || pct === undefined) return null
  if (pct >= 90) return { bg: 'rgba(0,131,0,0.14)', fg: '#008300' }
  if (pct >= 80) return { bg: 'rgba(237,161,0,0.16)', fg: '#a06c00' }
  return { bg: 'rgba(227,73,72,0.14)', fg: '#c0322f' }
}

/**
 * One department/club cell.
 *
 * A cell with an audit behind it OPENS THAT REPORT, the same way the old Audits
 * report did — openAuditReport renders the full submission, falling back to the
 * stored URL when the detail fetch comes back empty. Rendered as a real button
 * so it is reachable by keyboard, not a div with an onClick.
 */
function Cell({ cell }) {
  const canOpen = cell.enabled && cell.everAudited && (cell.lastId || cell.lastReportUrl)

  const open = () => {
    if (!canOpen) return
    openAuditReport(
      { id: cell.lastId, report_url: cell.lastReportUrl },
      getOperandioQaReport,
      CLUB_LABEL(cell.slug)
    )
  }

  if (!cell.enabled) {
    return (
      <td className="px-2 py-1.5 text-center align-middle">
        <span className="text-[10px] text-text-muted/60" title="Switched off in Admin → Audits">off</span>
      </td>
    )
  }
  if (!cell.everAudited) {
    return (
      <td className="px-2 py-1.5 text-center align-middle">
        <span className="inline-block text-[10px] font-semibold text-wcs-red border border-wcs-red/40 rounded px-1.5 py-0.5">
          never
        </span>
      </td>
    )
  }
  const tone = scoreTone(cell.lastScore)
  return (
    <td className="px-2 py-1.5 text-center align-middle">
      <button
        type="button"
        onClick={open}
        disabled={!canOpen}
        className={`inline-flex flex-col items-center rounded px-2 py-1 min-w-[54px] transition-shadow ${
          canOpen ? 'cursor-pointer hover:ring-2 hover:ring-wcs-red/40' : 'cursor-default'
        }`}
        style={tone ? { background: tone.bg } : undefined}
        title={canOpen
          ? `Open the ${cell.lastDate} report`
          : `Last audited ${cell.lastDate}${cell.daysStale !== null ? ` (${cell.daysStale} days ago)` : ''}`}
      >
        <span className="text-xs font-bold tabular-nums" style={tone ? { color: tone.fg } : undefined}>
          {cell.lastScore === null ? '—' : `${cell.lastScore}%`}
        </span>
        <span className={`text-[9px] tabular-nums ${cell.stale ? 'text-wcs-red font-semibold' : 'text-text-muted'}`}>
          {cell.daysStale === null ? '' : `${cell.daysStale}d`}
        </span>
      </button>
    </td>
  )
}

export default function Audits({ startDate, endDate, locationSlug }) {
  const [asTable, setAsTable] = useState(false)

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error, retrying } = useCancellableFetch(
    signal => api(`/analytics/audits?${query}`, { cache: true, signal }),
    [query]
  )

  const s = data?.summary || {}
  const grid = data?.grid || []
  const clubs = data?.clubs || []

  return (
    <div className="space-y-3">
      <Toolbar asTable={asTable} setAsTable={setAsTable} />

      {loading && <DesktopLoading retrying={retrying} />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* The history warning comes first: an empty month in the backfill era
              is not a club that skipped its audit, and reading it that way
              would accuse people of missing work they did. */}
          {data.notes?.history && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.history}</p>
            </div>
          )}

          {data.notes?.coverage && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.coverage}</p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              {[
                { label: 'Coverage', value: s.coverage === null || s.coverage === undefined ? 'N/A' : `${s.coverage}%` },
                { label: 'Never Audited', value: fmtInt(s.gaps), alarm: s.gaps > 0 },
                { label: 'Overdue', value: fmtInt(s.stale), alarm: s.stale > 0 },
                { label: 'Audits in Window', value: fmtInt(s.submissions) },
                { label: 'Average Score', value: s.avgScore === null || s.avgScore === undefined ? 'N/A' : `${s.avgScore}%` },
              ].map(t => (
                <div key={t.label} className="px-5 py-4 text-center min-w-[130px] flex-1">
                  <p className={`text-xl font-bold tabular-nums ${t.alarm ? 'text-wcs-red' : 'text-text-primary'}`}>
                    {t.value}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* The grid leads. It is the only view that shows absence, and absence
              is what this report is for. */}
          <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="text-xs font-bold text-text-primary">Latest Audit by Department and Club</p>
              <p className="text-[11px] text-text-muted">click a score to open the report</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="text-left font-semibold py-1.5 pr-3 min-w-[180px]">Department</th>
                  {clubs.map(c => (
                    <th key={c} className="font-semibold py-1.5 px-2 text-center whitespace-nowrap">
                      {CLUB_LABEL(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map(row => (
                  <tr key={row.department} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3 text-text-primary whitespace-nowrap">{row.department}</td>
                    {row.cells.map(cell => <Cell key={cell.slug} cell={cell} />)}
                  </tr>
                ))}
              </tbody>
            </table>
            {grid.length === 0 && (
              <p className="text-sm text-text-muted text-center py-8">No audits recorded.</p>
            )}
          </div>

          {!asTable && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <RankedBars
                  title="Average Score by Department"
                  rows={(data.byDepartment || []).map(d => ({ ...d, label: d.key }))}
                  labelKey="label" valueKey="avgScore" format="pct"
                  // Sample size travels with every average. One audit at 95% is
                  // not a better result than six averaging 90%.
                  secondary={d => `${fmtInt(d.submissions)} audit${d.submissions === 1 ? '' : 's'}${d.rankable ? '' : ' · too few to rank'}`}
                  emptyText="No audits in this window."
                />
                <RankedBars
                  title="Average Score by Club"
                  rows={(data.byClub || []).map(c => ({ ...c, label: CLUB_LABEL(c.key) }))}
                  labelKey="label" valueKey="avgScore" format="pct"
                  secondary={c => `${fmtInt(c.submissions)} audit${c.submissions === 1 ? '' : 's'}${c.rankable ? '' : ' · too few to rank'}`}
                  emptyText="No audits in this window."
                />
              </div>

              {/* A trailing YEAR with one line per department, not a monthly
                  average. Audits run about monthly per department per club, so
                  a month's "average" is one or two readings and lurches on a
                  single 78%. Over a year the real direction shows, and with
                  several clubs selected each point is the mean across the clubs
                  audited that month. */}
              <MultiTrend
                title="Score by Department, Trailing Year"
                months={data.trendMonths || []}
                series={data.trendSeries || []}
                format="pct"
                subtitle={`${(data.trendSeries || []).length} departments`}
              />
            </>
          )}

          {(data.gaps?.length > 0 || data.stale?.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {data.gaps?.length > 0 && (
                <div className="bg-surface rounded-xl border border-border p-3">
                  <p className="text-xs font-bold text-text-primary mb-1">Never Audited</p>
                  <p className="text-[11px] text-text-muted mb-2">
                    Switched on in Admin and never once audited. Waiting will not fix these.
                  </p>
                  <ul className="space-y-1">
                    {data.gaps.map((g, i) => (
                      <li key={i} className="text-sm text-text-primary flex justify-between gap-3">
                        <span>{g.department}</span>
                        <span className="text-text-muted">{CLUB_LABEL(g.slug)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.stale?.length > 0 && (
                <div className="bg-surface rounded-xl border border-border p-3">
                  <p className="text-xs font-bold text-text-primary mb-1">Overdue</p>
                  <p className="text-[11px] text-text-muted mb-2">Audited before, but not within the cycle.</p>
                  <ul className="space-y-1">
                    {data.stale.map((g, i) => (
                      <li key={i} className="text-sm text-text-primary flex justify-between gap-3">
                        <span>{g.department}</span>
                        <span className="text-text-muted">
                          {CLUB_LABEL(g.slug)} · <span className="tabular-nums">{g.daysStale}d</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {asTable && (
            <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
              <p className="text-xs font-bold text-text-primary mb-2">By Month</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                    <th className="text-left font-semibold py-1.5">Month</th>
                    <th className="text-right font-semibold py-1.5">Audits</th>
                    <th className="text-right font-semibold py-1.5">Average Score</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.months || []).map(m => (
                    <tr key={m.month} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5 text-text-primary">{fmtMonth(m.month)}</td>
                      <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(m.submissions)}</td>
                      <td className="py-1.5 text-right tabular-nums text-text-primary">
                        {m.avgScore === null ? 'N/A' : `${m.avgScore}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
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
