import { useState } from 'react'
import { getClubHealthReport } from '../../lib/api'
import MembershipTypeTable from './MembershipTypeTable'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatBlock, StatCell, ReportBlock } from './StatBlock'

const PIE_COLORS = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5', '#dd6b20', '#319795']

function PieChart({ title, data, colorMap, flush = false }) {
  const wrap = flush ? 'bg-surface p-6' : 'bg-surface rounded-xl border border-border p-6'
  const entries = Object.entries(data || {}).filter(([, v]) => v > 0)
  const total = entries.reduce((sum, [, v]) => sum + v, 0)
  if (total === 0) {
    return (
      <div className={`${wrap} text-center`}>
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
    <div className={wrap}>
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

function TopPerformers({ title, units, performers, flush = false }) {
  const list = performers || []
  return (
    <div className={flush ? 'bg-surface p-6' : 'bg-surface rounded-xl border border-border p-6'}>
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

function buildDailyPoints(byDate, startDate, endDate) {
  const map = {}
  for (const d of (byDate || [])) map[d.date] = d.memberships || 0
  if (!startDate || !endDate) {
    return Object.entries(map)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }
  const points = []
  const cur = new Date(startDate)
  const end = new Date(endDate)
  while (cur <= end) {
    const dateStr = cur.toISOString().slice(0, 10)
    points.push({ date: dateStr, count: map[dateStr] || 0 })
    cur.setDate(cur.getDate() + 1)
  }
  return points
}

function BarChart({ title, points, flush = false }) {
  const wrap = flush ? 'bg-surface p-6' : 'bg-surface rounded-xl border border-border p-6'
  const [hover, setHover] = useState(null)
  const total = points.reduce((s, p) => s + p.count, 0)

  if (points.length === 0 || total === 0) {
    return (
      <div className={`${wrap} text-center`}>
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</p>
        <p className="text-sm text-text-muted py-4">No data</p>
      </div>
    )
  }

  const max = Math.max(...points.map(p => p.count), 1)
  const w = 600, h = 180, padL = 30, padR = 10, padT = 10, padB = 25
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const barW = chartW / points.length
  const yLabels = [0, Math.round(max / 2), max]
  const hovered = hover !== null ? points[hover] : null

  return (
    <div className={wrap}>
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{title}</p>
      <div className="h-5 mb-1 text-xs text-text-muted">
        {hovered && (
          <span>
            <span className="font-medium text-text-primary">{hovered.date}</span>
            {' — '}
            <span style={{ color: '#e53e3e' }}>{hovered.count} memberships</span>
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        style={{ maxHeight: '200px' }}
        onMouseLeave={() => setHover(null)}
      >
        {yLabels.map(v => {
          const y = padT + chartH - (v / max) * chartH
          return (
            <g key={v}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="0.5" />
              <text x={padL - 4} y={y + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: '8px' }}>{v}</text>
            </g>
          )
        })}
        {points.map((p, i) => {
          const x = padL + i * barW
          const bh = (p.count / max) * chartH
          return (
            <g key={i}>
              {p.count > 0 && (
                <rect
                  x={x + 1}
                  y={padT + chartH - bh}
                  width={Math.max(1, barW - 2)}
                  height={bh}
                  fill="#e53e3e"
                  rx="1"
                  opacity={hover === i ? 1 : 0.85}
                />
              )}
              <rect
                x={x}
                y={0}
                width={barW}
                height={h}
                fill="transparent"
                style={{ cursor: 'crosshair' }}
                onMouseEnter={() => setHover(i)}
              />
            </g>
          )
        })}
        <text x={padL} y={h - 5} textAnchor="start" className="fill-gray-400" style={{ fontSize: '8px' }}>{points[0].date}</text>
        <text x={w - padR} y={h - 5} textAnchor="end" className="fill-gray-400" style={{ fontSize: '8px' }}>{points[points.length - 1].date}</text>
      </svg>
    </div>
  )
}

const STATUS_COLORS = {
  'Scheduled': '#d69e2e', 'scheduled': '#d69e2e',
  'Completed': '#38a169', 'completed': '#38a169',
  'Show': '#38a169',
  'No Show': '#805ad5', 'No-Show': '#805ad5', 'no show': '#805ad5',
  'Cancelled': '#e53e3e', 'Canceled': '#e53e3e', 'cancelled': '#e53e3e',
}

function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="bg-surface/95 backdrop-blur-sm rounded-lg border border-border px-3 py-1.5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

export default function ClubHealthReport({ startDate, endDate, locationSlug }) {
  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getClubHealthReport(params, { cache: true, signal })
    },
    [startDate, endDate, locationSlug]
  )

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>
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
    <ReportBlock>
      {/* ---------- ACTIVE MEMBERS (full roster, not date-filtered) ---------- */}
      <div>
        <Heading>Active Members</Heading>
        <StatBlock cols={2} flush>
          <StatCell label="Total Members" value={data.active_members_total ?? 0} />
          <StatCell label="Total Agreements" value={data.active_agreements_total ?? 0} />
        </StatBlock>
      </div>

      <div className="px-5 sm:px-6 py-5">
        <MembershipTypeTable title="Active Members by Membership Type" rows={data.active_by_membership_type} flush />
      </div>

      {/* ---------- MEMBERSHIP (date-filtered new sales) ---------- */}
      <div>
        <Heading>Membership</Heading>
        <StatBlock cols={4} flush>
          <StatCell label="Agreements" value={totalAgreements} />
          <StatCell label="Members" value={totalMemberships} />
          <StatCell label="Total VIPs" value={data.total_vips} />
          <StatCell label="Same Day Sales" value={data.total_same_day_sales} />
        </StatBlock>
      </div>

      <TopPerformers title="Top 3 Salespeople" units="pts" performers={data.top_salespeople} flush />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
        <PieChart title="Same Day Sales to Memberships" data={sameDayRatio} colorMap={{ 'Same Day': '#38a169', 'Other': '#e2e8f0' }} flush />
        <BarChart title="Memberships by Day" points={buildDailyPoints(data.by_date, startDate, endDate)} flush />
      </div>

      <div className="px-5 sm:px-6 py-5">
        <MembershipTypeTable title="Sales by Membership Type" rows={data.by_membership_type} flush />
      </div>

      <StatBlock cols={4} flush>
        <StatCell label="Cancels (Members)" value={data.cancels_members ?? 0} />
        <StatCell label="Cancels (Agreements)" value={data.cancels_agreements ?? 0} />
        <StatCell
          label="Net Change (Members)"
          value={`${(data.net_change_members ?? 0) >= 0 ? '+' : ''}${data.net_change_members ?? 0}`}
          valueClassName={(data.net_change_members ?? 0) >= 0 ? 'text-green-600' : 'text-wcs-red'}
        />
        <StatCell
          label="Net Change (Agreements)"
          value={`${(data.net_change_agreements ?? 0) >= 0 ? '+' : ''}${data.net_change_agreements ?? 0}`}
          valueClassName={(data.net_change_agreements ?? 0) >= 0 ? 'text-green-600' : 'text-wcs-red'}
        />
      </StatBlock>

      {/* ---------- PT / DAY ONE ---------- */}
      <div>
        <Heading>PT / Day One</Heading>
        <StatBlock cols={3} flush>
          <StatCell label="Set" value={dayOneSet} sub="Day Ones Booked" />
          <StatCell label="Show" value={dayOneShow} sub={`${showRate}% of set`} />
          <StatCell label="Close" value={dayOneClose} sub={`${closeRate}% of shown`} />
        </StatBlock>
      </div>

      <TopPerformers title="Top 3 Trainers" units="closes" performers={data.top_trainers} flush />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border">
        <PieChart title="Day One Booked" data={data.day_one_booked} colorMap={{ 'Yes': '#38a169', 'No': '#e53e3e' }} flush />
        <PieChart title="Day One Status" data={data.day_one_status} colorMap={STATUS_COLORS} flush />
        <PieChart title="Day One Sale" data={data.day_one_sale} colorMap={{ 'Sale': '#38a169', 'No Sale': '#e53e3e' }} flush />
      </div>
    </ReportBlock>
  )
}

// Section heading inside the single report block.
function Heading({ children }) {
  return (
    <div className="px-5 sm:px-6 pt-4 pb-3">
      <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-text-primary">{children}</h3>
    </div>
  )
}
