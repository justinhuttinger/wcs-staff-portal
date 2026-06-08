import { useState, useMemo } from 'react'
import { getMembershipAudit } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatBlock, StatCell, ReportBlock } from './StatBlock'

const DUES_PILLS = [
  { key: 'all', label: 'All' },
  { key: 'paying', label: 'Dues-paying' },
  { key: 'non_dues', label: 'Non-dues' },
]

function money(n) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function money2(n) {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}
function months(n) {
  if (n == null) return '—'
  return `${Number(n).toFixed(1)} mo`
}
function pct(n) {
  if (n == null) return '—'
  return `${Math.round(Number(n) * 100)}%`
}

// CSV download for the leaks list.
function downloadLeaksCsv(rows) {
  const header = ['Name', 'Agreement #', 'Dues (monthly)', 'Typical', '% of Typical', 'Type', 'Club', 'Tenure (mo)', 'Begin Date']
  const lines = rows.map(r => [
    r.name, r.agreement_number, r.monthly_dues, r.type_median_dues,
    r.pct_of_typical != null ? Math.round(r.pct_of_typical * 100) + '%' : '',
    r.membership_type, r.club, r.tenure_months, r.begin_date,
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
  const csv = [header.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'membership-dues-leaks.csv'
  a.click()
  // Defer revoke so the browser can start the download before the blob URL is
  // freed (a synchronous revoke races the download in some browsers).
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

const SORT_COLS = [
  { key: 'membership_type', label: 'Type', align: 'left' },
  { key: 'members', label: 'Members', align: 'right' },
  { key: 'median_monthly_dues', label: 'Median Dues', align: 'right' },
  { key: 'avg_monthly_dues', label: 'Avg Dues', align: 'right' },
  { key: 'total_monthly_dues', label: 'Total Dues', align: 'right' },
  { key: 'avg_tenure_months', label: 'Avg Tenure', align: 'right' },
  { key: 'leaks', label: 'Leaks', align: 'right' },
]

export default function MembershipAuditReport({ locationSlug }) {
  const [dues, setDues] = useState('all')
  const [sort, setSort] = useState({ col: 'members', dir: 'desc' })
  const [showLeaks, setShowLeaks] = useState(false)

  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const params = {}
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getMembershipAudit(params, { signal })
    },
    [locationSlug]
  )

  // Apply the dues pill to the by-type rows (cards + table aggregate over the
  // selected subset). Counts, dues, AND tenure are recomputed for the subset —
  // tenure uses the paying/non-dues split the RPC returns so toggling the pill
  // shows the correct average for that subset.
  const rows = useMemo(() => {
    const all = data?.by_type || []
    return all
      .map(r => {
        if (dues === 'paying') {
          return {
            ...r,
            members: r.paying,
            non_dues: 0,
            tenure_sum_months: Number(r.tenure_sum_paying) || 0,
            tenure_count: Number(r.tenure_count_paying) || 0,
            avg_tenure_months: r.tenure_count_paying ? r.tenure_sum_paying / r.tenure_count_paying : null,
          }
        }
        if (dues === 'non_dues') {
          const ndSum = (Number(r.tenure_sum_months) || 0) - (Number(r.tenure_sum_paying) || 0)
          const ndCnt = (Number(r.tenure_count) || 0) - (Number(r.tenure_count_paying) || 0)
          return {
            ...r,
            members: r.non_dues,
            paying: 0,
            avg_monthly_dues: 0,
            total_monthly_dues: 0,
            median_monthly_dues: 0,
            tenure_sum_months: ndSum,
            tenure_count: ndCnt,
            avg_tenure_months: ndCnt ? ndSum / ndCnt : null,
          }
        }
        return r // 'all'
      })
      .filter(r => r.members > 0)
  }, [data, dues])

  const sortedRows = useMemo(() => {
    const arr = [...rows]
    const { col, dir } = sort
    arr.sort((a, b) => {
      const ra = a[col], rb = b[col]
      if (typeof ra === 'string' || typeof rb === 'string') {
        return dir === 'asc' ? String(ra).localeCompare(String(rb)) : String(rb).localeCompare(String(ra))
      }
      // null/undefined numerics (e.g. tenure with no begin_date) sort to the bottom either way
      const av = ra == null ? (dir === 'asc' ? Infinity : -Infinity) : Number(ra)
      const bv = rb == null ? (dir === 'asc' ? Infinity : -Infinity) : Number(rb)
      return dir === 'asc' ? av - bv : bv - av
    })
    return arr
  }, [rows, sort])

  // Headline numbers recomputed from the (pill-filtered) rows so the cards match
  // the table. avg dues = total/paying; avg tenure = sum/count.
  const totals = useMemo(() => {
    let members = 0, paying = 0, nonDues = 0, totalDues = 0, tenSum = 0, tenCnt = 0
    for (const r of rows) {
      members += Number(r.members) || 0
      paying += Number(r.paying) || 0
      nonDues += Number(r.non_dues) || 0
      totalDues += Number(r.total_monthly_dues) || 0
      tenSum += Number(r.tenure_sum_months) || 0
      tenCnt += Number(r.tenure_count) || 0
    }
    return {
      members,
      avgDues: paying ? totalDues / paying : 0,
      totalDues,
      avgTenure: tenCnt ? tenSum / tenCnt : 0,
      // Leaks are a standing paying-plan concern shown independently of the dues
      // pill (per spec) — the Dues Leaks section below is labeled accordingly.
      leaks: data?.totals?.leak_count || 0,
    }
  }, [rows, data])

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>
  if (!data) return null

  const anomalies = data.anomalies || []

  function setSortCol(col) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' })
  }

  return (
    <ReportBlock>
      {/* Dues pill */}
      <div className="px-5 sm:px-6 pt-4 flex items-center gap-1.5">
        {DUES_PILLS.map(p => (
          <button
            key={p.key}
            type="button"
            onClick={() => setDues(p.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              dues === p.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Headline cards */}
      <StatBlock cols={5} flush>
        <StatCell label="Members" value={totals.members.toLocaleString()} />
        <StatCell label="Avg Monthly Dues" value={money2(totals.avgDues)} />
        <StatCell label="Total Monthly Dues" value={money(totals.totalDues)} />
        <StatCell label="Avg Tenure" value={months(totals.avgTenure)} />
        <StatCell
          label="Dues Leaks"
          value={totals.leaks.toLocaleString()}
          valueClassName={totals.leaks > 0 ? 'text-wcs-red' : undefined}
        />
      </StatBlock>

      {/* By membership type table */}
      <div className="px-5 sm:px-6 py-5 overflow-x-auto">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">By Membership Type</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              {SORT_COLS.map(c => (
                <th
                  key={c.key}
                  onClick={() => setSortCol(c.key)}
                  className={`py-2 font-semibold cursor-pointer select-none ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {c.label}{sort.col === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(r => (
              <tr key={r.membership_type} className="border-b border-border/60">
                <td className="py-1.5 text-text-primary">
                  {r.membership_type}
                  {r.is_insurance && <span className="ml-2 text-[10px] uppercase tracking-wide text-blue-600">insurance</span>}
                  {!r.is_paying_plan && !r.is_insurance && <span className="ml-2 text-[10px] uppercase tracking-wide text-text-muted">non-dues</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{Number(r.members).toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{r.median_monthly_dues ? money2(r.median_monthly_dues) : '—'}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{r.avg_monthly_dues ? money2(r.avg_monthly_dues) : '—'}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{r.total_monthly_dues ? money(r.total_monthly_dues) : '—'}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{months(r.avg_tenure_months)}</td>
                <td className={`py-1.5 text-right tabular-nums font-semibold ${r.leaks > 0 ? 'text-wcs-red' : 'text-text-muted'}`}>{r.leaks || 0}</td>
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr><td colSpan={SORT_COLS.length} className="py-6 text-center text-text-muted text-xs">No members for this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Dues leaks */}
      <div className="px-5 sm:px-6 py-5 border-t border-border">
        <div className="flex items-center gap-3 mb-3">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Dues Leaks — {anomalies.length}{data.anomalies_truncated ? '+ (capped)' : ''} members on a paying plan paying $0 or unusually low
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setShowLeaks(s => !s)} className="text-xs font-semibold text-wcs-red hover:text-wcs-red/80">
              {showLeaks ? 'Hide' : 'Show'}
            </button>
            {anomalies.length > 0 && (
              <button onClick={() => downloadLeaksCsv(anomalies)} className="text-xs font-semibold text-text-muted hover:text-text-primary">
                Export CSV
              </button>
            )}
          </div>
        </div>
        {showLeaks && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="text-left font-semibold py-2">Name</th>
                  <th className="text-left font-semibold py-2">Agreement #</th>
                  <th className="text-right font-semibold py-2">Dues</th>
                  <th className="text-right font-semibold py-2">Typical</th>
                  <th className="text-right font-semibold py-2">% of Typical</th>
                  <th className="text-left font-semibold py-2 pl-3">Type</th>
                  <th className="text-left font-semibold py-2">Club</th>
                  <th className="text-right font-semibold py-2">Tenure</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((r, i) => (
                  <tr key={i} className="border-b border-border/60">
                    <td className="py-1.5 text-text-primary">{r.name}</td>
                    <td className="py-1.5 text-text-muted tabular-nums">{r.agreement_number}</td>
                    <td className="py-1.5 text-right tabular-nums text-wcs-red font-semibold">{money2(r.monthly_dues)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{money2(r.type_median_dues)}</td>
                    <td className="py-1.5 text-right tabular-nums">{pct(r.pct_of_typical)}</td>
                    <td className="py-1.5 pl-3 text-text-muted">{r.membership_type}</td>
                    <td className="py-1.5 text-text-muted capitalize">{r.club}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{months(r.tenure_months)}</td>
                  </tr>
                ))}
                {anomalies.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-text-muted text-xs">No dues leaks for this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ReportBlock>
  )
}
