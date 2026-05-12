import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { getPTRoster } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'

function fmtMoney(val) {
  const n = parseFloat(val)
  if (!n) return '—'
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'recurring', label: 'Recurring' },
  { key: 'pif', label: 'PIF' },
]

export default function PTRosterReport({ locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedTrainers, setExpandedTrainers] = useState(new Set())

  const requestRef = useRef(0)

  useEffect(() => {
    const id = ++requestRef.current
    setData(null)
    setLoading(true)
    setError(null)
    setTypeFilter('all')
    setTrainerFilter('all')
    setSearch('')
    setExpandedTrainers(new Set())
    getPTRoster({ location_slug: locationSlug || 'all' }).then(res => {
      if (id === requestRef.current) { setData(res); setLoading(false) }
    }).catch(err => {
      if (id === requestRef.current) { setError(err.message); setLoading(false) }
    })
  }, [locationSlug])

  // Apply filters
  const filtered = useMemo(() => {
    if (!data?.clients) return []
    const q = search.trim().toLowerCase()
    return data.clients.filter(c => {
      if (typeFilter !== 'all' && c.clientType !== typeFilter) return false
      if (trainerFilter !== 'all' && (c.trainer || 'Unassigned') !== trainerFilter) return false
      if (q) {
        const haystack = [
          c.name || '',
          c.clubName || '',
          c.trainer || '',
          c.service?.serviceItem || '',
          ...(c.services?.map(s => `${s.serviceItem || ''} ${s.planName || ''}`) || []),
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [data, typeFilter, trainerFilter, search])

  // Group filtered rows by trainer
  const trainerRows = useMemo(() => {
    const map = new Map()
    for (const c of filtered) {
      const t = c.trainer || 'Unassigned'
      if (!map.has(t)) map.set(t, { name: t, recurring: [], pif: [] })
      if (c.clientType === 'recurring') map.get(t).recurring.push(c)
      else map.get(t).pif.push(c)
    }
    for (const v of map.values()) {
      v.recurring.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      v.pif.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      v.clientCount = v.recurring.length + v.pif.length
      v.recurringRevenue = v.recurring.reduce((s, c) => s + (c.monthlyRevenue || 0), 0)
      v.pifRevenue = v.pif.reduce((s, c) => s + (c.service?.purchasePrice || 0), 0)
      v.bookTotal = v.recurringRevenue + v.pifRevenue
    }
    return [...map.values()].sort((a, b) => {
      if (a.name === 'Unassigned') return 1
      if (b.name === 'Unassigned') return -1
      return a.name.localeCompare(b.name)
    })
  }, [filtered])

  const allTrainers = useMemo(() => {
    if (!data?.clients) return []
    return [...new Set(data.clients.map(c => c.trainer || 'Unassigned'))].sort((a, b) => {
      if (a === 'Unassigned') return 1
      if (b === 'Unassigned') return -1
      return a.localeCompare(b)
    })
  }, [data])

  const filteredSummary = useMemo(() => {
    return trainerRows.reduce(
      (acc, t) => {
        acc.recurring += t.recurring.length
        acc.pif += t.pif.length
        acc.recurringRevenue += t.recurringRevenue
        acc.pifRevenue += t.pifRevenue
        return acc
      },
      { recurring: 0, pif: 0, recurringRevenue: 0, pifRevenue: 0 }
    )
  }, [trainerRows])

  function toggleTrainer(name) {
    setExpandedTrainers(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function expandAll() {
    setExpandedTrainers(new Set(trainerRows.map(t => t.name)))
  }

  function collapseAll() {
    setExpandedTrainers(new Set())
  }

  function handleExportCSV() {
    if (!filtered.length) return
    const header = ['Trainer', 'Client', 'Type', 'Club', 'Package / Service', 'Frequency / Sessions', 'Monthly $', 'Purchase $']
    const rows = filtered.map(c => {
      const isRS = c.clientType === 'recurring'
      return [
        capitalize(c.trainer || 'Unassigned'),
        capitalize(c.name || ''),
        isRS ? 'RS' : 'PIF',
        c.clubName || '',
        isRS
          ? (c.services?.map(s => s.planName || s.serviceItem).filter(Boolean).join(', ') || '')
          : (c.service?.serviceItem || ''),
        isRS
          ? (c.services?.[0]?.useFrequency || c.services?.[0]?.frequency || '')
          : `${c.service?.sessionsLeft ?? ''} of ${c.service?.totalBought ?? ''}`,
        isRS ? (c.monthlyRevenue || 0).toFixed(2) : '',
        !isRS ? (c.service?.purchasePrice || 0).toFixed(2) : '',
      ]
    })
    exportCSV([header, ...rows], `pt-roster-${locationSlug || 'all'}`)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-6 h-6 border-2 border-wcs-red/30 border-t-wcs-red rounded-full animate-spin" />
        <p className="loading-card">Loading PT roster from ABC Financial...</p>
        <p className="text-text-muted text-xs">This may take a minute for all locations</p>
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
        <SummaryCard label="Recurring" value={filteredSummary.recurring} tone="purple" />
        <SummaryCard label="PIF" value={filteredSummary.pif} tone="amber" />
        <SummaryCard label="Monthly RS" value={fmtMoney(filteredSummary.recurringRevenue)} tone="purple" />
        <SummaryCard label="PIF Revenue" value={fmtMoney(filteredSummary.pifRevenue)} tone="amber" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {TYPES.map(f => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                typeFilter === f.key
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-surface text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={trainerFilter}
          onChange={e => setTrainerFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red"
        >
          <option value="all">All trainers</option>
          {allTrainers.map(t => <option key={t} value={t}>{capitalize(t)}</option>)}
        </select>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search member, club, package..."
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red min-w-[240px]"
        />

        <div className="flex gap-1">
          <button onClick={expandAll} className="px-2 py-1 rounded-lg text-xs text-text-muted hover:text-text-primary border border-border bg-surface">
            Expand all
          </button>
          <button onClick={collapseAll} className="px-2 py-1 rounded-lg text-xs text-text-muted hover:text-text-primary border border-border bg-surface">
            Collapse all
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            disabled={!filtered.length}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-muted text-xs hover:text-text-primary disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            onClick={() => exportPDF('PT Roster')}
            disabled={!filtered.length}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-muted text-xs hover:text-text-primary disabled:opacity-50"
          >
            Print / PDF
          </button>
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-text-muted">
        {filtered.length} {filtered.length === 1 ? 'client' : 'clients'} across {trainerRows.length} {trainerRows.length === 1 ? 'trainer' : 'trainers'}
      </p>

      {/* Errors */}
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
                <th className="text-left px-4 py-2 font-semibold w-8" />
                <th className="text-left px-4 py-2 font-semibold">Trainer / Member</th>
                <th className="text-left px-4 py-2 font-semibold">Type</th>
                <th className="text-left px-4 py-2 font-semibold">Club</th>
                <th className="text-left px-4 py-2 font-semibold">Package</th>
                <th className="text-left px-4 py-2 font-semibold">Frequency / Sessions</th>
                <th className="text-right px-4 py-2 font-semibold">Monthly</th>
                <th className="text-right px-4 py-2 font-semibold">PIF $</th>
              </tr>
            </thead>
            <tbody>
              {trainerRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-text-muted text-sm">
                    No PT clients match these filters.
                  </td>
                </tr>
              ) : (
                trainerRows.map(t => {
                  const expanded = expandedTrainers.has(t.name)
                  return (
                    <Fragment key={t.name}>
                      <tr
                        onClick={() => toggleTrainer(t.name)}
                        className="border-t border-border bg-bg/40 hover:bg-bg cursor-pointer"
                      >
                        <td className="px-4 py-2">
                          <Chevron expanded={expanded} />
                        </td>
                        <td className="px-4 py-2 font-bold text-text-primary">
                          {capitalize(t.name)}
                          <span className="ml-2 text-xs text-text-muted font-medium">
                            {t.clientCount} {t.clientCount === 1 ? 'client' : 'clients'}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            {t.recurring.length > 0 && <CountPill kind="RS" n={t.recurring.length} />}
                            {t.pif.length > 0 && <CountPill kind="PIF" n={t.pif.length} />}
                          </div>
                        </td>
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2 text-right font-semibold text-text-primary">
                          {t.recurringRevenue > 0 ? fmtMoney(t.recurringRevenue) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-text-primary">
                          {t.pifRevenue > 0 ? fmtMoney(t.pifRevenue) : '—'}
                        </td>
                      </tr>

                      {expanded && t.recurring.map(c => (
                        <tr key={`${t.name}-rs-${c.memberId}`} className="border-t border-border/40 hover:bg-bg/30">
                          <td />
                          <td className="px-4 py-2 pl-10 text-text-primary">{capitalize(c.name)}</td>
                          <td className="px-4 py-2"><TypePill kind="RS" /></td>
                          <td className="px-4 py-2 text-text-muted">{c.clubName}</td>
                          <td className="px-4 py-2 text-text-muted" title={c.services?.[0]?.planName || ''}>
                            {c.services?.map(s => s.planName || s.serviceItem).filter(Boolean).join(', ') || '—'}
                          </td>
                          <td className="px-4 py-2 text-text-muted">
                            {c.services?.[0]?.useFrequency || c.services?.[0]?.frequency || '—'}
                          </td>
                          <td className="px-4 py-2 text-right text-text-primary font-medium">
                            {fmtMoney(c.monthlyRevenue)}
                          </td>
                          <td />
                        </tr>
                      ))}

                      {expanded && t.pif.map(c => (
                        <tr key={`${t.name}-pif-${c.memberId}`} className="border-t border-border/40 hover:bg-bg/30">
                          <td />
                          <td className="px-4 py-2 pl-10 text-text-primary">{capitalize(c.name)}</td>
                          <td className="px-4 py-2"><TypePill kind="PIF" /></td>
                          <td className="px-4 py-2 text-text-muted">{c.clubName}</td>
                          <td className="px-4 py-2 text-text-muted">{c.service?.serviceItem || '—'}</td>
                          <td className="px-4 py-2 text-text-muted">
                            {(c.service?.sessionsLeft ?? '—')} of {(c.service?.totalBought ?? '—')} left
                          </td>
                          <td />
                          <td className="px-4 py-2 text-right text-text-primary font-medium">
                            {fmtMoney(c.service?.purchasePrice)}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })
              )}
            </tbody>
            {trainerRows.length > 0 && (
              <tfoot className="border-t-2 border-border">
                <tr className="bg-bg font-semibold">
                  <td />
                  <td className="px-4 py-2 text-text-primary">
                    Totals — {filtered.length} {filtered.length === 1 ? 'client' : 'clients'}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      {filteredSummary.recurring > 0 && <CountPill kind="RS" n={filteredSummary.recurring} />}
                      {filteredSummary.pif > 0 && <CountPill kind="PIF" n={filteredSummary.pif} />}
                    </div>
                  </td>
                  <td colSpan={3} />
                  <td className="px-4 py-2 text-right text-text-primary">
                    {fmtMoney(filteredSummary.recurringRevenue)}
                  </td>
                  <td className="px-4 py-2 text-right text-text-primary">
                    {fmtMoney(filteredSummary.pifRevenue)}
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
  const toneCls = tone === 'purple'
    ? 'border-purple-200 bg-purple-50'
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

function CountPill({ kind, n }) {
  const isRS = kind === 'RS'
  const cls = isRS
    ? 'bg-purple-50 text-purple-700 border-purple-200'
    : 'bg-amber-50 text-amber-700 border-amber-200'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {n} {isRS ? 'RS' : 'PIF'}
    </span>
  )
}

function Chevron({ expanded }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  )
}
