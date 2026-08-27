import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'

// ---------------------------------------------------------------------------
// Past Due — Analytics (admin only)
//
// Members who owe money and are still worth calling. Collections, cancelled,
// expired and pending-cancel accounts never appear: collections alone is ~$468k
// against ~$59k for everyone else, and mixing them produces a number that is
// mostly write-offs.
//
// Bars are one hue. This is a single measure ranked across clubs, so a
// different colour per bar would encode nothing that the row label does not
// already say.
// ---------------------------------------------------------------------------

const BAR = '#2a78d6'
const BAR_ALT = 'var(--color-text-muted)'

const VIEW_BY_OPTIONS = [
  { key: 'club', label: 'Club' },
  { key: 'membership_type', label: 'Membership Type' },
  { key: 'member_status', label: 'Member Status' },
  { key: 'payment_method', label: 'Payment Mode' },
]

const METRICS = [
  { key: 'pastDue', label: 'Past Due Amount', format: 'money' },
  { key: 'totalOwed', label: 'Total Owed', format: 'money' },
  { key: 'lateFees', label: 'Late Fees', format: 'money' },
  { key: 'clubAccount', label: 'Club Account', format: 'money' },
  { key: 'avgPastDue', label: 'Avg Past Due', format: 'money' },
  { key: 'members', label: 'Members Past Due', format: 'int' },
]

function fmt(value, format) {
  if (value === null || value === undefined) return 'N/A'
  const n = Number(value)
  if (format === 'money') return `$${Math.round(n).toLocaleString()}`
  if (format === 'money2') return `$${n.toFixed(2)}`
  if (format === 'pct') return `${n.toFixed(1)}%`
  return Math.round(n).toLocaleString()
}

