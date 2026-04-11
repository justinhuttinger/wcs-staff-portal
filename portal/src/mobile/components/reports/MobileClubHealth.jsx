import React, { useState, useEffect } from 'react'
import { getClubHealthReport } from '../../../lib/api'

const PIE_COLORS = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5', '#dd6b20', '#319795']

function PieChart({ title, data, colorMap }) {
  const entries = Object.entries(data || {}).filter(([, v]) => v > 0)
  const total = entries.reduce((sum, [, v]) => sum + v, 0)
  if (total === 0) return (
    <div className="bg-surface rounded-2xl border border-border p-4 text-center">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{title}</p>
      <p className="text-sm text-text-muted">No data</p>
    </div>
  )

  function getColor(label, i) { return colorMap?.[label] || PIE_COLORS[i % PIE_COLORS.length] }

  let cumulative = 0
  const stops = entries.map(([label, count], i) => {
    const start = cumulative
    cumulative += (count / total) * 360
    return `${getColor(label, i)} ${start}deg ${cumulative}deg`
  })

  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{title}</p>
      <div className="flex items-center gap-4">
        <div className="w-24 h-24 rounded-full flex-shrink-0" style={{ background: `conic-gradient(${stops.join(', ')})` }} />
        <div className="space-y-1.5">
          {entries.map(([label, count], i) => (
            <div key={label} className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(label, i) }} />
              <span className="text-text-muted">{label}</span>
              <span className="font-semibold text-text-primary">{count}</span>
              <span className="text-text-muted">({Math.round((count / total) * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function MobileClubHealth({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
    getClubHealthReport(params)
      .then(res => { if (!cancelled) setData(res) })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load report') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, locationSlug])

  if (loading) return (
    <div className="p-4 space-y-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-surface rounded-2xl border border-border p-4 animate-pulse">
          <div className="h-4 bg-bg rounded w-1/3 mb-2" />
          <div className="h-8 bg-bg rounded w-1/2" />
        </div>
      ))}
    </div>
  )

  if (error) return (
    <div className="p-4">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    </div>
  )

  if (!data) return null

  const totalMemberships = data.total_memberships || 0
  const sameDayRatio = {
    'Same Day': data.total_same_day_sales || 0,
    'Other': Math.max(0, totalMemberships - (data.total_same_day_sales || 0)),
  }

  return (
    <div className="space-y-3">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Memberships Sold" value={totalMemberships} />
        <StatCard label="Total VIPs" value={data.total_vips || 0} />
        <StatCard label="Same Day Sales" value={data.total_same_day_sales || 0} />
        <StatCard label="Day Ones Booked" value={data.total_day_ones_booked || 0} />
      </div>

      {/* Pie charts */}
      <PieChart title="Day One Booked" data={data.day_one_booked} colorMap={{ 'Yes': '#38a169', 'No': '#e53e3e' }} />
      <PieChart title="Day One Status" data={data.day_one_status} />
      <PieChart title="Day One Sale" data={data.day_one_sale} colorMap={{ 'Sale': '#38a169', 'No Sale': '#e53e3e' }} />

      {/* Same Day Sales Ratio */}
      <PieChart
        title="Same Day Sales to Memberships"
        data={sameDayRatio}
        colorMap={{ 'Same Day': '#38a169', 'Other': '#e2e4e8' }}
      />
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-3xl font-bold text-text-primary">{value}</p>
      <p className="text-xs text-text-muted uppercase mt-1">{label}</p>
    </div>
  )
}
