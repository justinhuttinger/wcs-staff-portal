import React, { useState, useEffect } from 'react'
import { getSalespersonStats } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'

export default function SalespersonStats({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortBy, setSortBy] = useState('best')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => { loadData() }, [startDate, endDate, locationSlug])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      const res = await getSalespersonStats(params)
      setData(res)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading salesperson data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  const SORT_OPTIONS = [
    { key: 'best', label: 'Top Performers' },
    { key: 'worst', label: 'Bottom Performers' },
    { key: 'alpha', label: 'A-Z' },
  ]

  let rows = Object.entries(data.by_salesperson || {})

  if (search) {
    const q = search.toLowerCase()
    rows = rows.filter(([name]) => name.toLowerCase().includes(q))
  }

  if (sortBy === 'best') rows.sort((a, b) => b[1].total_sales - a[1].total_sales)
  else if (sortBy === 'worst') rows.sort((a, b) => a[1].total_sales - b[1].total_sales)
  else if (sortBy === 'alpha') rows.sort((a, b) => a[0].localeCompare(b[0]))

  const allRows = Object.entries(data.by_salesperson || {})
  const totalSales = allRows.reduce((sum, [, s]) => sum + (s.total_sales || 0), 0)
  const totalVIPs = allRows.reduce((sum, [, s]) => sum + (s.vips || 0), 0)
  const totalDayOne = allRows.reduce((sum, [, s]) => sum + (s.day_one_booked || 0), 0)
  const totalSameDay = allRows.reduce((sum, [, s]) => sum + (s.same_day_sale || 0), 0)

  function handleExportCSV() {
    const csvRows = [
      ['Salesperson', 'Total Sales', 'VIPs', 'Day One', 'Same Day Sale'],
      ...rows.map(([name, s]) => [name, s.total_sales || 0, s.vips || 0, s.day_one_booked || 0, s.same_day_sale || 0]),
      ['Total', totalSales, totalVIPs, totalDayOne, totalSameDay],
    ]
    exportCSV(csvRows, `salesperson-stats-${startDate}-${endDate}`)
  }

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total Sales</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalSales}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total VIPs</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalVIPs}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Day One Booked</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalDayOne}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Same Day Sales</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalSameDay}</p>
        </div>
      </div>

      {/* Sort, Search & Export Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSortBy(opt.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                sortBy === opt.key
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-muted hover:text-text-primary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red w-48"
          />
          <button onClick={handleExportCSV} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">
            CSV
          </button>
          <button onClick={() => exportPDF('Salesperson Stats')} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">
            PDF
          </button>
        </div>
      </div>

      {/* Summary Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Salesperson</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Total Sales</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">VIPs</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Day One</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Same Day Sale</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, stats]) => (
              <React.Fragment key={name}>
                <tr
                  onClick={() => setExpanded(expanded === name ? null : name)}
                  className="border-b border-border hover:bg-bg/50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium text-text-primary flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-3 h-3 text-text-muted transition-transform ${expanded === name ? 'rotate-90' : ''}`}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                    {name}
                  </td>
                  <td className="px-4 py-3 text-center text-wcs-red font-semibold">{stats.total_sales || 0}</td>
                  <td className="px-4 py-3 text-center text-text-primary">{stats.vips || 0}</td>
                  <td className="px-4 py-3 text-center text-green-600">{stats.day_one_booked || 0}</td>
                  <td className="px-4 py-3 text-center text-green-600">{stats.same_day_sale || 0}</td>
                </tr>
                {expanded === name && stats.members && stats.members.length > 0 && (
                  <tr>
                    <td colSpan={5} className="px-0 py-0">
                      <div className="bg-bg/50 border-b border-border">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left px-6 py-2 text-text-muted uppercase font-semibold">Name</th>
                              <th className="text-left px-4 py-2 text-text-muted uppercase font-semibold">Type</th>
                              <th className="text-left px-4 py-2 text-text-muted uppercase font-semibold">Sign Date</th>
                              <th className="text-center px-4 py-2 text-text-muted uppercase font-semibold">Day One</th>
                              <th className="text-center px-4 py-2 text-text-muted uppercase font-semibold">VIPs</th>
                              <th className="text-center px-4 py-2 text-text-muted uppercase font-semibold">Same Day</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stats.members.map((m, i) => (
                              <tr key={i} className="border-b border-border last:border-0">
                                <td className="px-6 py-2 text-text-primary">{m.name}</td>
                                <td className="px-4 py-2 text-text-muted">{m.membership_type}</td>
                                <td className="px-4 py-2 text-text-muted">{m.since_date}</td>
                                <td className="px-4 py-2 text-center">{m.day_one_booked ? <span className="text-green-500">Yes</span> : <span className="text-text-muted">-</span>}</td>
                                <td className="px-4 py-2 text-center text-text-primary">{m.vip_count || '-'}</td>
                                <td className="px-4 py-2 text-center">{m.same_day_sale ? <span className="text-green-500">Yes</span> : <span className="text-text-muted">-</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">No data for this period</td>
              </tr>
            )}
            {rows.length > 0 && (
              <tr className="border-t-2 border-border font-bold bg-bg/30">
                <td className="px-4 py-3 text-text-primary pl-9">Total</td>
                <td className="px-4 py-3 text-center text-wcs-red">{totalSales}</td>
                <td className="px-4 py-3 text-center text-text-primary">{totalVIPs}</td>
                <td className="px-4 py-3 text-center text-green-600">{totalDayOne}</td>
                <td className="px-4 py-3 text-center text-green-600">{totalSameDay}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
