import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtMonth } from './chartPalette'
import { MonthlyTrend, ShareColumns, RankedBars, zebraColumn } from './charts'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { LOCATION_NAMES } from '../../config/locations'

// ---------------------------------------------------------------------------
// Group X — Analytics (admin only)
//
// Attendance by class, hour, weekday, month, instructor and club.
//
// COVERAGE LEADS WHILE CAPTURE IS NEW. Headcount recording is just starting, so
// "average attendance 14" means very little next to "we counted 3 of 47
// classes". The coverage figure sits in the summary and the missed classes get
// their own panel, because that list is the actionable half today.
//
// A CLASS WITH NO HEADCOUNT IS MISSING, NOT ZERO. It is excluded from every
// average rather than dragging them down — an uncounted class is unknown, and
// treating it as an empty one would punish the clubs still learning to record.
// ---------------------------------------------------------------------------

const CLUB_NAMES = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))
const CLUB_LABEL = s => (s ? (CLUB_NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1)) : s)

const HOUR_LABELS = ['12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a',
  '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p']
const hourLabel = h => HOUR_LABELS[h] ?? String(h)

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pctOrDash = v => (v === null || v === undefined ? '—' : `${v}%`)

/** Sample size beside every average, so one class never reads like thirty. */
const withCount = r => `${fmtInt(r.classes)} class${r.classes === 1 ? '' : 'es'}`

