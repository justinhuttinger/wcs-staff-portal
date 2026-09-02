import { fmtInt } from './chartPalette'
import { BreakdownPanel } from './snapshotParts'

// ---------------------------------------------------------------------------
// Pending Outcome — Day Ones whose date has passed with nobody closing them out.
//
// Shared by every Analytics report that shows the metric, so the definition and
// the wording are written once. Six copies of "passed, no outcome" would be six
// chances to word it as something subtly different from what the SQL counts.
//
// The panel is a CHASE LIST, not a statistic. The count is already on a stat
// card; what this adds is which trainer is sitting on them, which member, and
// how long it has been. A number nobody can act on is not the point.
//
// COUNTED ON THE APPOINTMENT DATE. Several of the reports around it key their
// other Day One counts on the booking date, so the subtitle says so rather than
// leaving the reader to assume the two agree.
// ---------------------------------------------------------------------------

/** The one-line explanation, so all six reports say the same thing. */
export const PENDING_HELP =
  'Day Ones whose date has passed with no outcome recorded. Counted on the appointment date; today is never included.'

function DaysBadge({ days }) {
  // Three bands rather than a gradient: a week is "chase it", a month is "this
  // one is not coming back". A continuous scale would just be decoration.
  const tone = days >= 30
    ? 'bg-wcs-red/15 text-wcs-red'
    : days >= 7
      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
      : 'bg-bg text-text-muted'
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums ${tone}`}>
      {days}d
    </span>
  )
}

/**
 * @param pending  the `pending` object from the report payload:
 *                 { total, oldestDays, byTrainer, list }
 * @param groupBy  'trainer' (who ran it) or 'bookedBy' (who put it in the
 *                 diary). Trainer is the default because the outcome form is
 *                 the trainer's to submit.
 */
export default function PendingOutcomePanel({ pending, title = 'Pending Outcome', groupBy = 'trainer' }) {
  if (!pending) return null

  const total = pending.total || 0
  const rows = (groupBy === 'bookedBy' ? pending.byBooker : pending.byTrainer) || []
  const list = pending.list || []

  if (total === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-3">
        <p className="text-xs font-bold text-text-primary mb-1">{title}</p>
        <p className="text-xs text-text-muted">
          Every Day One in this range has been closed out. Nothing to chase.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-text-primary">{title}</p>
          <p className="text-[11px] text-text-muted mt-0.5">{PENDING_HELP}</p>
        </div>
        <p className="text-[11px] text-text-muted">
          <span className="text-lg font-bold text-wcs-red tabular-nums align-middle">{fmtInt(total)}</span>
          <span className="ml-1.5 align-middle">outstanding</span>
          {pending.oldestDays > 0 && (
            <span className="ml-2 align-middle">
              oldest <span className="font-semibold text-text-primary tabular-nums">{pending.oldestDays} days</span>
            </span>
          )}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <BreakdownPanel
          title={groupBy === 'bookedBy' ? 'Outstanding by Booker' : 'Outstanding by Trainer'}
          rows={rows.map(r => ({ label: r.name, count: r.count }))}
          empty="Nobody is named on these."
        />

        <div className="bg-surface rounded-xl border border-border p-3">
          <div className="flex items-baseline justify-between mb-2 gap-3">
            <p className="text-xs font-bold text-text-primary">Oldest First</p>
            {list.length < total && (
              <p className="text-[11px] text-text-muted tabular-nums">
                {fmtInt(list.length)} of {fmtInt(total)}
              </p>
            )}
          </div>
          {/* Its own scroller: a long chase list must not push the page wide. */}
          <div className="max-h-64 overflow-y-auto -mx-1 px-1">
            <ul className="space-y-1.5">
              {list.map(r => (
                <li key={r.id} className="flex items-center gap-2">
                  <DaysBadge days={r.daysOverdue} />
                  <span className="text-[11px] text-text-primary truncate flex-1" title={r.member || ''}>
                    {r.member || 'Unnamed member'}
                  </span>
                  <span className="text-[11px] text-text-muted truncate w-28 text-right" title={r.trainer || ''}>
                    {r.trainer || 'Unassigned'}
                  </span>
                  <span className="text-[11px] text-text-muted tabular-nums w-20 text-right">
                    {r.date}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
