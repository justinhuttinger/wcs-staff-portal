import { useState, useEffect, useRef } from 'react'
import { getCancelsReport } from '../../lib/api'

const STATUS_COLORS = {
  'Cancelled': '#e53e3e',
  'Expired': '#d69e2e',
  'Return For Collection': '#805ad5',
}

function MembershipTypeTable({ title, rows }) {
  const list = rows || []
  const totalMembers = list.reduce((s, r) => s + (r.members || 0), 0)
  const totalAgreements = list.reduce((s, r) => s + (r.agreements || 0), 0)
  const max = list.reduce((m, r) => Math.max(m, r.members || 0), 0)

  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</p>
      {list.length === 0 || totalMembers === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">No data</p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] items-center gap-3 text-[11px] font-semibold text-text-muted uppercase tracking-wide pb-2 border-b border-border mb-2">
            <span>Type</span>
            <span></span>
            <span className="text-right whitespace-nowrap">Members</span>
            <span className="text-right whitespace-nowrap pl-3">Agreements</span>
          </div>
          <div className="space-y-2">
            {list.map(r => {
              const barPct = max > 0 ? ((r.members || 0) / max) * 100 : 0
              const pct = totalMembers > 0 ? ((r.members || 0) / totalMembers) * 100 : 0
              return (
                <div key={r.membership_type} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] items-center gap-3 text-sm">
                  <span className="text-text-primary truncate" title={r.membership_type}>{r.membership_type}</span>
                  <div className="relative h-5 bg-bg rounded-md border border-border overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-wcs-red/80" style={{ width: `${barPct}%` }} />
                  </div>
                  <span className="text-right tabular-nums whitespace-nowrap">
                    <span className="font-semibold text-text-primary">{r.members || 0}</span>
                    <span className="text-xs text-text-muted ml-1">({pct.toFixed(1)}%)</span>
                  </span>
                  <span className="text-right tabular-nums whitespace-nowrap pl-3 text-text-muted">{r.agreements || 0}</span>
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] items-center gap-3 text-sm pt-3 mt-2 border-t border-border font-semibold">
            <span className="text-text-primary">Total</span>
            <span></span>
            <span className="text-right tabular-nums whitespace-nowrap text-text-primary">{totalMembers}</span>
            <span className="text-right tabular-nums whitespace-nowrap pl-3 text-text-primary">{totalAgreements}</span>
          </div>
        </>
      )}
    </div>
  )
}

function StatusBreakdown({ counts }) {
  const entries = Object.entries(counts || {}).filter(([, v]) => v > 0)
  const total = entries.reduce((s, [, v]) => s + v, 0)
  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">By Status</p>
      {total === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">No data</p>
      ) : (
        <div className="space-y-2">
          {entries.sort((a, b) => b[1] - a[1]).map(([status, count]) => (
            <div key={status} className="flex items-center gap-3 text-sm">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[status] || '#a8722c' }} />
              <span className="text-text-primary flex-1">{status}</span>
              <span className="font-semibold text-text-primary tabular-nums">{count}</span>
              <span className="text-xs text-text-muted tabular-nums">({Math.round((count / total) * 100)}%)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PendingCancelTable({ items, totalCount, totalAgreements }) {
  const list = items || []
  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Scheduled to Cancel (Pending)</p>
        <p className="text-xs text-text-muted">
          <span className="font-semibold text-text-primary">{totalCount}</span> members
          {' / '}
          <span className="font-semibold text-text-primary">{totalAgreements}</span> agreements
        </p>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">No pending cancels</p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold text-text-muted uppercase tracking-wide border-b border-border">
                <th className="text-left px-2 py-2">Member</th>
                <th className="text-left px-2 py-2">Type</th>
                <th className="text-left px-2 py-2">Agreement</th>
                <th className="text-left px-2 py-2">Sales Person</th>
                <th className="text-right px-2 py-2">Scheduled Date</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p, i) => (
                <tr key={`${p.agreement_number}-${i}`} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 text-text-primary">
                    <div className="font-medium">{p.name || <em className="opacity-60">—</em>}</div>
                    {p.email && <div className="text-xs text-text-muted truncate max-w-[200px]">{p.email}</div>}
                  </td>
                  <td className="px-2 py-2 text-text-muted">{p.membership_type || '—'}</td>
                  <td className="px-2 py-2 text-text-muted tabular-nums">{p.agreement_number || '—'}</td>
                  <td className="px-2 py-2 text-text-muted">{p.sales_person_name || '—'}</td>
                  <td className="px-2 py-2 text-right text-text-muted tabular-nums">{p.scheduled_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 200 && (
            <p className="text-xs text-text-muted text-center pt-3">Showing first 200 — refine the date range to see more.</p>
          )}
        </div>
      )}
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="bg-surface/95 backdrop-blur-sm rounded-lg border border-border px-3 py-1.5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

export default function CancelsReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  useEffect(() => {
    const id = ++requestRef.current
    setData(null); setLoading(true); setError('')
    const params = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
    getCancelsReport(params)
      .then(res => { if (id === requestRef.current) { setData(res); setLoading(false) } })
      .catch(err => { if (id === requestRef.current) { setError(err.message); setLoading(false) } })
  }, [startDate, endDate, locationSlug])

  if (loading) return <p className="loading-card mx-auto block my-6">Loading cancels...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-6">
      <SectionHeader title="Cancellations" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Members Cancelled</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.total_members ?? 0}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Agreements Cancelled</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.total_agreements ?? 0}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Pending Members</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.pending_cancel_count ?? 0}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Pending Agreements</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.pending_cancel_agreements ?? 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatusBreakdown counts={data.by_status} />
        <MembershipTypeTable title="Cancels by Membership Type" rows={data.by_membership_type} />
      </div>

      <SectionHeader title="Scheduled" />

      <PendingCancelTable
        items={data.pending_cancels}
        totalCount={data.pending_cancel_count}
        totalAgreements={data.pending_cancel_agreements}
      />
    </div>
  )
}
