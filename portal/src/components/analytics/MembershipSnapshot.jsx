import { useMemo } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatCard, TrendPanel } from './snapshotParts'

// ---------------------------------------------------------------------------
// Membership Snapshot — Analytics (admin only)
//
// The whole club, month to date, against the same window a month earlier. No
// person picker: the per-salesperson version of this is Salesperson Snapshot.
//
// Counts come from Topline's window function and rates from the Salesperson
// Performance builder. The reason for splitting them that way is written out in
// auth/src/lib/clubMembershipSnapshot.js — briefly, the two sources count new
// members slightly differently, so only one of them is allowed to say so.
// ---------------------------------------------------------------------------

export default function MembershipSnapshot({ startDate, endDate, locationSlug }) {
  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/membership-snapshot?${query}`, { cache: true, signal }),
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
          <StatCard key={s.key} stat={s} comparisonLabel={data?.meta?.comparisonLabel} />
        ))}
      </div>

      {/* Both drawn positive: the chart scales from zero, so the net is read
          from the stat card rather than from a line crossing an axis. */}
      <TrendPanel title="Joined and Left" months={months} series={[
        line('Joined', 'newMembers'),
        line('Left', 'lostMembers'),
      ]} />

      {/* The stock on its own scale. Putting 17,000 members beside 500 joins
          would flatten the joins into the axis. */}
      <TrendPanel title="Total Members" months={months} series={[
        line('Members', 'totalMembers'),
      ]} />

      <TrendPanel title="Revenue" months={months} series={[
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
