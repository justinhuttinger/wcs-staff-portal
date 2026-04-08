import { useState, useEffect } from 'react'
import { getClubHealthReport } from '../../lib/api'

const PIE_COLORS = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5', '#dd6b20', '#319795']

function PieChart({ title, data, colorMap }) {
  const entries = Object.entries(data || {}).filter(([, v]) => v > 0)
  const total = entries.reduce((sum, [, v]) => sum + v, 0)
  if (total === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-6 text-center">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</p>
        <p className="text-sm text-text-muted py-4">No data</p>
      </div>
    )
  }

  function getColor(label, i) {
    if (colorMap && colorMap[label]) return colorMap[label]
    return PIE_COLORS[i % PIE_COLORS.length]
  }

  let cumulative = 0
  const stops = entries.map(([label, count], i) => {
    const start = cumulative
    cumulative += (count / total) * 360
    return `${getColor(label, i)} ${start}deg ${cumulative}deg`
  })

  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</p>
      <div className="flex items-center gap-6">
        <div
          className="w-32 h-32 rounded-full flex-shrink-0"
          style={{ background: `conic-gradient(${stops.join(', ')})` }}
        />
        <div className="space-y-2">
          {entries.map(([label, count], i) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(label, i) }} />
              <span className="text-text-muted">{label}</span>
              <span className="font-semibold text-text-primary">{count}</span>
              <span className="text-text-muted text-xs">({Math.round((count / total) * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ClubHealthReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { loadData() }, [startDate, endDate, locationSlug])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      const res = await getClubHealthReport(params)
      setData(res)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading club health data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  const totalMemberships = data.total_memberships || 0

  // Ratio pie
  const sameDayRatio = { 'Same Day': data.total_same_day_sales || 0, 'Other': Math.max(0, totalMemberships - (data.total_same_day_sales || 0)) }

  return (
    <div className="space-y-6">
      {/* Big Number Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Memberships Sold</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{totalMemberships}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total VIPs</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.total_vips}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Same Day Sales</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.total_same_day_sales}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Day Ones Booked</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.total_day_ones_booked}</p>
        </div>
      </div>

      {/* Day One Pie Charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PieChart title="Day One Booked" data={data.day_one_booked} colorMap={{ 'Yes': '#38a169', 'No': '#e53e3e' }} />
        <PieChart title="Day One Status" data={data.day_one_status} />
        <PieChart title="Day One Sale" data={data.day_one_sale} colorMap={{ 'Sale': '#38a169', 'No Sale': '#e53e3e' }} />
      </div>

      {/* Same Day Sales Ratio */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PieChart title="Same Day Sales to Memberships" data={sameDayRatio} colorMap={{ 'Same Day': '#38a169', 'Other': '#e2e8f0' }} />
      </div>
    </div>
  )
}
