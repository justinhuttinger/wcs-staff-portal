import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { zebra, HOVER_TINT } from './tableTints'

// ---------------------------------------------------------------------------
// Average Monthly Dues — Analytics (corporate+)
//
// Total monthly dues over the members paying them. The two numbers behind the
// average are shown beside it rather than left implicit: an average alone
// cannot tell you whether it moved because pricing changed or because the base
// did, and those are opposite problems.
//
// A LIVE SNAPSHOT. abc_members carries what a member is billed NOW and no
// history of it, so there is no date range to honour — the report is registered
// with dates: false rather than accepting one it would quietly ignore.
// ---------------------------------------------------------------------------

const VIEWS = [
  { key: 'club', label: 'By Club' },
  { key: 'membership_type', label: 'By Membership Type' },
]

const fmtMoney = v => (v === null || v === undefined
  ? 'N/A'
  : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const fmtMoney0 = v => (v === null || v === undefined ? 'N/A' : `$${Math.round(Number(v)).toLocaleString()}`)
const fmtInt = v => (v === null || v === undefined ? 'N/A' : Number(v).toLocaleString())

export default function AverageDues({ locationSlug }) {
  const [viewBy, setViewBy] = useState('club')

  const query = useMemo(() => new URLSearchParams({
    clubs: locationSlug || 'all',
    viewBy,
  }).toString(), [locationSlug, viewBy])

  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/average-dues?${query}`, { cache: true, signal }),
    [query]
  )

  const rows = data?.rows || []
  // Scaled to the biggest average on screen rather than to zero, so the
  // differences between clubs are readable: every club sits between $70 and $90
  // and a zero-based bar would make them look identical.
  const maxAvg = useMemo(() => Math.max(0, ...rows.map(r => r.avgDues || 0)), [rows])

  if (loading) return <DesktopLoading variant="report" />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }

  const s = data?.summary || {}

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border p-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {VIEWS.map(v => (
            <button
              key={v.key}
              type="button"
              onClick={() => setViewBy(v.key)}
              aria-pressed={viewBy === v.key}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                viewBy === v.key
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-bg text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-muted ml-auto max-w-[44rem] text-right">
          What the base is billed today, not what was collected. Dues-category members only;
          bi-weekly and annual charges are converted to a month before averaging.
        </p>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <div className="flex min-w-max divide-x divide-border">
          <div className="px-5 py-4 text-center min-w-[150px] flex-1">
            <p className="text-2xl font-bold text-text-primary">{fmtMoney(s.avgDues)}</p>
            <p className="text-[11px] text-text-muted mt-0.5">Average Monthly Dues</p>
          </div>
          <div className="px-5 py-4 text-center min-w-[150px] flex-1">
            <p className="text-2xl font-bold text-text-primary">{fmtMoney0(s.totalDues)}</p>
            <p className="text-[11px] text-text-muted mt-0.5">Total Monthly Dues</p>
          </div>
          <div className="px-5 py-4 text-center min-w-[150px] flex-1">
            <p className="text-2xl font-bold text-text-primary">{fmtInt(s.payingMembers)}</p>
            <p className="text-[11px] text-text-muted mt-0.5">Dues-Paying Members</p>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center">
          <p className="text-sm text-text-muted">No dues-paying members in this selection.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border">
          <div className="overflow-auto max-h-[calc(100vh-20rem)]">
            <table className="min-w-max w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 top-0 z-30 bg-surface text-left font-semibold text-text-primary px-4 py-3 min-w-[220px] border-b border-border">
                    {viewBy === 'club' ? 'Club' : 'Membership Type'}
                  </th>
                  <th scope="col" className={`sticky top-0 z-20 text-left font-semibold text-text-muted px-3 py-3 text-xs min-w-[220px] border-b border-border ${zebra(0)}`}>
                    Average Monthly Dues
                  </th>
                  <th scope="col" className={`sticky top-0 z-20 text-right font-semibold text-text-muted px-3 py-3 text-xs min-w-[150px] border-b border-border ${zebra(1)}`}>
                    Total Monthly Dues
                  </th>
                  <th scope="col" className={`sticky top-0 z-20 text-right font-semibold text-text-muted px-3 py-3 text-xs min-w-[140px] border-b border-border ${zebra(2)}`}>
                    Paying Members
                  </th>
                  <th scope="col" className="sticky top-0 z-20 text-right font-semibold text-text-muted px-3 py-3 text-xs min-w-[130px] border-b border-border">
                    Paid Up Front
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const width = r.avgDues && maxAvg > 0
                    ? Math.max(2, Math.round((r.avgDues / maxAvg) * 100))
                    : 0
                  return (
                    <tr key={r.key} className="group">
                      <td className={`sticky left-0 z-10 bg-surface ${HOVER_TINT} px-4 py-2 whitespace-nowrap border-b border-border/60 text-text-primary`}>
                        {r.label}
                      </td>
                      <td className={`px-3 py-2 border-b border-border/60 ${zebra(0)} ${HOVER_TINT}`}>
                        <div className="flex items-center gap-2 h-5">
                          <div className="relative flex-1 h-4 min-w-[60px]">
                            {r.avgDues !== null && (
                              <div className="absolute inset-y-0 left-0 rounded-sm bg-teal-500/70" style={{ width: `${width}%` }} />
                            )}
                          </div>
                          <span className={`text-xs tabular-nums w-16 text-right flex-shrink-0 ${
                            r.avgDues === null ? 'text-text-muted' : 'text-text-primary font-semibold'
                          }`}>
                            {fmtMoney(r.avgDues)}
                          </span>
                        </div>
                      </td>
                      <td className={`px-3 py-2 border-b border-border/60 text-right ${zebra(1)} ${HOVER_TINT}`}>
                        <span className="text-xs tabular-nums text-text-primary">{fmtMoney0(r.totalDues)}</span>
                      </td>
                      <td className={`px-3 py-2 border-b border-border/60 text-right ${zebra(2)} ${HOVER_TINT}`}>
                        <span className="text-xs tabular-nums text-text-primary">{fmtInt(r.payingMembers)}</span>
                      </td>
                      <td className={`px-3 py-2 border-b border-border/60 text-right ${HOVER_TINT}`}>
                        <span className="text-xs tabular-nums text-text-muted">{fmtInt(r.noCharge)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Who was left out and why. An average is only as trustworthy as its
          denominator, so the denominator is stated rather than assumed. */}
      <div className="text-[11px] text-text-muted px-1 space-y-1">
        <p>
          As of {data?.meta?.asOf}. {fmtInt(data?.meta?.duesMembers)} active members are on a
          dues membership; {fmtInt(s.payingMembers)} of them carry a recurring charge and are
          what the average divides by.
          {s.noCharge > 0 && ` ${fmtInt(s.noCharge)} paid up front and have no recurring charge, so they are counted separately rather than averaged in as zero.`}
        </p>
        {s.unknownFrequency > 0 && (
          <p>
            {fmtInt(s.unknownFrequency)} carry a charge with no billing frequency recorded — a
            paid-up-front sum rather than a monthly rate — so there is no honest way to express
            them as a month and they are left out.
          </p>
        )}
        {data?.meta?.unmappedTypes > 0 && (
          <p>
            {fmtInt(data.meta.unmappedTypes)} active members are on a membership type nobody has
            mapped to a category yet, so they count as neither dues nor insurance. Map them under
            Admin &rsaquo; Membership Categories.
          </p>
        )}
      </div>
    </div>
  )
}
