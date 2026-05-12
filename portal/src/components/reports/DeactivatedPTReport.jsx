import { useEffect, useMemo, useRef, useState } from 'react'
import { getDeactivatedPT } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt)) return d
  return `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(2)}`
}

const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'Deactivated RS', label: 'Deactivated RS' },
  { key: 'PIF Burned', label: 'PIF Burned' },
]

export default function DeactivatedPTReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [search, setSearch] = useState('')

  const reqRef = useRef(0)

  useEffect(() => {
    if (!startDate || !endDate) return
    const id = ++reqRef.current
    setData(null)
    setLoading(true)
    setError(null)
    getDeactivatedPT({
      start_date: startDate,
      end_date: endDate,
      location_slug: locationSlug || 'all',
    })
      .then(res => {
        if (id !== reqRef.current) return
        setData(res)
        setLoading(false)
      })
      .catch(err => {
        if (id !== reqRef.current) return
        setError(err.message)
        setLoading(false)
      })
  }, [startDate, endDate, locationSlug])

  const trainers = useMemo(() => {
    if (!data?.rows) return []
    return [...new Set(data.rows.map(r => r.serviceEmployee).filter(Boolean))].sort()
  }, [data])

  const filtered = useMemo(() => {
    if (!data?.rows) return []
    const q = search.trim().toLowerCase()
    return data.rows.filter(r => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (trainerFilter !== 'all' && r.serviceEmployee !== trainerFilter) return false
      if (q) {
        const hay = `${r.memberName} ${r.package} ${r.serviceEmployee || ''} ${r.clubName}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data, typeFilter, trainerFilter, search])

  const filteredSummary = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        if (r.type === 'Deactivated RS') acc.deactivatedCount++
        else acc.burnedCount++
        return acc
      },
      { deactivatedCount: 0, burnedCount: 0 }
    )
  }, [filtered])

  function handleExportCSV() {
    if (!filtered.length) return
    const header = [
      'Cancel / Last Used', 'Type', 'Member', 'Package',
      'Sale Date', 'Service Employee', 'Location',
    ]
    const rows = filtered.map(r => [
      r.cancelDate || '',
      r.type,
      r.memberName,
      r.package,
      r.saleDate || '',
      r.serviceEmployee || '',
      r.clubName,
    ])
    exportCSV([header, ...rows], `deactivated-pt-${startDate}_to_${endDate}`)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-6 h-6 border-2 border-wcs-red/30 border-t-wcs-red rounded-full animate-spin" />
        <p className="loading-card">Loading deactivated PT from ABC Financial...</p>
        <p className="text-text-muted text-xs">This may take a minute for all locations</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>
    )
  }
  if (!data) return null

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <SummaryCard label="Deactivated RS" value={filteredSummary.deactivatedCount} tone="red" />
        <SummaryCard label="PIF Burned" value={filteredSummary.burnedCount} tone="amber" />
        <SummaryCard label="Total" value={filtered.length} tone="default" />
      </div>

      {/* Explainer */}
      <div className="bg-surface border border-border rounded-xl px-4 py-2.5 text-xs text-text-primary">
        <span className="font-semibold">Deactivated RS</span> — PT recurring service whose status flipped off-active inside the window. Cancel date = the deactivation date.
        <span className="font-semibold"> · PIF Burned</span> — member whose Paid-in-Full PT sessions are all used AND has no other active recurring service anywhere on their record. Cancel date = the date of their last completed session. Both row types are anchored to ABC's last-modified timestamp so the date range filters by "things that changed in this window".
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {TYPES.map(t => (
            <button
              key={t.key}
              onClick={() => setTypeFilter(t.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                typeFilter === t.key
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-surface text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select
          value={trainerFilter}
          onChange={e => setTrainerFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red"
        >
          <option value="all">All service employees</option>
          {trainers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search member, package, status..."
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red min-w-[240px]"
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            disabled={!filtered.length}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-muted text-xs hover:text-text-primary disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            onClick={() => exportPDF('Deactivated PT')}
            disabled={!filtered.length}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-muted text-xs hover:text-text-primary disabled:opacity-50"
          >
            Print / PDF
          </button>
        </div>
      </div>

      {/* Errors per club */}
      {data.errors?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
          Some locations failed to load:
          <ul className="mt-1 list-disc pl-5">
            {data.errors.map((e, i) => <li key={i}>{e.club}: {e.error}</li>)}
          </ul>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-xs uppercase tracking-wide text-text-muted">
                <th className="text-left px-4 py-2 font-semibold" title="Deactivation date for RS rows; last completed session for PIF Burned">Cancel / Last Used</th>
                <th className="text-left px-4 py-2 font-semibold">Type</th>
                <th className="text-left px-4 py-2 font-semibold">Member</th>
                <th className="text-left px-4 py-2 font-semibold">Package</th>
                <th className="text-left px-4 py-2 font-semibold">Sale Date</th>
                <th className="text-left px-4 py-2 font-semibold">Service Employee</th>
                <th className="text-left px-4 py-2 font-semibold">Location</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted text-sm">
                    No deactivated PT in this date range.
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={`${r.memberId}-${r.type}-${r.saleDate}-${i}`} className="border-t border-border hover:bg-bg/60">
                    <td className="px-4 py-2 text-text-primary whitespace-nowrap">{fmtDate(r.cancelDate)}</td>
                    <td className="px-4 py-2"><TypePill kind={r.type} /></td>
                    <td className="px-4 py-2 font-medium text-text-primary">{r.memberName}</td>
                    <td className="px-4 py-2 text-text-muted">{r.package}</td>
                    <td className="px-4 py-2 text-text-muted whitespace-nowrap">{fmtDate(r.saleDate)}</td>
                    <td className="px-4 py-2 text-text-muted">{r.serviceEmployee || '—'}</td>
                    <td className="px-4 py-2 text-text-muted">{r.clubName}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="border-t-2 border-border">
                <tr className="bg-bg font-semibold">
                  <td className="px-4 py-2 text-text-primary" colSpan={7}>
                    {filteredSummary.deactivatedCount} Deactivated RS · {filteredSummary.burnedCount} PIF Burned ·
                    Total {filtered.length}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, tone }) {
  const toneCls = tone === 'red'
    ? 'border-red-200 bg-red-50'
    : tone === 'amber'
      ? 'border-amber-200 bg-amber-50'
      : 'border-border bg-surface'
  return (
    <div className={`rounded-xl border p-4 ${toneCls}`}>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-text-primary mt-1">{value}</p>
    </div>
  )
}

function TypePill({ kind }) {
  const isRS = kind === 'Deactivated RS'
  const cls = isRS
    ? 'bg-red-50 text-red-700 border-red-200'
    : 'bg-amber-50 text-amber-700 border-amber-200'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {kind}
    </span>
  )
}
