import { useMemo } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatCard, TrendPanel, BreakdownPanel } from './snapshotParts'
import PendingOutcomePanel from './PendingOutcomePanel'
import Drillable from './Drillable'

// The club-wide versions of the Trainer Snapshot sets: the same rows with no
// person filter. The Day One window is the APPOINTMENT date here, because
// analytics_pt_snapshot counts on scheduled_date — the opposite of the
// per-trainer card, which counts on the booking date. That difference is
// exactly why the set takes the date field rather than choosing one.
const DRILL = {
  dayOnes:            { set: 'day-ones', title: 'Day Ones' },
  dayOnesCompleted:   { set: 'day-ones', filter: 'completed', title: 'Completed Day Ones' },
  dayOnesNoShow:      { set: 'day-ones', filter: 'no-show', title: 'No-showed Day Ones' },
  dayOnesCancelled:   { set: 'day-ones', filter: 'cancelled', title: 'Cancelled Day Ones' },
  dayOnesPending:     { set: 'day-ones-pending', title: 'Pending outcomes' },
  dayOnesSold:        { set: 'day-ones', filter: 'sold', title: 'Day Ones sold' },
  dayOnesNoSale:      { set: 'day-ones', filter: 'no-sale', title: 'Day Ones not sold' },
  showRate:           { set: 'day-ones', filter: 'completed', title: 'Completed Day Ones' },
  closeRate:          { set: 'day-ones', filter: 'sold', title: 'Day Ones sold' },
  newClients:         { set: 'pt-sales', title: 'PT sales' },
  resigns:            { set: 'pt-sales', title: 'PT sales' },
  newValue:           { set: 'pt-sales', title: 'PT sold' },
  lostClients:        { set: 'pt-losses', title: 'Deactivations' },
  lostValue:          { set: 'pt-losses', title: 'Deactivations' },
}

// ---------------------------------------------------------------------------
// PT Snapshot — Analytics (admin only)
//
// The whole club's training, month to date, against the same window a month
// earlier. No person picker: this is the club, and the per-trainer version of
// it is Trainer Snapshot.
//
// The definitions are PT Health's, held in migration 148, so the two reports
// cannot drift on what a resign is. The loss side is recurring-service
// deactivations only, and every panel that shows a loss says so in its own
// title rather than in a footnote.
// ---------------------------------------------------------------------------

export default function PtSnapshot({ startDate, endDate, locationSlug }) {
  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/pt-snapshot?${query}`, { cache: true, signal }),
    [query]
  )

  const series = data?.series || []
  const months = series.map(s => s.month)
  const bd = data?.breakdown || {}

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
        <p className="text-base font-bold text-text-primary">Personal Training</p>
        <p className="text-[11px] text-text-muted">
          {data?.meta?.windowLabel}
          <span className="mx-1.5">vs</span>
          <span className="font-semibold text-text-primary">{data?.meta?.comparisonLabel}</span>
        </p>
      </div>

      {data && !data.hasActivity && (
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-sm text-text-muted">
            No Day Ones, PT sales or deactivations in the selected range.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        {(data?.stats || []).map(s => {
          const d = DRILL[s.key]
          const card = <StatCard stat={s} comparisonLabel={data?.meta?.comparisonLabel} />
          if (!d || !s.value) return <div key={s.key}>{card}</div>
          return (
            <Drillable
              key={s.key}
              set={d.set}
              title={d.title}
              params={{ start: startDate, end: endDate, clubs: locationSlug || 'all', filter: d.filter }}
            >
              {card}
            </Drillable>
          )
        })}
      </div>

      {/* What became of the intros. All counts of one population, one scale. */}
      <TrendPanel title="Day Ones" months={months} series={[
        line('Day Ones', 'dayOnes'),
        line('Completed', 'dayOnesCompleted'),
        line('Sold', 'dayOnesSold'),
      ]} />

      {/* The chase list behind the Pending Outcome card above. */}
      <PendingOutcomePanel pending={data?.pending} />

      <TrendPanel title="Close Rate" kind="rate" months={months} series={[
        line('Close Rate', 'closeRate'),
      ]} />

      <div className="grid md:grid-cols-2 gap-3">
        <BreakdownPanel
          title="Why They Did Not Buy"
          rows={bd.noSaleReasons}
          empty="No Day Ones closed out as a no sale in this range."
        />
        <BreakdownPanel
          title="What They Bought"
          rows={bd.soldTypes}
          empty="No Day Ones closed as a sale in this range."
        />
      </div>

      {/* New money against lost money. Both drawn positive — the net is the
          stat card above, because a chart that scales from zero cannot draw a
          negative month. */}
      <TrendPanel title="New Revenue and Lost Revenue (recurring deactivations only)" months={months} series={[
        line('New', 'newValue'),
        line('Lost', 'lostValue'),
      ]} />

      <TrendPanel title="New Revenue by Type" months={months} series={[
        line('Recurring', 'newRsValue'),
        line('Paid in Full', 'newPifValue'),
      ]} />

      <div className="grid md:grid-cols-3 gap-3">
        <BreakdownPanel
          title="New Business by Type"
          rows={bd.newTypes}
          showValue
          empty="No PT sales in this range."
        />
        <BreakdownPanel
          title="New Clients and Resigns"
          rows={bd.newClientTypes}
          showValue
          empty="No PT sales in this range."
        />
        <BreakdownPanel
          title="Why Recurring Services Ended"
          rows={bd.lostReasons}
          showValue
          empty="No recurring services deactivated in this range."
        />
      </div>
    </div>
  )
}
