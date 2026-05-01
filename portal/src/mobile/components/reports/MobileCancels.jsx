import React, { useState, useEffect } from 'react'
import { getCancelsReport } from '../../../lib/api'
import MobileLoading from '../MobileLoading'

const STATUS_COLORS = {
  'Cancelled': '#e53e3e',
  'Expired': '#d69e2e',
  'Return For Collection': '#805ad5',
}

function StatCard({ label, value }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-4 text-center">
      <p className="text-3xl font-bold text-text-primary">{value}</p>
      <p className="text-[11px] text-text-muted uppercase tracking-wide mt-1">{label}</p>
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="bg-surface/95 backdrop-blur-sm rounded-lg border border-border px-3 py-1.5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

function MembershipTypeTable({ title, rows }) {
  const list = rows || []
  const totalMembers = list.reduce((s, r) => s + (r.members || 0), 0)
  const totalAgreements = list.reduce((s, r) => s + (r.agreements || 0), 0)
  const max = list.reduce((m, r) => Math.max(m, r.members || 0), 0)

  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{title}</p>
      {list.length === 0 || totalMembers === 0 ? (
        <p className="text-sm text-text-muted py-2 text-center">No data</p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-[10px] font-semibold text-text-muted uppercase tracking-wide pb-1.5 border-b border-border mb-1.5">
            <span>Type</span>
            <span className="text-right whitespace-nowrap">Mem</span>
            <span className="text-right whitespace-nowrap pl-2">Agr</span>
          </div>
          <div className="space-y-1.5">
            {list.map(r => {
              const barPct = max > 0 ? ((r.members || 0) / max) * 100 : 0
              const pct = totalMembers > 0 ? ((r.members || 0) / totalMembers) * 100 : 0
              return (
                <div key={r.membership_type} className="space-y-0.5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs">
                    <span className="text-text-primary truncate" title={r.membership_type}>{r.membership_type}</span>
                    <span className="text-right tabular-nums whitespace-nowrap">
                      <span className="font-semibold text-text-primary">{r.members || 0}</span>
                      <span className="text-[10px] text-text-muted ml-1">({pct.toFixed(0)}%)</span>
                    </span>
                    <span className="text-right tabular-nums whitespace-nowrap pl-2 text-text-muted">{r.agreements || 0}</span>
                  </div>
                  <div className="relative h-1.5 bg-bg rounded-full border border-border overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-wcs-red/80" style={{ width: `${barPct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs pt-2 mt-2 border-t border-border font-semibold">
            <span className="text-text-primary">Total</span>
            <span className="text-right tabular-nums whitespace-nowrap text-text-primary">{totalMembers}</span>
            <span className="text-right tabular-nums whitespace-nowrap pl-2 text-text-primary">{totalAgreements}</span>
          </div>
        </>
      )}
    </div>
  )
}

function StatusBreakdown({ counts }) {
  const entries = Object.entries(counts || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((s, [, v]) => s + v, 0)
  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">By Status</p>
      {total === 0 ? (
        <p className="text-sm text-text-muted py-2 text-center">No data</p>
      ) : (
        <div className="space-y-2">
          {entries.map(([status, count]) => (
            <div key={status} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[status] || '#a8722c' }} />
              <span className="text-text-primary flex-1 truncate">{status}</span>
              <span className="font-semibold text-text-primary tabular-nums">{count}</span>
              <span className="text-text-muted tabular-nums">({Math.round((count / total) * 100)}%)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PendingList({ items, totalCount, totalAgreements }) {
  const list = items || []
  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Scheduled to Cancel</p>
        <p className="text-[11px] text-text-muted">
          <span className="font-semibold text-text-primary">{totalCount}</span> mem
          {' / '}
          <span className="font-semibold text-text-primary">{totalAgreements}</span> agr
        </p>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-text-muted py-2 text-center">No pending cancels</p>
      ) : (
        <div className="space-y-2">
          {list.map((p, i) => (
            <div key={`${p.agreement_number}-${i}`} className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary truncate">{p.name || '—'}</p>
                <p className="text-[11px] text-text-muted truncate">
                  {p.membership_type || '—'}
                  {p.sales_person_name ? ` · ${p.sales_person_name}` : ''}
                </p>
              </div>
              <p className="text-[11px] text-text-muted tabular-nums whitespace-nowrap">{p.scheduled_date || '—'}</p>
            </div>
          ))}
          {list.length === 200 && (
            <p className="text-[11px] text-text-muted text-center pt-2">Showing first 200 — refine the date range to see more.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function MobileCancels({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null); setLoading(true); setError(null)
    const params = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
    getCancelsReport(params)
      .then(res => { if (!cancelled) setData(res) })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load report') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, locationSlug])

  if (loading) return <MobileLoading variant="report" className="px-0 py-0" />
  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
      <p className="text-sm text-red-600">{error}</p>
    </div>
  )
  if (!data) return null

  return (
    <div className="space-y-4">
      <SectionHeader title="Cancellations" />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Members Cancelled" value={data.total_members ?? 0} />
        <StatCard label="Agreements Cancelled" value={data.total_agreements ?? 0} />
        <StatCard label="Pending Members" value={data.pending_cancel_count ?? 0} />
        <StatCard label="Pending Agreements" value={data.pending_cancel_agreements ?? 0} />
      </div>

      <StatusBreakdown counts={data.by_status} />

      <MembershipTypeTable title="Cancels by Membership Type" rows={data.by_membership_type} />

      <SectionHeader title="Scheduled" />

      <PendingList
        items={data.pending_cancels}
        totalCount={data.pending_cancel_count}
        totalAgreements={data.pending_cancel_agreements}
      />
    </div>
  )
}