export default function GroupX({ startDate, endDate, locationSlug }) {
  const [asTable, setAsTable] = useState(false)

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error, retrying } = useCancellableFetch(
    signal => api(`/analytics/group-x?${query}`, { cache: true, signal }),
    [query]
  )

  const s = data?.summary || {}
  const missed = data?.missed || []

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
          {data.notes?.coverage && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.coverage}</p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              {[
                { label: 'Classes Counted', value: fmtInt(s.classesRecorded) },
                { label: 'Total Attendance', value: fmtInt(s.totalAttendance) },
                { label: 'Avg per Class', value: s.avgHeadcount ?? '—' },
                { label: 'Avg Utilisation', value: pctOrDash(s.avgUtilisation) },
                { label: 'Over Capacity', value: fmtInt(s.overCapacity) },
                { label: 'Schedule Counted', value: pctOrDash(s.coverage), alarm: s.coverage !== null && s.coverage < 80 },
                { label: 'Class Types', value: fmtInt(s.classTypes), muted: true },
                { label: 'Instructors', value: fmtInt(s.instructors), muted: true },
              ].map(t => (
                <div key={t.label} className="px-5 py-4 text-center min-w-[120px] flex-1">
                  <p className={`text-xl font-bold tabular-nums ${
                    t.alarm ? 'text-wcs-red' : t.muted ? 'text-text-muted' : 'text-text-primary'
                  }`}>
                    {t.value}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
                </div>
              ))}
            </div>
          </div>

          {data.notes?.unscheduled && (
            <p className="text-[11px] text-text-muted px-1">{data.notes.unscheduled}</p>
          )}

          {s.classesRecorded === 0 ? (
            // An empty state that says what to do, rather than a page of zeroes
            // that reads like a broken report.
            <div className="bg-surface rounded-xl border border-border p-8 text-center">
              <p className="text-sm font-semibold text-text-primary">No headcounts recorded yet</p>
              <p className="text-xs text-text-muted mt-1 max-w-lg mx-auto">
                {s.classesScheduled > 0
                  ? `${fmtInt(s.classesScheduled)} classes were scheduled in this window. Every chart here fills in as staff record attendance from the portal.`
                  : 'No classes were scheduled in this window either, so there is nothing to count against.'}
              </p>
            </div>
          ) : asTable ? (
            <TableView classes={data.classes || []} />
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <ShareColumns
                  title="Attendance by Hour"
                  rows={(data.byHour || []).map(h => ({ ...h, hour: h.key }))}
                  valueKey="attendance" format="int"
                  labelFor={r => hourLabel(r.key)}
                  subtitle="total attendance"
                />
                <ShareColumns
                  title="Attendance by Day of Week"
                  rows={data.byDow || []}
                  valueKey="attendance" format="int"
                  labelFor={r => DOW_SHORT[r.key] ?? r.key}
                  subtitle="total attendance"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <RankedBars
                  title="Attendance by Class"
                  rows={data.byClass || []} labelKey="label" valueKey="attendance" format="int"
                  secondary={r => `${withCount(r)} · avg ${r.avgHeadcount ?? '—'}`}
                  emptyText="No classes counted."
                />
                <RankedBars
                  title="Attendance by Instructor"
                  rows={data.byInstructor || []} labelKey="label" valueKey="attendance" format="int"
                  secondary={r => `${withCount(r)} · avg ${r.avgHeadcount ?? '—'}`}
                  emptyText="No classes counted."
                />
              </div>

              <MonthlyTrend
                title="Attendance by Month"
                months={(data.byMonth || []).map(m => ({ month: m.key, attendance: m.attendance }))}
                valueKey="attendance" format="int" seriesName="groupx"
              />

              {(data.byClub || []).length > 1 && (
                <RankedBars
                  title="Attendance by Club"
                  rows={(data.byClub || []).map(c => ({ ...c, label: CLUB_LABEL(c.key) }))}
                  labelKey="label" valueKey="attendance" format="int"
                  secondary={r => `${withCount(r)} · avg ${r.avgHeadcount ?? '—'}`}
                  emptyText="No classes counted."
                />
              )}
            </>
          )}

          {missed.length > 0 && (
            <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
              <p className="text-xs font-bold text-text-primary mb-1">Scheduled, Not Counted</p>
              <p className="text-[11px] text-text-muted mb-2">
                These classes were on the schedule and have no headcount. They are excluded from
                every average above rather than counted as zero.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                    <th className="text-left font-semibold py-1.5 px-2" style={zebraColumn(0)}>Date</th>
                    <th className="text-left font-semibold py-1.5 px-2" style={zebraColumn(1)}>Class</th>
                    <th className="text-left font-semibold py-1.5 px-2" style={zebraColumn(2)}>Instructor</th>
                    <th className="text-left font-semibold py-1.5 px-2" style={zebraColumn(3)}>Club</th>
                    <th className="text-right font-semibold py-1.5 px-2" style={zebraColumn(4)}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {missed.slice(0, 60).map((m, i) => (
                    <tr key={`${m.slug}-${m.date}-${m.className}-${i}`} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5 px-2 text-text-primary" style={zebraColumn(0)}>{m.date}</td>
                      <td className="py-1.5 px-2 text-text-primary" style={zebraColumn(1)}>{m.className}</td>
                      <td className="py-1.5 px-2 text-text-muted" style={zebraColumn(2)}>{m.instructor}</td>
                      <td className="py-1.5 px-2 text-text-muted" style={zebraColumn(3)}>{CLUB_LABEL(m.slug)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(4)}>
                        {hourLabel(m.hour)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {missed.length > 60 && (
                <p className="text-[11px] text-text-muted mt-2">
                  Showing the 60 most recent of {fmtInt(missed.length)}.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TableView({ classes }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <p className="text-xs font-bold text-text-primary mb-2">Every Counted Class</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
            {['Date', 'Time', 'Class', 'Instructor', 'Club', 'Headcount', 'Capacity', 'Utilisation'].map((h, i) => (
              <th key={h}
                className={`py-1.5 px-2 font-semibold ${i >= 5 ? 'text-right' : 'text-left'}`}
                style={zebraColumn(i)}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classes.map((c, i) => (
            <tr key={`${c.slug}-${c.date}-${c.className}-${i}`} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 px-2 text-text-primary" style={zebraColumn(0)}>{c.date}</td>
              <td className="py-1.5 px-2 text-text-muted" style={zebraColumn(1)}>{hourLabel(c.hour)}</td>
              <td className="py-1.5 px-2 text-text-primary" style={zebraColumn(2)}>{c.className}</td>
              <td className="py-1.5 px-2 text-text-muted" style={zebraColumn(3)}>{c.instructor}</td>
              <td className="py-1.5 px-2 text-text-muted" style={zebraColumn(4)}>{CLUB_LABEL(c.slug)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-primary font-semibold" style={zebraColumn(5)}>
                {fmtInt(c.headcount)}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(6)}>
                {c.maxAttendees === null ? '—' : fmtInt(c.maxAttendees)}
              </td>
              {/* Over capacity is highlighted rather than hidden: it is the row
                  worth seeing. */}
              <td className="py-1.5 px-2 text-right tabular-nums" style={{
                ...zebraColumn(7),
                color: c.utilisation !== null && c.utilisation > 100 ? 'var(--color-wcs-red, #e34948)' : undefined,
              }}>
                {pctOrDash(c.utilisation)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {classes.length === 0 && (
        <p className="text-sm text-text-muted text-center py-8">No classes counted in this selection.</p>
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
