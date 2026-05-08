import { useState, useEffect, useRef } from 'react'
import { getCancelsReport } from '../../lib/api'
import MembershipTypeTable from './MembershipTypeTable'

const STATUS_COLORS = {
  'Cancelled': '#e53e3e',
  'Expired': '#d69e2e',
  'Return For Collection': '#805ad5',
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

const SAVE_OPTION_LABELS = {
  MONETARY: 'Dues Discount',
  POS: 'POS Items',
  FREEZE: 'Freeze',
  LOCATION: 'Club Transfer',
  MEMBERSHIP: 'Plan Upgrade',
  CREDIT: 'Account Credit',
  MANUAL: 'Manual / Custom',
}

const SAVE_OPTION_COLORS = {
  MONETARY: '#3b82f6',
  POS: '#10b981',
  FREEZE: '#06b6d4',
  LOCATION: '#a855f7',
  MEMBERSHIP: '#f59e0b',
  CREDIT: '#22c55e',
  MANUAL: '#6b7280',
}

function CountedList({ rows, getLabel, getColor, emptyText = 'No data' }) {
  const total = rows.reduce((s, r) => s + r.count, 0)
  if (total === 0) {
    return <p className="text-sm text-text-muted py-4 text-center">{emptyText}</p>
  }
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const label = getLabel ? getLabel(r) : r.reason || r.subtype
        const color = getColor ? getColor(r) : '#a8722c'
        return (
          <div key={i} className="flex items-center gap-3 text-sm">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-text-primary flex-1 truncate" title={label}>{label}</span>
            <span className="font-semibold text-text-primary tabular-nums">{r.count}</span>
            <span className="text-xs text-text-muted tabular-nums">({Math.round((r.count / total) * 100)}%)</span>
          </div>
        )
      })}
    </div>
  )
}

function Click2SaveSection({ saveCount, cancelReasons, saveOptions, error }) {
  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        Click2Save data unavailable: {error}
      </div>
    )
  }
  const reasons = cancelReasons || []
  const options = saveOptions || []
  const hasAny = (saveCount || 0) > 0 || reasons.length > 0 || options.length > 0
  if (!hasAny) {
    return (
      <p className="text-sm text-text-muted py-4 text-center">No Click2Save events in this date range.</p>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Members Saved</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{saveCount ?? 0}</p>
          <p className="text-[11px] text-text-muted mt-1">Accepted a save offer instead of cancelling</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Cancel Reasons Captured</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{reasons.reduce((s, r) => s + r.count, 0)}</p>
          <p className="text-[11px] text-text-muted mt-1">From Click2Save webhook events</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface rounded-xl border border-border p-6">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Reasons for Cancel</p>
          <CountedList
            rows={reasons}
            getLabel={r => r.reason}
            getColor={() => '#e53e3e'}
            emptyText="No reasons captured in this date range"
          />
        </div>
        <div className="bg-surface rounded-xl border border-border p-6">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Save Option Chosen</p>
          <CountedList
            rows={options}
            getLabel={o => SAVE_OPTION_LABELS[o.subtype] || o.subtype}
            getColor={o => SAVE_OPTION_COLORS[o.subtype] || '#a8722c'}
            emptyText="No save offers accepted in this date range"
          />
        </div>
      </div>
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

      <SectionHeader title="Click2Save" />
      <Click2SaveSection
        saveCount={data.c2s_save_count}
        cancelReasons={data.c2s_cancel_reasons}
        saveOptions={data.c2s_save_options}
        error={data.c2s_error}
      />
    </div>
  )
}
