import { useMemo } from 'react'
import { api } from '../../lib/api'
import MembershipBreakdown from './MembershipBreakdown'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatCard, TrendPanel, groupStats, StatGroupHeading } from './snapshotParts'
import PendingOutcomePanel from './PendingOutcomePanel'
import Drillable from './Drillable'
import { drillFor } from './snapshotDrills'

// Club-wide, so no person filter anywhere here. Which set sits behind each
// stat is declared in ./snapshotDrills, shared with Daily Snapshot, because
// both reports draw the same STATS list from the same builder.

// ---------------------------------------------------------------------------
// Club Snapshot — Analytics (admin only)
//
// The whole club, month to date, against the same window a month earlier: the
// membership, the Day One funnel and the PT book of business in one card. No
// person picker; the per-salesperson version of this is Salesperson Snapshot.
//
// Counts come from Topline's window function and rates from the Salesperson
// Performance builder. The reason for splitting them that way is written out in
// auth/src/lib/clubSnapshot.js — briefly, the two sources count new
// members slightly differently, so only one of them is allowed to say so.
// ---------------------------------------------------------------------------

/**
 * A stat card, clickable where there are rows behind it.
 *
 * Pulled out because this card list is long enough that inlining the branch
 * would bury the grid it sits in. A stat with no entry in DRILL, or with no
 * value recorded, renders exactly as it did before.
 */
function StatCardOrDrill({ stat, comparisonLabel, startDate, endDate, locationSlug }) {
  const card = <StatCard stat={stat} comparisonLabel={comparisonLabel} />
  const drill = drillFor(stat)
  if (!drill) return card
  return (
    <Drillable
      set={drill.set}
      title={drill.title}
      params={{
        start: startDate, end: endDate, clubs: locationSlug || 'all',
        filter: drill.filter, window: drill.window,
      }}
    >
      {card}
    </Drillable>
  )
}

export default function ClubSnapshot({ startDate, endDate, locationSlug }) {
  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/club-snapshot?${query}`, { cache: true, signal }),
    [query]
  )

  const series = data?.series || []
  const months = series.map(s => s.month)

  const line = (label, key) => ({
    key: label, label, points: series.map(r => ({ month: r.month, value: r[key] })),
  })

  if (loading) return <DesktopLoading />

  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-base font-bold text-text-primary">Membership</p>
        <p className="text-[11px] text-text-muted">
          {data?.meta?.windowLabel}
          <span className="mx-1.5">vs</span>
          <span className="font-semibold text-text-primary">{data?.meta?.comparisonLabel}</span>
        </p>
      </div>

      {data && !data.hasActivity && (
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-sm text-text-muted">No membership activity in the selected range.</p>
        </div>
      )}

      {/* One grid per section rather than one grid of everything: twenty-seven
          cards in a single run gives a reader nothing to navigate by. The
          sections and their order come from the payload, so this report and
          Daily Snapshot cannot disagree about what counts as a PT number. */}
      <div className="space-y-3">
        {groupStats(data?.stats, data?.statGroups).map(g => (
          <div key={g.key} className="space-y-1.5">
            <StatGroupHeading label={g.label} />
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
              {g.stats.map(s => (
                <StatCardOrDrill key={s.key} stat={s}
                  comparisonLabel={data?.meta?.comparisonLabel}
                  startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <MembershipBreakdown
        rows={data?.membershipByCategory}
        comparisonLabel={data?.meta?.comparisonLabel}
      />

      {/* Both drawn positive: the chart scales from zero, so the net is read
          from the stat card rather than from a line crossing an axis. */}
      <TrendPanel title="Joined and Left" months={months} series={[
        line('Joined', 'newMembers'),
        line('Left', 'lostMembers'),
      ]} />

      {/* Counts of one population, so they belong on one scale. The first line
          is Day Ones DATED in each month, not booked in it — calling it
          "Booked" here contradicted the stat card above and was simply wrong. */}
      <TrendPanel title="Day Ones on Calendar" months={months} series={[
        line('On Calendar', 'dayOnes'),
        line('Completed', 'dayOnesCompleted'),
        line('Sold', 'dayOnesSold'),
      ]} />

      {/* A rate never shares a panel with a count: on one axis a percentage
          and a headcount flatten whichever is smaller. */}
      {/* Who is sitting on the un-closed intros behind the card above. */}
      <PendingOutcomePanel pending={data?.pending} title="Day Ones Pending Outcome" />

      <TrendPanel title="Day One Close Rate" kind="rate" months={months} series={[
        line('Close Rate', 'dayOneCloseRate'),
      ]} />

      {/* The VALUE OF PT SOLD against PT lost. Both positive; the net is on the
          card above. Lost is recurring deactivations only. */}
      <TrendPanel title="PT Sold and PT Lost (recurring deactivations only)" months={months} series={[
        line('New PT', 'newPtRevenue'),
        line('Lost PT', 'lostPtRevenue'),
      ]} />

      <TrendPanel title="Revenue Collected" months={months} series={[
        line('Revenue', 'revenue'),
        line('PT Revenue', 'ptRevenue'),
        line('New Dues', 'newDues'),
      ]} />

      <TrendPanel title="Check-ins" months={months} series={[
        line('Check-ins', 'checkins'),
      ]} />
    </div>
  )
}
