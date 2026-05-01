import React, { useState, useEffect } from 'react'
import { getCancelsReport } from '../../../lib/api'
import MobileLoading from '../MobileLoading'
import MembershipTypeTable from './MembershipTypeTable'

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

const STATUS_ORDER = ['Cancelled', 'Expired', 'Return For Collection']

function StatusBreakdown({ counts }) {
  const counts_ = counts || {}
  const total = Object.values(counts_).reduce((s, v) => s + (v || 0), 0)
  const ordered = [
    ...STATUS_ORDER.filter(s => counts_[s] > 0),
    ...Object.keys(counts_).filter(s => !STATUS_ORDER.includes(s) && counts_[s] > 0),
  ]
  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">By Status</p>
      {total === 0 ? (
        <p className="text-sm text-text-muted py-2 text-center">No data</p>
      ) : (
        <div className="space-y-2">
          {ordered.map(status => {
            const count = counts_[status] || 0
            return (
              <div key={status} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[status] || '#a8722c' }} />
                <span className="text-text-primary flex-1 truncate">{status}</span>
                <span className="font-semibold text-text-primary tabular-nums">{count}</span>
                <span className="text-text-muted tabular-nums">({Math.round((count / total) * 100)}%)</span>
              </div>
            )
          })}
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
      </div>

      <StatusBreakdown counts={data.by_status} />

      <MembershipTypeTable title="Cancels by Membership Type" rows={data.by_membership_type} />
    </div>
  )
}
