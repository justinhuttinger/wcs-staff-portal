import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { StatCard, TrendPanel, BreakdownPanel } from './snapshotParts'
import Drillable from './Drillable'
import { fmtInt } from './chartPalette'

// ---------------------------------------------------------------------------
// Attrition Analysis — who left, and what that says.
//
// The old Reporting view's Cancels report, rebuilt in the Analytics style:
// stat cards, a thirteen-month trend, breakdowns, and every figure clicking
// through to the members behind it.
//
// THE INSURANCE SPLIT IS THE POINT. A2 and Active and Fit plans cancel in bulk
// whenever a provider changes terms, so a month can look catastrophic on a
// single total and unremarkable once the two are separated. Every total here is
// stated with its split rather than leaving the reader to find it.
// ---------------------------------------------------------------------------

// Which rows sit behind each figure. Cancels are keyed on the date the
// membership ENDED, which is what the report counts on.
const DRILL = {
  total:      { set: 'cancels', title: 'Members lost' },
  agreements: { set: 'cancels', title: 'Members lost' },
  membership: { set: 'cancels', filter: 'membership', title: 'Paying memberships lost' },
  insurance:  { set: 'cancels', filter: 'insurance', title: 'Insurance plans lost' },
  avgTenure:  { set: 'cancels', title: 'Members lost' },
  pending:    { set: 'pending-cancels', title: 'Scheduled to cancel' },
}

export default function AttritionAnalysis({ startDate, endDate, locationSlug }) {
  const [exclusion, setExclusion] = useState('exclude')

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all', exclusion })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug, exclusion])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/attrition-analysis?${query}`, { cache: true, signal }),
    [query]
  )

  const series = data?.series || []
  const months = series.map(s => s.month)
  const line = (label, key) => ({
    key: label, label, points: series.map(r => ({ month: r.month, value: r[key] })),
  })

  const params = { start: startDate, end: endDate, clubs: locationSlug || 'all' }

  if (loading) return <DesktopLoading variant="report" />

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
      <ExclusionToolbar value={exclusion} onChange={setExclusion} />

      <div className="bg-surface rounded-xl border border-border px-4 py-3">
        <p className="text-base font-bold text-text-primary">Attrition</p>
        <p className="text-[11px] text-text-muted mt-0.5">{data?.meta?.windowLabel}</p>
      </div>

      {data && !data.hasActivity && (
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-sm text-text-muted">Nobody left in this range, and nobody is queued to.</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        {(data?.stats || []).map(s => {
          const d = DRILL[s.key]
          const card = <StatCard stat={s} />
          if (!d || !s.value) return <div key={s.key}>{card}</div>
          return (
            <Drillable key={s.key} set={d.set} title={d.title}
              params={{ ...params, filter: d.filter }}>
              {card}
            </Drillable>
          )
        })}
      </div>

      {/* Paying memberships and insurance plans on one scale, because the whole
          question is which of the two moved. */}
      <TrendPanel title="Members Lost" months={months} series={[
        line('All', 'count'),
        line('Paying Memberships', 'membership'),
        line('Insurance Plans', 'insurance'),
      ]} />

      <div className="grid md:grid-cols-2 gap-3">
        <BreakdownPanel
          title="How the Membership Ended"
          rows={data?.breakdowns?.byStatus}
          empty="Nothing ended in this range."
        />
        <BreakdownPanel
          title="How Long They Stayed"
          rows={data?.breakdowns?.byTenure}
          empty="No tenure on record for these."
        />
        <BreakdownPanel
          title="What They Were On"
          rows={data?.breakdowns?.byType}
          empty="Nothing ended in this range."
        />
        {/* Paying memberships only: an insurance cancellation is the provider's
            decision, not the salesperson's outcome. */}
        <BreakdownPanel
          title="Who Sold the Membership"
          rows={data?.breakdowns?.bySalesperson}
          empty="No salesperson on record for these."
        />
      </div>

      <PendingQueue rows={data?.pending} params={params} />

      {data?.note && (
        <p className="text-[11px] text-text-muted px-1 leading-snug">{data.note}</p>
      )}
    </div>
  )
}

/**
 * What is already scheduled to end.
 *
 * A queue rather than a statistic: these have not cancelled yet, which is the
 * only window in which anything can be done about them.
 */
function PendingQueue({ rows, params }) {
  const list = rows || []
  return (
    <div className="bg-surface rounded-xl border border-border">
      <div className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-border">
        <p className="text-sm font-bold text-text-primary">Scheduled to Cancel</p>
        <Drillable set="pending-cancels" title="Scheduled to cancel" params={params}
          className="w-auto">
          <span className="text-[11px] text-text-muted tabular-nums">
            {fmtInt(list.length)} queued
          </span>
        </Drillable>
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-text-muted">
          Nobody is scheduled to cancel.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                <th className="text-left font-semibold px-4 py-2">Member</th>
                <th className="text-left font-semibold px-3 py-2">Membership</th>
                <th className="text-right font-semibold px-3 py-2">Ends</th>
                <th className="text-left font-semibold px-3 py-2">Sold By</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 50).map((r, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 text-text-primary">{r.member}</td>
                  <td className="px-3 py-2 text-text-muted">{r.type}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-primary whitespace-nowrap">
                    {r.effective || '—'}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{r.salesperson}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > 50 && (
            <p className="px-4 py-2 text-[11px] text-text-muted border-t border-border">
              Showing the 50 soonest. Open the card above for the rest.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ExclusionToolbar({ value, onChange }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
      Member Count
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium"
      >
        <option value="exclude">Exclude</option>
        <option value="include">Include</option>
      </select>
    </label>,
    slot
  )
}
