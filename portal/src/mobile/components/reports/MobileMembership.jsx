import React, { useState, useEffect, useMemo } from 'react'
import { getMembershipReport } from '../../../lib/api'
import MobileLoading from '../MobileLoading'

const SORT_OPTIONS = [
  { key: 'az', label: 'A-Z' },
  { key: 'sales', label: 'Top Sales' },
  { key: 'vips', label: 'Top VIPs' },
  { key: 'day_one', label: 'Top Day One' },
  { key: 'same_day', label: 'Top Same Day' },
]

function buildChartData(byDate, startDate, endDate) {
  const end = endDate ? new Date(endDate) : new Date()
  const start = startDate ? new Date(startDate) : new Date()
  const dateMap = {}
  for (const d of (byDate || [])) dateMap[d.date] = d
  const points = []
  const cur = new Date(start)
  while (cur <= end) {
    const dateStr = cur.toISOString().split('T')[0]
    const entry = dateMap[dateStr] || {}
    points.push({ date: dateStr, memberships: entry.memberships || 0, vips: entry.vips || 0, day_ones: entry.day_ones || 0 })
    cur.setDate(cur.getDate() + 1)
  }
  return points
}

function MiniLineChart({ points }) {
  if (!points.length) return null
  const maxVal = Math.max(1, ...points.map(p => Math.max(p.memberships, p.vips, p.day_ones)))
  const w = 400, h = 120, pad = 10

  function toPath(field, color) {
    const pathPoints = points.map((p, i) => {
      const x = pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2)
      const y = h - pad - (p[field] / maxVal) * (h - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    return <path d={pathPoints.join(' ')} fill="none" stroke={color} strokeWidth="2" />
  }

  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <div className="flex gap-4 mb-2">
        <span className="flex items-center gap-1 text-xs"><span className="w-3 h-0.5 bg-wcs-red inline-block" /> Sales</span>
        <span className="flex items-center gap-1 text-xs"><span className="w-3 h-0.5 bg-purple-500 inline-block" /> VIPs</span>
        <span className="flex items-center gap-1 text-xs"><span className="w-3 h-0.5 bg-green-500 inline-block" /> Day Ones</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
        {toPath('memberships', '#e53e3e')}
        {toPath('vips', '#805ad5')}
        {toPath('day_ones', '#38a169')}
      </svg>
      <div className="flex justify-between text-[10px] text-text-muted mt-1">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  )
}

export default function MobileMembership({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('az')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setData(null)
    setLoading(true)
    setError(null)
    const params = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
    getMembershipReport(params)
      .then(res => { if (!cancelled) setData(res) })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load report') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, locationSlug])

  const chartPoints = useMemo(() => buildChartData(data?.by_date, startDate, endDate), [data?.by_date, startDate, endDate])

  // Transform by_salesperson object to array
  const salespeople = useMemo(() => {
    return Object.entries(data?.by_salesperson || {}).map(([name, stats]) => ({
      name,
      total_sales: stats.total_sales || 0,
      vips: stats.vips || 0,
      day_one_booked: stats.day_one_booked || 0,
      same_day_sale: stats.same_day_sale || 0,
    }))
  }, [data?.by_salesperson])

  const sortedSalespeople = useMemo(() => {
    let list = [...salespeople]
    const q = search.toLowerCase()
    if (q) list = list.filter(s => s.name.toLowerCase().includes(q))
    switch (sortKey) {
      case 'az': list.sort((a, b) => a.name.localeCompare(b.name)); break
      case 'sales': list.sort((a, b) => b.total_sales - a.total_sales); break
      case 'vips': list.sort((a, b) => b.vips - a.vips); break
      case 'day_one': list.sort((a, b) => b.day_one_booked - a.day_one_booked); break
      case 'same_day': list.sort((a, b) => b.same_day_sale - a.same_day_sale); break
    }
    // Push "Unassigned" to bottom
    list.sort((a, b) => (a.name === 'Unassigned' ? 1 : 0) - (b.name === 'Unassigned' ? 1 : 0))
    return list
  }, [salespeople, sortKey, search])

  const totals = useMemo(() => {
    return {
      total_sales: data?.total_memberships || 0,
      vips: data?.total_vips || 0,
      day_one_booked: data?.total_day_one_booked || 0,
      same_day_sale: salespeople.reduce((s, p) => s + p.same_day_sale, 0),
      trial_rate: data?.trial_conversion?.rate || 0,
      trial_won: data?.trial_conversion?.won || 0,
      trial_started: data?.trial_conversion?.trial_started || 0,
    }
  }, [data, salespeople])


  if (loading) return <MobileLoading count={3} />

  if (error) return (
    <div className="p-4">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    </div>
  )

  return (
    <div className="p-4 space-y-3">
      {/* Stat cards - horizontal scroll */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 min-w-max">
          <StatCard label="Total Sales" value={totals.total_sales} />
          <StatCard label="Trial Conversion" value={`${totals.trial_rate}%`} sub={`${totals.trial_won}/${totals.trial_started}`} />
          <StatCard label="Day One Booked" value={totals.day_one_booked} />
          <StatCard label="Total VIPs" value={totals.vips} />
          <StatCard label="Same Day Sales" value={totals.same_day_sale} />
        </div>
      </div>

      {/* Line chart */}
      <MiniLineChart points={chartPoints} />

      {/* Sort pills */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSortKey(opt.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                sortKey === opt.key
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search salesperson..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-text-muted"
      />

      {/* Salesperson cards */}
      <div className="space-y-2">
        {sortedSalespeople.map(sp => (
          <div key={sp.name || sp.id} className="bg-surface rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-text-primary mb-2">{sp.name || 'Unknown'}</p>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-wcs-red border border-red-200">
                Sales: {sp.total_sales}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                VIPs: {sp.vips}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                Day One: {sp.day_one_booked}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                Same Day: {sp.same_day_sale}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="bg-surface rounded-2xl border-2 border-wcs-red p-4">
        <p className="text-sm font-bold text-text-primary mb-2">Total</p>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-wcs-red border border-red-200">
            Sales: {totals.total_sales}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
            VIPs: {totals.vips}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
            Day One: {totals.day_one_booked}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
            Same Day: {totals.same_day_sale}
          </span>
        </div>
      </div>

    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div className="min-w-[140px] bg-surface rounded-2xl border border-border p-4 flex-shrink-0">
      <p className="text-3xl font-bold text-text-primary">{value}</p>
      {sub && <p className="text-xs text-text-secondary mt-0.5">{sub}</p>}
      <p className="text-xs text-text-muted uppercase mt-1">{label}</p>
    </div>
  )
}
