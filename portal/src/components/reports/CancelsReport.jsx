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

const STATUS_ORDER = ['Cancelled', 'Expired', 'Return For Collection']

function StatusBreakdown({ counts }) {
  const counts_ = counts || {}
  const total = Object.values(counts_).reduce((s, v) => s + (v || 0), 0)
  // Show in fixed order; tack on any unexpected statuses at the end
  const ordered = [
    ...STATUS_ORDER.filter(s => counts_[s] > 0),
    ...Object.keys(counts_).filter(s => !STATUS_ORDER.includes(s) && counts_[s] > 0),
  ]
  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">By Status</p>
      {total === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">No data</p>
      ) : (
        <div className="space-y-2">
          {ordered.map(status => {
            const count = counts_[status] || 0
            return (
              <div key={status} className="flex items-center gap-3 text-sm">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[status] || '#a8722c' }} />
                <span className="text-text-primary flex-1">{status}</span>
                <span className="font-semibold text-text-primary tabular-nums">{count}</span>
                <span className="text-xs text-text-muted tabular-nums">({Math.round((count / total) * 100)}%)</span>
              </div>
            )
          })}
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

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Members Cancelled</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.total_members ?? 0}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Agreements Cancelled</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.total_agreements ?? 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatusBreakdown counts={data.by_status} />
        <MembershipTypeTable title="Cancels by Membership Type" rows={data.by_membership_type} />
      </div>
    </div>
  )
}
