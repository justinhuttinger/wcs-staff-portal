import { useMemo } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatCard, TrendPanel } from './snapshotParts'
import PendingOutcomePanel from './PendingOutcomePanel'
import Drillable from './Drillable'

// Club-wide, so no person filter anywhere here.
//
// Day Ones Booked counts on the BOOKING date (it comes from buildReport) while
// Day Ones on Calendar counts on the appointment date (it comes from
// analytics_pt_snapshot). Two cards on one screen, two different cohorts —
// which is why each names its own window rather than sharing one.
//
// Members, Net Members, Net PT Revenue and the tour/VIP rates that have no
// list of their own are deliberately absent: a stock or a difference of two
// populations has no single set of rows behind it.
const DRILL = {
  newMembers:         { set: 'new-members', title: 'Members joined' },
  lostMembers:        { set: 'lost-members', title: 'Members lost' },
  newDues:            { set: 'new-members', title: 'Members joined' },
  pctOnAch:           { set: 'new-members', filter: 'ach', title: 'Joined on ACH' },
  avgNewDuesDraft:    { set: 'new-members', title: 'Members joined' },
  revenue:            { set: 'revenue', title: 'Revenue collected' },
  ptRevenue:          { set: 'revenue', filter: 'pt', title: 'PT revenue collected' },
  dayOneBookCount:    { set: 'day-ones', window: 'booked', title: 'Day Ones booked' },
  dayOneBookPct:      { set: 'day-ones', window: 'booked', title: 'Day Ones booked' },
  vipCount:           { set: 'vips', title: 'VIP referrals' },
  vipPct:             { set: 'vips', title: 'VIP referrals' },
  toursGiven:         { set: 'tours', title: 'Tours given' },
  tourConversionRate: { set: 'tours', title: 'Tours given' },
  dayOnes:            { set: 'day-ones', title: 'Day Ones' },
  dayOneShowRate:     { set: 'day-ones', filter: 'completed', title: 'Completed Day Ones' },
  dayOneCloseRate:    { set: 'day-ones', filter: 'sold', title: 'Day Ones sold' },
  dayOnesPending:     { set: 'day-ones-pending', title: 'Pending outcomes' },
  newPtRevenue:       { set: 'pt-sales', title: 'PT sold' },
  lostPtRevenue:      { set: 'pt-losses', title: 'Deactivations' },
}

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
function StatCardOrDrill({ stat, drill, comparisonLabel, startDate, endDate, locationSlug }) {
  const card = <StatCard stat={stat} comparisonLabel={comparisonLabel} />
  if (!drill || !stat.value) return card
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

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        {(data?.stats || []).map(s => (
          <StatCardOrDrill key={s.key} stat={s} drill={DRILL[s.key]}
            comparisonLabel={data?.meta?.comparisonLabel}
            startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
        ))}
      </div>

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
