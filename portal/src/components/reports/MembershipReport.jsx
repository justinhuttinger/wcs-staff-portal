import { useState, useEffect } from 'react'
import { getMembershipReport } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'

const LINE_COLORS = { memberships: '#e53e3e', vips: '#805ad5', day_ones: '#38a169' }

function buildChartData(byDate, startDate, endDate) {
  const end = endDate ? new Date(endDate) : new Date()
  const start = startDate ? new Date(startDate) : new Date()

  // Build a map keyed by date string
  const dateMap = {}
  for (const d of byDate) {
    dateMap[d.date] = d
  }

  const points = []
  const cur = new Date(start)
  while (cur <= end) {
    const dateStr = cur.toISOString().split('T')[0]
    const entry = dateMap[dateStr] || {}
    points.push({
      date: dateStr,
      memberships: entry.memberships || 0,
      vips: entry.vips || 0,
      day_ones: entry.day_ones || 0,
    })
    cur.setDate(cur.getDate() + 1)
  }
  return points
}

function LineChart({ points }) {
  if (points.length === 0) return null

  const maxVal = Math.max(...points.flatMap(p => [p.memberships, p.vips, p.day_ones]), 1)
  const w = 600
  const h = 140
  const padL = 30
  const padR = 10
  const padT = 10
  const padB = 25
  const chartW = w - padL - padR
  const chartH = h - padT - padB

  function toX(i) { return padL + (points.length > 1 ? (i / (points.length - 1)) * chartW : chartW / 2) }
  function toY(v) { return padT + chartH - (v / maxVal) * chartH }

  function makePath(key) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p[key]).toFixed(1)}`).join(' ')
  }

  // Y-axis labels
  const yLabels = [0, Math.round(maxVal / 2), maxVal]

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center gap-4 mb-3">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Daily Trends</p>
        <div className="flex gap-3 ml-auto">
          {[['memberships', 'Memberships'], ['vips', 'VIPs'], ['day_ones', 'Day Ones']].map(([key, label]) => (
            <div key={key} className="flex items-center gap-1 text-xs text-text-muted">
              <div className="w-3 h-0.5 rounded" style={{ backgroundColor: LINE_COLORS[key] }} />
              {label}
            </div>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '160px' }}>
        {/* Grid lines */}
        {yLabels.map(v => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={toY(v)} y2={toY(v)} stroke="#e2e8f0" strokeWidth="0.5" />
            <text x={padL - 4} y={toY(v) + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: '8px' }}>{v}</text>
          </g>
        ))}
        {/* Lines */}
        {['memberships', 'vips', 'day_ones'].map(key => (
          <path key={key} d={makePath(key)} fill="none" stroke={LINE_COLORS[key]} strokeWidth="2" strokeLinejoin="round" />
        ))}
        {/* Hover zones per day — invisible rects with tooltips */}
        {points.map((p, i) => {
          const barW = points.length > 1 ? chartW / (points.length - 1) : chartW
          return (
            <rect
              key={`hover-${i}`}
              x={toX(i) - barW / 2}
              y={padT}
              width={barW}
              height={chartH}
              fill="transparent"
              className="cursor-crosshair"
            >
              <title>{p.date} — Memberships: {p.memberships}, VIPs: {p.vips}, Day Ones: {p.day_ones}</title>
            </rect>
          )
        })}
        {/* Dots */}
        {['memberships', 'vips', 'day_ones'].map(key =>
          points.map((p, i) => p[key] > 0 ? (
            <circle key={`${key}-${i}`} cx={toX(i)} cy={toY(p[key])} r="2.5" fill={LINE_COLORS[key]} className="pointer-events-none" />
          ) : null)
        )}
        {/* X-axis labels */}
        {points.length > 0 && (
          <>
            <text x={toX(0)} y={h - 5} textAnchor="start" className="fill-gray-400" style={{ fontSize: '8px' }}>{points[0].date}</text>
            <text x={toX(points.length - 1)} y={h - 5} textAnchor="end" className="fill-gray-400" style={{ fontSize: '8px' }}>{points[points.length - 1].date}</text>
          </>
        )}
      </svg>
    </div>
  )
}

export default function MembershipReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortBy, setSortBy] = useState('best')
  const [search, setSearch] = useState('')

  useEffect(() => { loadData() }, [startDate, endDate, locationSlug])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      const res = await getMembershipReport(params)
      setData(res)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading membership data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  const totalMemberships = data.total_memberships || 0
  const tc = data.trial_conversion || {}
  const trialRate = tc.rate || 0
  const dayOneBooked = data.total_day_one_booked || 0
  const totalVips = data.total_vips || 0

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

  // Sort, but always push "Unassigned" to the bottom
  if (sortBy === 'best') rows.sort((a, b) => b[1].total_sales - a[1].total_sales)
  else if (sortBy === 'worst') rows.sort((a, b) => a[1].total_sales - b[1].total_sales)
  else if (sortBy === 'alpha') rows.sort((a, b) => a[0].localeCompare(b[0]))
  rows.sort((a, b) => (a[0] === 'Unassigned' ? 1 : 0) - (b[0] === 'Unassigned' ? 1 : 0))

  const allRows = Object.entries(data.by_salesperson || {})
  const totalSales = allRows.reduce((sum, [, s]) => sum + (s.total_sales || 0), 0)
  const totalRowVips = allRows.reduce((sum, [, s]) => sum + (s.vips || 0), 0)
  const totalDayOne = allRows.reduce((sum, [, s]) => sum + (s.day_one_booked || 0), 0)
  const totalSameDay = allRows.reduce((sum, [, s]) => sum + (s.same_day_sale || 0), 0)

  const chartPoints = buildChartData(data.by_date || [], startDate, endDate)

  function handleExportCSV() {
    const csvRows = [
      ['Salesperson', 'Total Sales', 'VIPs', 'Day One', 'Same Day Sale'],
      ...rows.map(([name, s]) => [name, s.total_sales || 0, s.vips || 0, s.day_one_booked || 0, s.same_day_sale || 0]),
      ['Total', totalSales, totalRowVips, totalDayOne, totalSameDay],
    ]
    exportCSV(csvRows, `membership-report-${startDate}-${endDate}`)
  }

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total Sales</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalMemberships}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Trial Conversion</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{trialRate}%</p>
          <p className="text-xs text-text-muted mt-0.5">{tc.won || 0} / {tc.trial_started || 0}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Day One Booked</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{dayOneBooked}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total VIPs</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalVips}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Same Day Sales</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalSameDay}</p>
        </div>
      </div>

      {/* Line Chart */}
      <LineChart points={chartPoints} />

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
          <button onClick={handleExportCSV} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">CSV</button>
          <button onClick={() => exportPDF('Membership Report')} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">PDF</button>
        </div>
      </div>

      {/* Salesperson Table */}
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
              <tr key={name} className="border-b border-border hover:bg-bg/50 transition-colors">
                <td className="px-4 py-3 font-medium text-text-primary">{name}</td>
                <td className="px-4 py-3 text-center text-wcs-red font-semibold">{stats.total_sales || 0}</td>
                <td className="px-4 py-3 text-center text-text-primary">{stats.vips || 0}</td>
                <td className="px-4 py-3 text-center text-green-600">{stats.day_one_booked || 0}</td>
                <td className="px-4 py-3 text-center text-green-600">{stats.same_day_sale || 0}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">No data for this period</td>
              </tr>
            )}
            {rows.length > 0 && (
              <tr className="border-t-2 border-border font-bold bg-bg/30">
                <td className="px-4 py-3 text-text-primary">Total</td>
                <td className="px-4 py-3 text-center text-wcs-red">{totalSales}</td>
                <td className="px-4 py-3 text-center text-text-primary">{totalRowVips}</td>
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
