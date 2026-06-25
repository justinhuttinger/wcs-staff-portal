import { useMemo, useState } from 'react'
import { getPTProjections } from '../../lib/api'
import { exportCSV } from '../../lib/export'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'

function fmtMoney(n) {
  const v = Number(n || 0)
  return '$' + Math.round(v).toLocaleString()
}

function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt)) return d
  return `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(2)}`
}

function monthName(isoDate) {
  if (!isoDate) return ''
  const dt = new Date(isoDate + 'T00:00:00')
  if (isNaN(dt)) return ''
  return dt.toLocaleString('default', { month: 'long' })
}

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'pastdue', label: 'Past-due' },
  { key: 'collected', label: 'Collected' },
  { key: 'future', label: 'Future' },
]

export default function PTProjectionsReport({ startDate, endDate, locationSlug }) {
  const [trainerLocFilter, setTrainerLocFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [memberSearch, setMemberSearch] = useState('')
  const [exportedConfirm, setExportedConfirm] = useState(false)

  const { data, loading, error } = useCancellableFetch(
    (signal) => getPTProjections(
      { start_date: startDate, end_date: endDate, location_slug: locationSlug || 'all' },
      { cache: true, signal }
    ),
    [startDate, endDate, locationSlug]
  )

  const trainerLocations = useMemo(() => {
    if (!data?.byTrainer) return []
    return [...new Set(data.byTrainer.map(r => r.location).filter(Boolean))].sort()
  }, [data])

  const filteredTrainers = useMemo(() => {
    if (!data?.byTrainer) return []
    if (trainerLocFilter === 'all') return data.byTrainer
    return data.byTrainer.filter(r => r.location === trainerLocFilter)
  }, [data, trainerLocFilter])

  const filteredMembers = useMemo(() => {
    if (!data?.members) return []
    const q = memberSearch.trim().toLowerCase()
    return data.members.filter(r => {
      if (statusFilter !== 'all') {
        const s = (r.status || '').toLowerCase().replace(/[-\s]/g, '')
        if (s !== statusFilter.replace(/[-\s]/g, '')) return false
      }
      if (q) {
        const haystack = [r.name, r.trainer, r.location].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [data, statusFilter, memberSearch])

  const byLocTotals = useMemo(() => {
    if (!data?.byLocation) return null
    return data.byLocation.reduce(
      (acc, r) => ({
        projected: acc.projected + Number(r.projected || 0),
        collected: acc.collected + Number(r.collected || 0),
        outstanding: acc.outstanding + Number(r.outstanding || 0),
        pastDue: acc.pastDue + Number(r.pastDue || 0),
      }),
      { projected: 0, collected: 0, outstanding: 0, pastDue: 0 }
    )
  }, [data])

  function handleExportCSV() {
    if (!filteredMembers.length) return
    const header = ['Member', 'Trainer', 'Location', 'Next Draft', 'Amount', 'Status']
    const rows = filteredMembers.map(r => [
      r.name || '',
      r.trainer || '',
      r.location || '',
      r.nextBillingDate || '',
      Number(r.amount || 0).toFixed(2),
      r.status || '',
    ])
    exportCSV([header, ...rows], `pt-projections-${startDate}_to_${endDate}`)
    setExportedConfirm(true)
    setTimeout(() => setExportedConfirm(false), 2000)
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-text-muted italic">Loading PT projections from ABC Financial - this may take up to a minute for all locations...</p>
        <DesktopLoading variant="report" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">
        {error.message || String(error)}
      </div>
    )
  }
  if (!data) return null

  const summary = data.summary || {}
  const month = monthName(summary.window?.start)

  return (
    <div className="space-y-6">

      {/* Errors */}
      {data.errors?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
          Some clubs failed to load: {data.errors.map(e => e.club || e.message || String(e)).join(', ')}
        </div>
      )}

      {/* Empty state: the recurring PT data is synced nightly, so it is blank
          until the first sync runs. */}
      {!data.lastSyncedAt && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
          No recurring PT data has synced yet. This report updates from a nightly sync; check back after it runs.
        </div>
      )}

      {/* Summary cards */}
      <div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard label="Projected" value={fmtMoney(summary.projected)} tone="blue" />
          <SummaryCard label="Collected" value={fmtMoney(summary.collected)} tone="green" />
          <SummaryCard label="Outstanding" value={fmtMoney(summary.outstanding)} tone="amber" />
          <SummaryCard label="Past-due" value={fmtMoney(summary.pastDue)} tone="red" />
        </div>
        {month && (
          <p className="mt-3 text-sm text-text-muted">
            {month} PT: projected {fmtMoney(summary.projected)}, collected {fmtMoney(summary.collected)}, {fmtMoney(summary.outstanding)} outstanding, {fmtMoney(summary.pastDue)} past-due.
          </p>
        )}
        {summary.asOf && (
          <p className="mt-1 text-xs text-text-muted">
            As of {fmtDate(summary.asOf)}{data.lastSyncedAt ? ` · data synced ${fmtDate(String(data.lastSyncedAt).slice(0, 10))}` : ''}
          </p>
        )}
      </div>

      {/* Upcoming drafts by day */}
      {data.byDay?.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-primary mb-2">Upcoming Drafts by Day (next 45 days)</h3>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bg">
                  <tr className="text-xs uppercase tracking-wide text-text-muted">
                    <th className="text-left px-4 py-2 font-semibold">Date</th>
                    <th className="text-right px-4 py-2 font-semibold">Count</th>
                    <th className="text-right px-4 py-2 font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byDay.map((row, i) => (
                    <tr key={row.date || i} className="border-t border-border hover:bg-bg/60">
                      <td className="px-4 py-2 text-text-primary whitespace-nowrap">{fmtDate(row.date)}</td>
                      <td className="px-4 py-2 text-right text-text-muted">{row.count}</td>
                      <td className="px-4 py-2 text-right font-semibold text-text-primary">{fmtMoney(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* By location */}
      {data.byLocation?.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-primary mb-2">By Location</h3>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bg">
                  <tr className="text-xs uppercase tracking-wide text-text-muted">
                    <th className="text-left px-4 py-2 font-semibold">Location</th>
                    <th className="text-right px-4 py-2 font-semibold">Projected</th>
                    <th className="text-right px-4 py-2 font-semibold">Collected</th>
                    <th className="text-right px-4 py-2 font-semibold">Outstanding</th>
                    <th className="text-right px-4 py-2 font-semibold">Past-due</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byLocation.map((row, i) => (
                    <tr key={row.slug || i} className="border-t border-border hover:bg-bg/60">
                      <td className="px-4 py-2 font-medium text-text-primary capitalize">{row.slug}</td>
                      <td className="px-4 py-2 text-right text-text-primary">{fmtMoney(row.projected)}</td>
                      <td className="px-4 py-2 text-right text-text-primary">{fmtMoney(row.collected)}</td>
                      <td className="px-4 py-2 text-right text-text-muted">{fmtMoney(row.outstanding)}</td>
                      <td className="px-4 py-2 text-right text-wcs-red">{fmtMoney(row.pastDue)}</td>
                    </tr>
                  ))}
                </tbody>
                {byLocTotals && (
                  <tfoot className="border-t-2 border-border">
                    <tr className="bg-bg font-semibold">
                      <td className="px-4 py-2 text-text-primary">All clubs</td>
                      <td className="px-4 py-2 text-right text-text-primary">{fmtMoney(byLocTotals.projected)}</td>
                      <td className="px-4 py-2 text-right text-text-primary">{fmtMoney(byLocTotals.collected)}</td>
                      <td className="px-4 py-2 text-right text-text-muted">{fmtMoney(byLocTotals.outstanding)}</td>
                      <td className="px-4 py-2 text-right text-wcs-red">{fmtMoney(byLocTotals.pastDue)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </section>
      )}

      {/* By trainer */}
      {data.byTrainer?.length > 0 && (
        <section>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h3 className="text-sm font-semibold text-text-primary">By Trainer</h3>
            <select
              value={trainerLocFilter}
              onChange={e => setTrainerLocFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red"
            >
              <option value="all">All locations</option>
              {trainerLocations.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bg">
                  <tr className="text-xs uppercase tracking-wide text-text-muted">
                    <th className="text-left px-4 py-2 font-semibold">Trainer</th>
                    <th className="text-left px-4 py-2 font-semibold">Location</th>
                    <th className="text-right px-4 py-2 font-semibold">Projected</th>
                    <th className="text-right px-4 py-2 font-semibold">Collected</th>
                    <th className="text-right px-4 py-2 font-semibold">Upcoming</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrainers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">
                        No trainer data for this location.
                      </td>
                    </tr>
                  ) : (
                    filteredTrainers.map((row, i) => (
                      <tr key={`${row.trainer}-${row.location}-${i}`} className="border-t border-border hover:bg-bg/60">
                        <td className="px-4 py-2 font-medium text-text-primary">{row.trainer || '-'}</td>
                        <td className="px-4 py-2 text-text-muted capitalize">{row.location || '-'}</td>
                        <td className="px-4 py-2 text-right text-text-primary">{fmtMoney(row.projected)}</td>
                        <td className="px-4 py-2 text-right text-text-primary">{fmtMoney(row.collected)}</td>
                        <td className="px-4 py-2 text-right text-text-muted">{row.count ?? '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Member detail */}
      <section>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Member Detail</h3>

          {/* Status filter pills */}
          <div className="flex gap-1">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  statusFilter === f.key
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-surface text-text-muted border-border hover:text-text-primary'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={memberSearch}
            onChange={e => setMemberSearch(e.target.value)}
            placeholder="Search member or trainer..."
            className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red min-w-[200px]"
          />

          <button
            onClick={handleExportCSV}
            disabled={!filteredMembers.length}
            className="ml-auto px-3 py-1.5 rounded-lg border border-border bg-surface text-text-muted text-xs hover:text-text-primary disabled:opacity-50 transition-colors"
          >
            {exportedConfirm ? 'Exported!' : 'Export CSV'}
          </button>
        </div>

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg">
                <tr className="text-xs uppercase tracking-wide text-text-muted">
                  <th className="text-left px-4 py-2 font-semibold">Member</th>
                  <th className="text-left px-4 py-2 font-semibold">Trainer</th>
                  <th className="text-left px-4 py-2 font-semibold">Location</th>
                  <th className="text-left px-4 py-2 font-semibold">Next Draft</th>
                  <th className="text-right px-4 py-2 font-semibold">Amount</th>
                  <th className="text-left px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-text-muted text-sm">
                      No members match this filter.
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((r, i) => (
                    <tr key={`${r.memberId}-${i}`} className="border-t border-border hover:bg-bg/60">
                      <td className="px-4 py-2 font-medium text-text-primary">{r.name || '-'}</td>
                      <td className="px-4 py-2 text-text-muted">{r.trainer || '-'}</td>
                      <td className="px-4 py-2 text-text-muted capitalize">{r.location || '-'}</td>
                      <td className="px-4 py-2 text-text-primary whitespace-nowrap">{fmtDate(r.nextBillingDate)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-text-primary">{fmtMoney(r.amount)}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Showing {filteredMembers.length} of {data.members?.length ?? 0} members.
        </p>
      </section>
    </div>
  )
}

function SummaryCard({ label, value, tone }) {
  const toneCls =
    tone === 'green' ? 'border-green-200 bg-green-50' :
    tone === 'blue' ? 'border-blue-200 bg-blue-50' :
    tone === 'amber' ? 'border-amber-200 bg-amber-50' :
    tone === 'red' ? 'border-red-200 bg-red-50' :
    'border-border bg-surface'
  return (
    <div className={`rounded-xl border p-4 ${toneCls}`}>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-text-primary mt-1">{value}</p>
    </div>
  )
}

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase().replace(/[-\s]/g, '')
  let cls = 'bg-gray-50 text-gray-600 border-gray-200'
  if (s === 'collected') cls = 'bg-emerald-50 text-emerald-700 border-emerald-200'
  else if (s === 'upcoming') cls = 'bg-blue-50 text-blue-700 border-blue-200'
  else if (s === 'pastdue') cls = 'bg-red-50 text-red-700 border-red-200'
  else if (s === 'future') cls = 'bg-gray-100 text-gray-500 border-gray-200'
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : '-'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {label}
    </span>
  )
}
