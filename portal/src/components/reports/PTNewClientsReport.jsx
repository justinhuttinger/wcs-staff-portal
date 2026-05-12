import { useEffect, useMemo, useRef, useState } from 'react'
import { getPTNewClients } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'

function fmtMoney(n) {
  const v = Number(n || 0)
  return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt)) return d
  return `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(2)}`
}

const CLASSIFICATIONS = [
  { key: 'all', label: 'All' },
  { key: 'New Client', label: 'New Clients' },
  { key: 'Resign', label: 'Resigns' },
]

export default function PTNewClientsReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [classFilter, setClassFilter] = useState('all')
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [commissionFilter, setCommissionFilter] = useState('all')
  const [search, setSearch] = useState('')

  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setData(null)
    setLoading(true)
    setError(null)
    getPTNewClients({
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

  const commissionEmployees = useMemo(() => {
    if (!data?.rows) return []
    return [...new Set(data.rows.map(r => r.commissionEmployee).filter(Boolean))].sort()
  }, [data])

  const filtered = useMemo(() => {
    if (!data?.rows) return []
    const q = search.trim().toLowerCase()
    return data.rows.filter(r => {
      if (classFilter !== 'all' && r.classification !== classFilter) return false
      if (trainerFilter !== 'all' && r.serviceEmployee !== trainerFilter) return false
      if (commissionFilter !== 'all' && r.commissionEmployee !== commissionFilter) return false
      if (q && !r.memberName.toLowerCase().includes(q) && !r.package.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, classFilter, trainerFilter, commissionFilter, search])

  const filteredSummary = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        if (r.classification === 'New Client') {
          acc.newClientCount++
          acc.newClientRevenue += r.price
        } else {
          acc.resignCount++
          acc.resignRevenue += r.price
        }
        acc.totalRevenue += r.price
        return acc
      },
      { newClientCount: 0, resignCount: 0, newClientRevenue: 0, resignRevenue: 0, totalRevenue: 0 }
    )
  }, [filtered])

  function handleExportCSV() {
    if (!filtered.length) return
    const header = ['Sell Date', 'Classification', 'Type', 'Member', 'Package', 'Price', 'Commission Employee', 'Service Employee', 'Location']
    const rows = filtered.map(r => [
      r.saleDate,
      r.classification,
      r.type,
      r.memberName,
      r.package,
      r.price.toFixed(2),
      r.commissionEmployee || '',
      r.serviceEmployee || '',
      r.clubName,
    ])
    exportCSV([header, ...rows], `pt-new-clients-${startDate}_to_${endDate}`)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-6 h-6 border-2 border-wcs-red/30 border-t-wcs-red rounded-full animate-spin" />
        <p className="loading-card">Loading new PT clients from ABC Financial...</p>
        <p className="text-text-muted text-xs">This may take up to a minute for all locations</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">
        {error}
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="New Clients" value={filteredSummary.newClientCount} tone="green" />
        <SummaryCard label="Resigns" value={filteredSummary.resignCount} tone="blue" />
        <SummaryCard label="New Client Revenue" value={fmtMoney(filteredSummary.newClientRevenue)} tone="green" />
        <SummaryCard label="Resign Revenue" value={fmtMoney(filteredSummary.resignRevenue)} tone="blue" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {CLASSIFICATIONS.map(c => (
            <button
              key={c.key}
              onClick={() => setClassFilter(c.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                classFilter === c.key
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-surface text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <select
          value={trainerFilter}
          onChange={e => setTrainerFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red"
        >
          <option value="all">All trainers</option>
          {trainers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <select
          value={commissionFilter}
          onChange={e => setCommissionFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red"
        >
          <option value="all">All commission employees</option>
          {commissionEmployees.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search member or package..."
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red min-w-[220px]"
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
            onClick={() => exportPDF('PT New Clients')}
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
                <th className="text-left px-4 py-2 font-semibold">Sell Date</th>
                <th className="text-left px-4 py-2 font-semibold">Class</th>
                <th className="text-left px-4 py-2 font-semibold">Type</th>
                <th className="text-left px-4 py-2 font-semibold">Member</th>
                <th className="text-left px-4 py-2 font-semibold">Package</th>
                <th className="text-right px-4 py-2 font-semibold">Price</th>
                <th className="text-left px-4 py-2 font-semibold">Commission</th>
                <th className="text-left px-4 py-2 font-semibold">Trainer</th>
                <th className="text-left px-4 py-2 font-semibold">Location</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-text-muted text-sm">
                    No new PT clients in this date range.
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={`${r.memberId}-${r.saleDate}-${i}`} className="border-t border-border hover:bg-bg/60">
                    <td className="px-4 py-2 text-text-primary whitespace-nowrap">{fmtDate(r.saleDate)}</td>
                    <td className="px-4 py-2">
                      <ClassificationPill kind={r.classification} />
                    </td>
                    <td className="px-4 py-2">
                      <TypePill kind={r.type} />
                    </td>
                    <td className="px-4 py-2 font-medium text-text-primary">{r.memberName}</td>
                    <td className="px-4 py-2 text-text-muted">{r.package}</td>
                    <td className="px-4 py-2 text-right font-semibold text-text-primary">{fmtMoney(r.price)}</td>
                    <td className="px-4 py-2 text-text-muted">{r.commissionEmployee || '—'}</td>
                    <td className="px-4 py-2 text-text-muted">{r.serviceEmployee || '—'}</td>
                    <td className="px-4 py-2 text-text-muted">{r.clubName}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="border-t-2 border-border">
                <tr className="bg-bg font-semibold">
                  <td className="px-4 py-2 text-text-primary" colSpan={5}>
                    Total: {filtered.length} {filtered.length === 1 ? 'sale' : 'sales'}
                  </td>
                  <td className="px-4 py-2 text-right text-text-primary">{fmtMoney(filteredSummary.totalRevenue)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-xs text-text-muted">
        Classification: <span className="font-semibold">New Client</span> = no other PT purchase by this member in the 90 days before the sell date. <span className="font-semibold">Resign</span> = at least one PT purchase (recurring or paid-in-full) in that prior 90-day window.
      </p>
    </div>
  )
}

function SummaryCard({ label, value, tone }) {
  const toneCls = tone === 'green'
    ? 'border-green-200 bg-green-50'
    : tone === 'blue'
      ? 'border-blue-200 bg-blue-50'
      : 'border-border bg-surface'
  return (
    <div className={`rounded-xl border p-4 ${toneCls}`}>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-text-primary mt-1">{value}</p>
    </div>
  )
}

function ClassificationPill({ kind }) {
  const isNew = kind === 'New Client'
  const cls = isNew
    ? 'bg-green-50 text-green-700 border-green-200'
    : 'bg-blue-50 text-blue-700 border-blue-200'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {kind}
    </span>
  )
}

function TypePill({ kind }) {
  const isRS = kind === 'RS'
  const cls = isRS
    ? 'bg-purple-50 text-purple-700 border-purple-200'
    : 'bg-amber-50 text-amber-700 border-amber-200'
  const label = isRS ? 'RS' : 'PIF'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {label}
    </span>
  )
}
