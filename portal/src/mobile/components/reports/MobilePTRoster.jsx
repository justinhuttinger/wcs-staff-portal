import React, { useState, useEffect, useRef } from 'react'
import { getPTRoster } from '../../../lib/api'

function fmtMoney(val) {
  const n = parseFloat(val)
  if (!n) return '—'
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

export default function MobilePTRoster({ locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [expandedTrainer, setExpandedTrainer] = useState(null)
  const requestRef = useRef(0)

  useEffect(() => {
    const id = ++requestRef.current
    setData(null)
    setLoading(true)
    setError(null)
    setTypeFilter('all')
    setExpandedTrainer(null)
    getPTRoster({ location_slug: locationSlug || 'all' }).then(res => {
      if (id === requestRef.current) { setData(res); setLoading(false) }
    }).catch(err => {
      if (id === requestRef.current) { setError(err.message); setLoading(false) }
    })
  }, [locationSlug])

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      <div className="w-6 h-6 border-2 border-wcs-red border-t-transparent rounded-full animate-spin" />
      <p className="text-text-muted text-xs">Loading PT roster from ABC Financial...</p>
    </div>
  )

  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
      <p className="text-sm text-red-600">{error}</p>
    </div>
  )

  if (!data) return null

  const { clients, summary } = data

  let filtered = clients
  if (typeFilter !== 'all') filtered = filtered.filter(c => c.clientType === typeFilter)

  // Group by trainer
  const trainerMap = {}
  for (const c of filtered) {
    const t = c.trainer || 'Unassigned'
    if (!trainerMap[t]) trainerMap[t] = { recurring: [], pif: [] }
    if (c.clientType === 'recurring') trainerMap[t].recurring.push(c)
    else trainerMap[t].pif.push(c)
  }

  const trainerNames = Object.keys(trainerMap).sort((a, b) => {
    if (a === 'Unassigned') return 1
    if (b === 'Unassigned') return -1
    return a.localeCompare(b)
  })

  return (
    <div className="space-y-3">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Active PT Clients" value={summary.totalClients} />
        <StatCard label="Recurring" value={summary.recurring} />
        <StatCard label="PIF" value={summary.pif} />
        <StatCard label="Monthly Revenue" value={fmtMoney(summary.monthlyRevenue)} isRed />
      </div>

      {/* Filter pills */}
      <div className="flex gap-2">
        {[
          { key: 'all', label: 'All' },
          { key: 'recurring', label: 'Recurring' },
          { key: 'pif', label: 'PIF' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setTypeFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              typeFilter === f.key
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-surface text-text-muted border-border'
            }`}
          >{f.label}</button>
        ))}
      </div>

      <p className="text-xs text-text-muted">{filtered.length} clients across {trainerNames.length} trainers</p>

      {/* Trainer accordion */}
      <div className="space-y-2">
        {trainerNames.map(name => {
          const group = trainerMap[name]
          const total = group.recurring.length + group.pif.length
          const rev = group.recurring.reduce((s, c) => s + (c.monthlyRevenue || 0), 0)
          const pifRev = group.pif.reduce((s, c) => s + (c.service?.purchasePrice || 0), 0)
          const expanded = expandedTrainer === name

          return (
            <div key={name} className="bg-surface border border-border rounded-2xl overflow-hidden">
              <button
                onClick={() => setExpandedTrainer(expanded ? null : name)}
                className="w-full px-4 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  <span className="text-sm font-bold text-text-primary">{capitalize(name)}</span>
                  <span className="text-xs text-text-muted">{total}</span>
                </div>
                <div className="flex items-center gap-2">
                  {group.recurring.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-medium border border-blue-200">
                      {group.recurring.length} RS
                    </span>
                  )}
                  {group.pif.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 text-[10px] font-medium border border-purple-200">
                      {group.pif.length} PIF
                    </span>
                  )}
                </div>
              </button>

              {expanded && (
                <div className="border-t border-border">
                  {group.recurring.map(c => (
                    <div key={c.memberId} className="px-4 py-2.5 border-b border-border/50 last:border-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text-primary">{capitalize(c.name)}</span>
                        <span className="text-sm font-medium text-wcs-red">{fmtMoney(c.monthlyRevenue)}/mo</span>
                      </div>
                      <div className="flex gap-2 mt-0.5 text-[11px] text-text-muted">
                        <span>{c.clubName}</span>
                        <span>{c.services?.map(s => s.serviceItem).join(', ')}</span>
                      </div>
                    </div>
                  ))}
                  {group.pif.map(c => (
                    <div key={c.memberId} className="px-4 py-2.5 border-b border-border/50 last:border-0 bg-purple-50/30">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text-primary">{capitalize(c.name)}</span>
                        <span className="text-sm font-medium text-purple-600">{fmtMoney(c.service?.purchasePrice)}</span>
                      </div>
                      <div className="flex gap-2 mt-0.5 text-[11px] text-text-muted">
                        <span>{c.clubName}</span>
                        <span>{c.service?.serviceItem}</span>
                        <span>{c.service?.sessionsLeft ?? '—'}/{c.service?.totalBought ?? '—'} sessions</span>
                      </div>
                    </div>
                  ))}
                  {rev > 0 && (
                    <div className="px-4 py-2 bg-bg/50 flex justify-between text-xs">
                      <span className="text-text-muted">Revenue</span>
                      <span className="font-bold text-wcs-red">{fmtMoney(rev)}/mo + {fmtMoney(pifRev)} PIF</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {data.errors?.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3">
          <p className="text-xs font-semibold text-red-600 mb-1">Some locations had errors:</p>
          {data.errors.map((e, i) => (
            <p key={i} className="text-[11px] text-red-500">{e.club}: {e.error}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, isRed }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className={`text-2xl font-bold ${isRed ? 'text-wcs-red' : 'text-text-primary'}`}>{value}</p>
      <p className="text-xs text-text-muted uppercase mt-1">{label}</p>
    </div>
  )
}
