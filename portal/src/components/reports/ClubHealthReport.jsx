import { useState, useEffect, useRef } from 'react'
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

const MEDAL_COLORS = ['#d4af37', '#9aa1a8', '#a8722c']
const MEDAL_LABELS = ['1st', '2nd', '3rd']

function TopPerformers({ title, units, performers }) {
  const list = performers || []
  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</p>
      {list.length === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">No data</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {list.map((p, i) => (
            <div key={p.name} className="flex items-center gap-3 p-3 rounded-lg bg-bg border border-border">
              <div
                className="flex items-center justify-center w-9 h-9 rounded-full text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: MEDAL_COLORS[i] || '#a8722c' }}
              >
                {MEDAL_LABELS[i] || `${i + 1}`}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text-primary truncate">{p.name}</p>
                <p className="text-xs text-text-muted">{p.count} {units}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

export default function ClubHealthReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const requestRef = useRef(0)

  useEffect(() => {
    const id = ++requestRef.current
    setData(null)
    setLoading(true)
    setError('')
    const params = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
    getClubHealthReport(params).then(res => {
      if (id === requestRef.current) { setData(res); setLoading(false) }
    }).catch(err => {
      if (id === requestRef.current) { setError(err.message); setLoading(false) }
    })
  }, [startDate, endDate, locationSlug])

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading club health data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  const totalMemberships = data.total_memberships || 0
  const totalAgreements = data.total_agreements || 0

  // Set / Show / Close metrics from day one data
  const dayOneSet = data.total_day_ones_booked || 0
  const dayOneStatus = data.day_one_status || {}
  const dayOneSale = data.day_one_sale || {}
  const dayOneShow = (dayOneStatus['Completed'] || 0) + (dayOneStatus['Show'] || 0)
  const dayOneClose = dayOneSale['Sale'] || 0
  const showRate = dayOneSet > 0 ? Math.round((dayOneShow / dayOneSet) * 100) : 0
  const closeRate = dayOneShow > 0 ? Math.round((dayOneClose / dayOneShow) * 100) : 0

  // Ratio pie
  const sameDayRatio = { 'Same Day': data.total_same_day_sales || 0, 'Other': Math.max(0, totalAgreements - (data.total_same_day_sales || 0)) }

  return (
    <div className="space-y-6">
      {/* ---------- MEMBERSHIP ---------- */}
      <SectionHeader title="Membership" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Agreements</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{totalAgreements}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Members</p>
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
      </div>

      <TopPerformers title="Top 3 Salespeople" units="memberships" performers={data.top_salespeople} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PieChart title="Same Day Sales to Memberships" data={sameDayRatio} colorMap={{ 'Same Day': '#38a169', 'Other': '#e2e8f0' }} />
      </div>

      {/* ---------- PT / DAY ONE ---------- */}
      <SectionHeader title="PT / Day One" />

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Set</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{dayOneSet}</p>
          <p className="text-[11px] text-text-muted mt-1">Day Ones Booked</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Show</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{dayOneShow}</p>
          <p className="text-[11px] text-text-muted mt-1">{showRate}% of set</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Close</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{dayOneClose}</p>
          <p className="text-[11px] text-text-muted mt-1">{closeRate}% of shown</p>
        </div>
      </div>

      <TopPerformers title="Top 3 Trainers" units="closes" performers={data.top_trainers} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PieChart title="Day One Booked" data={data.day_one_booked} colorMap={{ 'Yes': '#38a169', 'No': '#e53e3e' }} />
        <PieChart title="Day One Status" data={data.day_one_status} />
        <PieChart title="Day One Sale" data={data.day_one_sale} colorMap={{ 'Sale': '#38a169', 'No Sale': '#e53e3e' }} />
      </div>
    </div>
  )
}
