import { useState, useEffect, useRef } from 'react'
import { getPTRoster } from '../../lib/api'
import { exportCSV } from '../../lib/export'

function fmtMoney(val) {
  const n = parseFloat(val)
  if (!n) return '—'
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt)) return String(d).split(' ')[0]
  return `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(2)}`
}

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

export default function PTRosterReport({ locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [expandedTrainers, setExpandedTrainers] = useState(new Set())

  const requestRef = useRef(0)

  useEffect(() => {
    const id = ++requestRef.current
    setData(null)
    setLoading(true)
    setError(null)
    setTypeFilter('all')
    setTrainerFilter('all')
    setExpandedTrainers(new Set())
    getPTRoster({ location_slug: locationSlug || 'all' }).then(res => {
      if (id === requestRef.current) { setData(res); setLoading(false) }
    }).catch(err => {
      if (id === requestRef.current) { setError(err.message); setLoading(false) }
    })
  }, [locationSlug])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-6 h-6 border-2 border-wcs-red/30 border-t-wcs-red rounded-full animate-spin" />
        <p className="text-text-muted text-sm">Loading PT roster from ABC Financial...</p>
        <p className="text-text-muted text-xs">This may take a minute for all locations</p>
      </div>
    )
  }

  if (error) return <p className="text-red-500 text-sm py-8 text-center">{error}</p>
  if (!data) return null

  const { clients, summary } = data

  // Apply filters
  let filtered = clients
  if (typeFilter !== 'all') filtered = filtered.filter(c => c.clientType === typeFilter)
  if (trainerFilter !== 'all') filtered = filtered.filter(c => c.trainer === trainerFilter)

  // Group by trainer
  const trainerMap = {}
  for (const c of filtered) {
    const t = c.trainer || 'Unassigned'
    if (!trainerMap[t]) trainerMap[t] = { recurring: [], pif: [] }
    if (c.clientType === 'recurring') trainerMap[t].recurring.push(c)
    else trainerMap[t].pif.push(c)
  }

  // Sort trainers alphabetically, Unassigned last
  const trainerNames = Object.keys(trainerMap).sort((a, b) => {
    if (a === 'Unassigned') return 1
    if (b === 'Unassigned') return -1
    return a.localeCompare(b)
  })

  // All unique trainer names for filter dropdown
  const allTrainers = [...new Set(clients.map(c => c.trainer || 'Unassigned'))].sort((a, b) => {
    if (a === 'Unassigned') return 1
    if (b === 'Unassigned') return -1
    return a.localeCompare(b)
  })

  function toggleTrainer(name) {
    setExpandedTrainers(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function expandAll() {
    setExpandedTrainers(new Set(trainerNames))
  }

  function collapseAll() {
    setExpandedTrainers(new Set())
  }

  function handleExport() {
    const rows = filtered.map(c => ({
      Name: capitalize(c.name),
      Trainer: capitalize(c.trainer),
      Type: c.clientType === 'recurring' ? 'Recurring' : 'PIF',
      Club: c.clubName,
      Service: c.clientType === 'recurring'
        ? c.services?.map(s => s.serviceItem).join(', ')
        : c.service?.serviceItem || '',
      'Plan Name': c.clientType === 'recurring'
        ? c.services?.map(s => s.planName).filter(Boolean).join(', ')
        : '',
      Frequency: c.clientType === 'recurring'
        ? c.services?.[0]?.useFrequency || c.services?.[0]?.frequency || ''
        : '',
      'Monthly Revenue': c.clientType === 'recurring' ? c.monthlyRevenue?.toFixed(2) : '',
      'Sessions Left': c.clientType === 'pif' ? c.service?.sessionsLeft : '',
      'Total Bought': c.clientType === 'pif' ? c.service?.totalBought : '',
      'Purchase Price': c.clientType === 'pif' ? c.service?.purchasePrice?.toFixed(2) : '',
    }))
    exportCSV(rows, `pt-roster-${locationSlug || 'all'}`)
  }

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-text-primary">{summary.totalClients}</p>
          <p className="text-xs text-text-muted uppercase tracking-wide mt-1">Active PT Clients</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-text-primary">{summary.recurring}</p>
          <p className="text-xs text-text-muted uppercase tracking-wide mt-1">Recurring</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-text-primary">{summary.pif}</p>
          <p className="text-xs text-text-muted uppercase tracking-wide mt-1">PIF</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-wcs-red">{fmtMoney(summary.monthlyRevenue)}</p>
          <p className="text-xs text-text-muted uppercase tracking-wide mt-1">Monthly RS Revenue</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-purple-600">{fmtMoney(summary.pifRevenue)}</p>
          <p className="text-xs text-text-muted uppercase tracking-wide mt-1">PIF Revenue</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {[
            { key: 'all', label: 'All' },
            { key: 'recurring', label: 'Recurring' },
            { key: 'pif', label: 'PIF' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                typeFilter === f.key
                  ? 'bg-text-primary text-white border-text-primary'
                  : 'bg-surface text-text-muted border-border hover:text-text-primary'
              }`}
            >{f.label}</button>
          ))}
        </div>

        <select
          value={trainerFilter}
          onChange={e => setTrainerFilter(e.target.value)}
          className="text-xs bg-surface border border-border rounded-lg px-3 py-1.5 text-text-primary"
        >
          <option value="all">All Trainers</option>
          {allTrainers.map(t => (
            <option key={t} value={t}>{capitalize(t)}</option>
          ))}
        </select>

        <div className="flex gap-1 ml-auto">
          <button onClick={expandAll} className="text-xs text-text-muted hover:text-text-primary transition-colors">Expand All</button>
          <span className="text-text-muted text-xs">|</span>
          <button onClick={collapseAll} className="text-xs text-text-muted hover:text-text-primary transition-colors">Collapse All</button>
        </div>

        <button
          onClick={handleExport}
          className="text-xs bg-surface border border-border rounded-lg px-3 py-1.5 text-text-muted hover:text-text-primary transition-colors"
        >
          Export CSV
        </button>
      </div>

      {/* Results count */}
      <p className="text-xs text-text-muted">{filtered.length} clients across {trainerNames.length} trainers</p>

      {/* Trainer sections */}
      <div className="space-y-2">
        {trainerNames.map(trainerName => {
          const group = trainerMap[trainerName]
          const total = group.recurring.length + group.pif.length
          const trainerRevenue = group.recurring.reduce((s, c) => s + (c.monthlyRevenue || 0), 0)
          const trainerPifRevenue = group.pif.reduce((s, c) => s + (c.service?.purchasePrice || 0), 0)
          const bookTotal = trainerRevenue + trainerPifRevenue
          const expanded = expandedTrainers.has(trainerName)

          return (
            <div key={trainerName} className="bg-surface border border-border rounded-xl overflow-hidden">
              {/* Trainer header */}
              <button
                onClick={() => toggleTrainer(trainerName)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-bg/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  <span className="text-sm font-bold text-text-primary">{capitalize(trainerName)}</span>
                  <span className="text-xs text-text-muted">{total} clients</span>
                </div>
                <div className="flex items-center gap-3">
                  {group.recurring.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium border border-blue-200">
                      {group.recurring.length} Recurring
                    </span>
                  )}
                  {group.pif.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 text-xs font-medium border border-purple-200">
                      {group.pif.length} PIF
                    </span>
                  )}
                  {trainerRevenue > 0 && (
                    <span className="text-xs font-semibold text-wcs-red">{fmtMoney(trainerRevenue)}/mo</span>
                  )}
                  {trainerPifRevenue > 0 && (
                    <span className="text-xs font-semibold text-purple-600">PIF {fmtMoney(trainerPifRevenue)}</span>
                  )}
                  {bookTotal > 0 && (
                    <span className="text-xs font-bold text-text-primary bg-bg px-2 py-0.5 rounded-full border border-border">Book Total {fmtMoney(bookTotal)}</span>
                  )}
                </div>
              </button>

              {/* Expanded client list */}
              {expanded && (
                <div className="border-t border-border">
                  {/* Recurring section */}
                  {group.recurring.length > 0 && (
                    <>
                      <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[11px] text-text-muted uppercase tracking-wide font-semibold bg-bg/50">
                        <span className="col-span-3">Client</span>
                        <span className="col-span-2">Club</span>
                        <span className="col-span-3">Service</span>
                        <span className="col-span-2">Frequency</span>
                        <span className="col-span-2 text-right">Monthly $</span>
                      </div>
                      {group.recurring
                        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                        .map(c => (
                          <div key={c.memberId} className="grid grid-cols-12 gap-2 px-5 py-2 text-sm border-t border-border/50 items-center">
                            <span className="col-span-3 text-text-primary font-medium truncate">{capitalize(c.name)}</span>
                            <span className="col-span-2 text-text-muted text-xs">{c.clubName}</span>
                            <span className="col-span-3 text-text-muted text-xs truncate">
                              {c.services?.map(s => s.serviceItem).join(', ')}
                            </span>
                            <span
                              className="col-span-2 text-text-muted text-xs"
                              title={c.services?.[0]?.planName || ''}
                            >
                              {c.services?.[0]?.useFrequency || c.services?.[0]?.frequency || '—'}
                            </span>
                            <span className="col-span-2 text-right text-text-primary font-medium">{fmtMoney(c.monthlyRevenue)}</span>
                          </div>
                        ))}
                      <div className="grid grid-cols-12 gap-2 px-5 py-2 bg-bg/30 text-xs border-t border-border">
                        <span className="col-span-10 text-text-muted">Recurring subtotal — {group.recurring.length} clients</span>
                        <span className="col-span-2 text-right text-wcs-red font-bold">{fmtMoney(trainerRevenue)}/mo</span>
                      </div>
                    </>
                  )}

                  {/* PIF section */}
                  {group.pif.length > 0 && (
                    <>
                      <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[11px] text-text-muted uppercase tracking-wide font-semibold bg-purple-50/50 border-t border-border">
                        <span className="col-span-3">Client</span>
                        <span className="col-span-2">Club</span>
                        <span className="col-span-3">Package</span>
                        <span className="col-span-2">Sessions Left</span>
                        <span className="col-span-2 text-right">Price</span>
                      </div>
                      {group.pif
                        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                        .map(c => (
                          <div key={c.memberId} className="grid grid-cols-12 gap-2 px-5 py-2 text-sm border-t border-border/50 items-center">
                            <span className="col-span-3 text-text-primary font-medium truncate">{capitalize(c.name)}</span>
                            <span className="col-span-2 text-text-muted text-xs">{c.clubName}</span>
                            <span className="col-span-3 text-text-muted text-xs truncate">{c.service?.serviceItem || '—'}</span>
                            <span className="col-span-2 text-text-muted text-xs">
                              {c.service?.sessionsLeft ?? '—'} / {c.service?.totalBought ?? '—'}
                            </span>
                            <span className="col-span-2 text-right text-purple-600 font-medium">{fmtMoney(c.service?.purchasePrice)}</span>
                          </div>
                        ))}
                      <div className="grid grid-cols-12 gap-2 px-5 py-2 bg-purple-50/30 text-xs border-t border-border">
                        <span className="col-span-10 text-text-muted">PIF subtotal — {group.pif.length} clients</span>
                        <span className="col-span-2 text-right text-purple-600 font-bold">{fmtMoney(trainerPifRevenue)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {data.errors?.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-600 mb-1">Some locations had errors:</p>
          {data.errors.map((e, i) => (
            <p key={i} className="text-xs text-red-500">{e.club}: {e.error}</p>
          ))}
        </div>
      )}
    </div>
  )
}