function Bar({ value, max, tone, children }) {
  const width = max > 0 && value > 0 ? Math.max(1.5, (value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 h-5 min-w-[40px]">
        <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${width}%`, background: tone }} />
      </div>
      <span className="text-xs text-text-primary tabular-nums w-20 text-right flex-shrink-0">{children}</span>
    </div>
  )
}

export default function PastDue({ locationSlug }) {
  const [viewBy, setViewBy] = useState('club')
  const [metric, setMetric] = useState('pastDue')
  const [showList, setShowList] = useState(false)

  const query = useMemo(
    () => new URLSearchParams({ clubs: locationSlug || 'all', viewBy }).toString(),
    [locationSlug, viewBy]
  )

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/past-due?${query}`, { cache: true, signal }),
    [query]
  )

  const activeMetric = METRICS.find(m => m.key === metric) || METRICS[0]

  const rows = useMemo(() => {
    const list = [...(data?.rows || [])]
    list.sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0))
    return list
  }, [data, metric])

  if (loading) return <DesktopLoading />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }

  const s = data?.summary || {}
  const maxMembers = Math.max(0, ...rows.map(r => r.members || 0))
  const maxMetric = Math.max(0, ...rows.map(r => r[metric] || 0))
  const worst = data?.worst || []

  return (
    <div className="space-y-4">
      <Toolbar viewBy={viewBy} setViewBy={setViewBy} metric={metric} setMetric={setMetric} />

      {/* Summary strip */}
      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <div className="flex min-w-max divide-x divide-border">
          {[
            { label: 'Members Past Due', value: fmt(s.members, 'int') },
            { label: '% of Members Past Due', value: fmt(s.pctOfMembers, 'pct') },
            { label: 'Past Due Amount', value: fmt(s.pastDue, 'money') },
            { label: 'Late Fees', value: fmt(s.lateFees, 'money') },
            { label: 'Club Account', value: fmt(s.clubAccount, 'money') },
            { label: 'Total Owed', value: fmt(s.totalOwed, 'money') },
            { label: 'Avg Past Due', value: fmt(s.avgPastDue, 'money') },
          ].map(tile => (
            <div key={tile.label} className="px-5 py-4 text-center min-w-[130px] flex-1">
              <p className="text-xl font-bold text-text-primary tabular-nums">{tile.value}</p>
              <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{tile.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Ranked bars */}
      <div className="bg-surface rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left font-semibold text-text-primary px-4 py-3 w-[220px]">
                {VIEW_BY_OPTIONS.find(v => v.key === viewBy)?.label}
              </th>
              <th className="text-left font-semibold text-text-muted px-3 py-3 text-xs">Members Past Due</th>
              <th className="text-left font-semibold text-text-muted px-3 py-3 text-xs">{activeMetric.label}</th>
              <th className="text-right font-semibold text-text-muted px-4 py-3 text-xs w-[110px]">Avg</th>
              {viewBy === 'club' && (
                <th className="text-right font-semibold text-text-muted px-4 py-3 text-xs w-[110px]">% of Club</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} className="border-b border-border/60 last:border-0 hover:bg-bg/60">
                <td className="px-4 py-2 text-text-primary whitespace-nowrap">{row.label}</td>
                <td className="px-3 py-2">
                  <Bar value={row.members} max={maxMembers} tone={BAR_ALT}>{fmt(row.members, 'int')}</Bar>
                </td>
                <td className="px-3 py-2">
                  <Bar value={row[metric]} max={maxMetric} tone={BAR}>{fmt(row[metric], activeMetric.format)}</Bar>
                </td>
                <td className="px-4 py-2 text-right text-xs text-text-primary tabular-nums">{fmt(row.avgPastDue, 'money')}</td>
                {viewBy === 'club' && (
                  <td className="px-4 py-2 text-right text-xs text-text-primary tabular-nums">{fmt(row.pctOfClubMembers, 'pct')}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="text-sm text-text-muted text-center py-10">Nobody past due in this selection.</p>
        )}
      </div>

      {/* Call list */}
      {worst.length > 0 && (
        <div className="bg-surface rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setShowList(v => !v)}
            aria-expanded={showList}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-text-primary hover:text-wcs-red transition-colors"
          >
            <span>Largest balances ({worst.length}{data?.meta?.worstListTruncated ? ' of more' : ''})</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`w-3.5 h-3.5 transition-transform ${showList ? 'rotate-180' : ''}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showList && (
            <div className="overflow-x-auto border-t border-border">
              <table className="min-w-max w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Member', 'Club', 'Status', 'Type', 'Pay', 'Contact', 'Past Due', 'Late Fees', 'Total'].map(h => (
                      <th key={h} className="text-left font-semibold text-text-muted px-3 py-2 text-xs whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {worst.map(m => (
                    <tr key={m.memberId} className="border-b border-border/60 last:border-0 hover:bg-bg/60">
                      <td className="px-3 py-2 text-text-primary whitespace-nowrap">{m.name}</td>
                      <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{m.club}</td>
                      <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{m.status}</td>
                      <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{m.membershipType}</td>
                      <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{m.paymentMethod || '—'}</td>
                      <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{m.phone || m.email || '—'}</td>
                      <td className="px-3 py-2 text-xs text-text-primary tabular-nums whitespace-nowrap">{fmt(m.pastDue, 'money2')}</td>
                      <td className="px-3 py-2 text-xs text-text-primary tabular-nums whitespace-nowrap">{fmt(m.lateFees, 'money2')}</td>
                      <td className="px-3 py-2 text-xs text-text-primary tabular-nums whitespace-nowrap">{fmt(m.totalOwed, 'money2')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Toolbar({ viewBy, setViewBy, metric, setMetric }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary'
  return createPortal(
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
        View By
        <select value={viewBy} onChange={e => setViewBy(e.target.value)} className={`${cls} normal-case tracking-normal font-medium`}>
          {VIEW_BY_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
        Metric
        <select value={metric} onChange={e => setMetric(e.target.value)} className={`${cls} normal-case tracking-normal font-medium`}>
          {METRICS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
    </div>,
    slot
  )
}
