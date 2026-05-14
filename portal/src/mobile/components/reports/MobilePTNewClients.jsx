import { useMemo, useState } from 'react'
import { getPTNewClients } from '../../../lib/api'
import MobileLoading from '../MobileLoading'
import { useCancellableFetch } from '../../../hooks/useCancellableFetch'

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

export default function MobilePTNewClients({ startDate, endDate, locationSlug }) {
  const [classFilter, setClassFilter] = useState('all')
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [search, setSearch] = useState('')

  const { data, loading, error } = useCancellableFetch(
    (signal) => getPTNewClients(
      { start_date: startDate, end_date: endDate, location_slug: locationSlug || 'all' },
      { cache: true, signal }
    ),
    [startDate, endDate, locationSlug]
  )

  const trainers = useMemo(() => {
    if (!data?.rows) return []
    return [...new Set(data.rows.map(r => r.serviceEmployee).filter(Boolean))].sort()
  }, [data])

  const filtered = useMemo(() => {
    if (!data?.rows) return []
    const q = search.trim().toLowerCase()
    return data.rows.filter(r => {
      if (classFilter !== 'all' && r.classification !== classFilter) return false
      if (trainerFilter !== 'all' && r.serviceEmployee !== trainerFilter) return false
      if (q && !r.memberName.toLowerCase().includes(q) && !r.package.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, classFilter, trainerFilter, search])

  const summary = useMemo(() => {
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

  if (loading) return <MobileLoading variant="report" />

  if (error) return (
    <div className="p-4">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-red-600">{error.message || String(error)}</p>
      </div>
    </div>
  )

  if (!data) return null

  return (
    <div className="p-4 space-y-3">
      {/* Stat cards — horizontal scroll */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 min-w-max">
          <StatCard label="New Clients" value={summary.newClientCount} tone="green" />
          <StatCard label="Resigns" value={summary.resignCount} tone="blue" />
          <StatCard label="New Client Rev" value={fmtMoney(summary.newClientRevenue)} tone="green" />
          <StatCard label="Resign Rev" value={fmtMoney(summary.resignRevenue)} tone="blue" />
          <StatCard label="Total Revenue" value={fmtMoney(summary.totalRevenue)} tone="default" />
        </div>
      </div>

      {/* Partial-load warnings */}
      {data.errors?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs text-amber-900">
          Some locations failed to load:
          <ul className="mt-1 list-disc pl-5">
            {data.errors.map((e, i) => <li key={i}>{e.club}: {e.error}</li>)}
          </ul>
        </div>
      )}

      {/* Classification filter pills */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          {CLASSIFICATIONS.map(c => (
            <button
              key={c.key}
              onClick={() => setClassFilter(c.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                classFilter === c.key
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Trainer filter pills */}
      {trainers.length > 0 && (
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 min-w-max">
            <button
              onClick={() => setTrainerFilter('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                trainerFilter === 'all'
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              All Trainers
            </button>
            {trainers.map(t => (
              <button
                key={t}
                onClick={() => setTrainerFilter(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  trainerFilter === t
                    ? 'bg-wcs-red text-white'
                    : 'bg-surface border border-border text-text-secondary'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Search member or package..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-text-muted"
      />

      {/* Client cards */}
      {filtered.length === 0 ? (
        <div className="bg-surface rounded-2xl border border-border px-4 py-8 text-center text-text-muted text-sm">
          No new PT clients in this date range.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r, i) => (
            <div
              key={`${r.memberId}-${r.saleDate}-${i}`}
              className="bg-surface rounded-2xl border border-border p-4"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-text-primary leading-tight">{r.memberName}</p>
                <span className="text-sm font-bold text-text-primary whitespace-nowrap">{fmtMoney(r.price)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <ClassificationPill kind={r.classification} />
                <TypePill kind={r.type} />
              </div>
              <div className="space-y-0.5">
                {r.package && (
                  <p className="text-xs text-text-muted truncate">{r.package}</p>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
                  <span>Trainer: <span className="text-text-secondary">{r.serviceEmployee || '—'}</span></span>
                  <span>Date: <span className="text-text-secondary">{fmtDate(r.saleDate)}</span></span>
                  {r.clubName && <span>Loc: <span className="text-text-secondary">{r.clubName}</span></span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer totals */}
      {filtered.length > 0 && (
        <div className="bg-surface rounded-2xl border-2 border-wcs-red p-4">
          <p className="text-sm font-bold text-text-primary mb-1">
            {filtered.length} {filtered.length === 1 ? 'sale' : 'sales'}
          </p>
          <p className="text-xs text-text-muted">
            Total: <span className="font-semibold text-text-primary">{fmtMoney(summary.totalRevenue)}</span>
          </p>
        </div>
      )}

      <p className="text-xs text-text-muted pb-2">
        <span className="font-semibold">New Client</span> = no other PT purchase in the prior 90 days.{' '}
        <span className="font-semibold">Resign</span> = had at least one PT purchase (RS or PIF) in that window.
      </p>
    </div>
  )
}

function StatCard({ label, value, tone }) {
  const toneCls =
    tone === 'green' ? 'border-green-200 bg-green-50' :
    tone === 'blue' ? 'border-blue-200 bg-blue-50' :
    'border-border bg-surface'
  return (
    <div className={`min-w-[130px] rounded-2xl border p-4 flex-shrink-0 ${toneCls}`}>
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      <p className="text-xs text-text-muted uppercase tracking-wide mt-1">{label}</p>
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
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {isRS ? 'RS' : 'PIF'}
    </span>
  )
}
