import { useState } from 'react'
import { getCancelsReport } from '../../lib/api'
import MembershipTypeTable from './MembershipTypeTable'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatBlock, StatCell, ReportBlock } from './StatBlock'

const STATUS_COLORS = {
  'Cancelled': '#e53e3e',
  'Expired': '#d69e2e',
  'Return For Collection': '#805ad5',
}

const STATUS_ORDER = ['Cancelled', 'Expired', 'Return For Collection']

function StatusBreakdown({ counts, flush = false }) {
  const counts_ = counts || {}
  const total = Object.values(counts_).reduce((s, v) => s + (v || 0), 0)
  // Show in fixed order; tack on any unexpected statuses at the end
  const ordered = [
    ...STATUS_ORDER.filter(s => counts_[s] > 0),
    ...Object.keys(counts_).filter(s => !STATUS_ORDER.includes(s) && counts_[s] > 0),
  ]
  return (
    <div className={flush ? 'bg-surface p-6' : 'bg-surface rounded-xl border border-border p-6'}>
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
      <div className="px-5 sm:px-6 pb-5">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Click2Save data unavailable: {error}
        </div>
      </div>
    )
  }
  const reasons = cancelReasons || []
  const options = saveOptions || []
  const hasAny = (saveCount || 0) > 0 || reasons.length > 0 || options.length > 0
  if (!hasAny) {
    return (
      <p className="text-sm text-text-muted pb-5 px-5 sm:px-6 text-center">No Click2Save events in this date range.</p>
    )
  }
  return (
    <>
      <StatBlock cols={2} flush>
        <StatCell label="Members Saved" value={saveCount ?? 0} sub="Accepted a save offer instead of cancelling" />
        <StatCell label="Cancel Reasons Captured" value={reasons.reduce((s, r) => s + r.count, 0)} sub="From Click2Save webhook events" />
      </StatBlock>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
        <div className="bg-surface p-6">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Reasons for Cancel</p>
          <CountedList
            rows={reasons}
            getLabel={r => r.reason}
            getColor={() => '#e53e3e'}
            emptyText="No reasons captured in this date range"
          />
        </div>
        <div className="bg-surface p-6">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Save Option Chosen</p>
          <CountedList
            rows={options}
            getLabel={o => SAVE_OPTION_LABELS[o.subtype] || o.subtype}
            getColor={o => SAVE_OPTION_COLORS[o.subtype] || '#a8722c'}
            emptyText="No save offers accepted in this date range"
          />
        </div>
      </div>
    </>
  )
}

export default function CancelsReport({ startDate, endDate, locationSlug, planType = 'all' }) {
  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getCancelsReport(params, { cache: true, signal })
    },
    [startDate, endDate, locationSlug]
  )

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>
  if (!data) return null

  // Plan-type pill filter (All / Membership / Insurance) selects a pre-computed
  // breakdown from the response — no refetch needed. Falls back to the legacy
  // top-level keys if the API doesn't return plan_types yet.
  const view = data.plan_types?.[planType] || data.plan_types?.all || data

  return (
    <ReportBlock>
      {/* ---------- CANCELLATIONS ---------- */}
      <div>
        <Heading>Cancellations</Heading>
        <StatBlock cols={2} flush>
          <StatCell
            label="Members Cancelled"
            value={view.total_members ?? 0}
            sub={planType === 'insurance' ? 'Non-dues-paying (A2 / Active and Fit plans)' : undefined}
          />
          <StatCell
            label="Agreements Cancelled"
            value={view.total_agreements ?? 0}
            sub={planType === 'insurance' ? 'Non-dues-paying (A2 / Active and Fit plans)' : undefined}
          />
        </StatBlock>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
        <StatusBreakdown counts={view.by_status} flush />
        <div className="bg-surface p-6">
          <MembershipTypeTable title="Cancels by Membership Type" rows={view.by_membership_type} flush />
        </div>
      </div>

      {/* ---------- CLICK2SAVE ---------- */}
      <div>
        <Heading>Click2Save</Heading>
        <Click2SaveSection
          saveCount={data.c2s_save_count}
          cancelReasons={data.c2s_cancel_reasons}
          saveOptions={data.c2s_save_options}
          error={data.c2s_error}
        />
      </div>
    </ReportBlock>
  )
}

// Section heading inside the single report block.
function Heading({ children }) {
  return (
    <div className="px-5 sm:px-6 pt-4 pb-3">
      <h3 className="text-lg font-bold text-text-primary">{children}</h3>
    </div>
  )
}
