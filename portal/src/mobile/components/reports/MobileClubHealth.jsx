import React, { useState, useEffect } from 'react'
import { getClubHealthReport } from '../../../lib/api'
import MobileLoading from '../MobileLoading'

const PIE_COLORS = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5', '#dd6b20', '#319795']

const STATUS_COLORS = {
  'Scheduled': '#d69e2e', 'scheduled': '#d69e2e',
  'Completed': '#38a169', 'completed': '#38a169',
  'Show': '#38a169',
  'No Show': '#805ad5', 'No-Show': '#805ad5', 'no show': '#805ad5',
  'Cancelled': '#e53e3e', 'Canceled': '#e53e3e', 'cancelled': '#e53e3e',
}

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
        <div className="space-y-1.5 min-w-0 flex-1">
          {entries.map(([label, count], i) => (
            <div key={label} className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(label, i) }} />
              <span className="text-text-muted truncate">{label}</span>
              <span className="font-semibold text-text-primary ml-auto">{count}</span>
              <span className="text-text-muted">({Math.round((count / total) * 100)}%)</span>
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
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{title}</p>
      {list.length === 0 ? (
        <p className="text-sm text-text-muted py-2 text-center">No data</p>
      ) : (
        <div className="space-y-2">
          {list.map((p, i) => (
            <div key={p.name} className="flex items-center gap-3 p-2 rounded-xl bg-bg border border-border">
              <div
                className="flex items-center justify-center w-8 h-8 rounded-full text-white text-[10px] font-bold flex-shrink-0"
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
    return Object.entries(map).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date))
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

function BarChart({ title, points }) {
  const total = points.reduce((s, p) => s + p.count, 0)

  if (points.length === 0 || total === 0) {
    return (
      <div className="bg-surface rounded-2xl border border-border p-4 text-center">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{title}</p>
        <p className="text-sm text-text-muted">No data</p>
      </div>
    )
  }

  const max = Math.max(...points.map(p => p.count), 1)
  const w = 600, h = 180, padL = 30, padR = 10, padT = 10, padB = 25
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const barW = chartW / points.length
  const yLabels = [0, Math.round(max / 2), max]

  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{title}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '180px' }}>
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
                <rect x={x + 1} y={padT + chartH - bh} width={Math.max(1, barW - 2)} height={bh} fill="#e53e3e" rx="1" />
              )}
            </g>
          )
        })}
        <text x={padL} y={h - 5} textAnchor="start" className="fill-gray-400" style={{ fontSize: '8px' }}>{points[0].date}</text>
        <text x={w - padR} y={h - 5} textAnchor="end" className="fill-gray-400" style={{ fontSize: '8px' }}>{points[points.length - 1].date}</text>
      </svg>
    </div>
  )
}

function MembershipTypeTable({ title, rows }) {
  const list = rows || []
  const totalMembers = list.reduce((s, r) => s + (r.members || 0), 0)
  const totalAgreements = list.reduce((s, r) => s + (r.agreements || 0), 0)
  const max = list.reduce((m, r) => Math.max(m, r.members || 0), 0)

  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{title}</p>
      {list.length === 0 || totalMembers === 0 ? (
        <p className="text-sm text-text-muted py-2 text-center">No data</p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-[10px] font-semibold text-text-muted uppercase tracking-wide pb-1.5 border-b border-border mb-1.5">
            <span>Type</span>
            <span className="text-right whitespace-nowrap">Mem</span>
            <span className="text-right whitespace-nowrap pl-2">Agr</span>
          </div>
          <div className="space-y-1.5">
            {list.map(r => {
              const barPct = max > 0 ? ((r.members || 0) / max) * 100 : 0
              const pct = totalMembers > 0 ? ((r.members || 0) / totalMembers) * 100 : 0
              return (
                <div key={r.membership_type} className="space-y-0.5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs">
                    <span className="text-text-primary truncate" title={r.membership_type}>{r.membership_type}</span>
                    <span className="text-right tabular-nums whitespace-nowrap">
                      <span className="font-semibold text-text-primary">{r.members || 0}</span>
                      <span className="text-[10px] text-text-muted ml-1">({pct.toFixed(0)}%)</span>
                    </span>
                    <span className="text-right tabular-nums whitespace-nowrap pl-2 text-text-muted">{r.agreements || 0}</span>
                  </div>
                  <div className="relative h-1.5 bg-bg rounded-full border border-border overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-wcs-red/80" style={{ width: `${barPct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs pt-2 mt-2 border-t border-border font-semibold">
            <span className="text-text-primary">Total</span>
            <span className="text-right tabular-nums whitespace-nowrap text-text-primary">{totalMembers}</span>
            <span className="text-right tabular-nums whitespace-nowrap pl-2 text-text-primary">{totalAgreements}</span>
          </div>
        </>
      )}
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="bg-surface/95 backdrop-blur-sm rounded-lg border border-border px-3 py-1.5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-4 text-center">
      <p className="text-3xl font-bold text-text-primary">{value}</p>
      <p className="text-[11px] text-text-muted uppercase tracking-wide mt-1">{label}</p>
    </div>
  )
}

export default function MobileClubHealth({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
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

  if (loading) return <MobileLoading variant="report" className="px-0 py-0" />

  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
      <p className="text-sm text-red-600">{error}</p>
    </div>
  )

  if (!data) return null

  const totalMemberships = data.total_memberships || 0
  const totalAgreements = data.total_agreements || 0

  // Set / Show / Close metrics
  const dayOneSet = data.total_day_ones_booked || 0
  const dayOneStatus = data.day_one_status || {}
  const dayOneSale = data.day_one_sale || {}
  const dayOneShow = (dayOneStatus['Completed'] || 0) + (dayOneStatus['Show'] || 0)
  const dayOneClose = dayOneSale['Sale'] || 0
  const showRate = dayOneSet > 0 ? Math.round((dayOneShow / dayOneSet) * 100) : 0
  const closeRate = dayOneShow > 0 ? Math.round((dayOneClose / dayOneShow) * 100) : 0

  const sameDayRatio = {
    'Same Day': data.total_same_day_sales || 0,
    'Other': Math.max(0, totalAgreements - (data.total_same_day_sales || 0)),
  }

  return (
    <div className="space-y-4">
      {/* ---------- ACTIVE MEMBERS (full roster, not date-filtered) ---------- */}
      <SectionHeader title="Active Members" />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Members" value={data.active_members_total ?? 0} />
        <StatCard label="Total Agreements" value={data.active_agreements_total ?? 0} />
      </div>

      <MembershipTypeTable title="Active Members by Membership Type" rows={data.active_by_membership_type} />

      {/* ---------- MEMBERSHIP (date-filtered new sales) ---------- */}
      <SectionHeader title="Membership" />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Agreements" value={totalAgreements} />
        <StatCard label="Members" value={totalMemberships} />
        <StatCard label="Total VIPs" value={data.total_vips || 0} />
        <StatCard label="Same Day Sales" value={data.total_same_day_sales || 0} />
      </div>

      <TopPerformers title="Top 3 Salespeople" units="pts" performers={data.top_salespeople} />

      <PieChart
        title="Same Day Sales to Memberships"
        data={sameDayRatio}
        colorMap={{ 'Same Day': '#38a169', 'Other': '#e2e4e8' }}
      />

      <BarChart title="Memberships by Day" points={buildDailyPoints(data.by_date, startDate, endDate)} />

      <MembershipTypeTable title="Sales by Membership Type" rows={data.by_membership_type} />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Cancels (Members)" value={data.cancels_members ?? 0} />
        <StatCard label="Cancels (Agreements)" value={data.cancels_agreements ?? 0} />
        <div className="bg-surface rounded-2xl border border-border p-4 text-center">
          <p className={`text-3xl font-bold ${(data.net_change_members ?? 0) >= 0 ? 'text-green-600' : 'text-wcs-red'}`}>
            {(data.net_change_members ?? 0) >= 0 ? '+' : ''}{data.net_change_members ?? 0}
          </p>
          <p className="text-[11px] text-text-muted uppercase tracking-wide mt-1">Net Change (Members)</p>
        </div>
        <div className="bg-surface rounded-2xl border border-border p-4 text-center">
          <p className={`text-3xl font-bold ${(data.net_change_agreements ?? 0) >= 0 ? 'text-green-600' : 'text-wcs-red'}`}>
            {(data.net_change_agreements ?? 0) >= 0 ? '+' : ''}{data.net_change_agreements ?? 0}
          </p>
          <p className="text-[11px] text-text-muted uppercase tracking-wide mt-1">Net Change (Agreements)</p>
        </div>
      </div>

      {/* ---------- PT / DAY ONE ---------- */}
      <SectionHeader title="PT / Day One" />

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface rounded-2xl border border-border p-4 text-center">
          <p className="text-3xl font-bold text-text-primary">{dayOneSet}</p>
          <p className="text-[11px] text-text-muted uppercase tracking-wide mt-1">Set</p>
          <p className="text-[10px] text-text-muted mt-0.5">Day Ones Booked</p>
        </div>
        <div className="bg-surface rounded-2xl border border-border p-4 text-center">
          <p className="text-3xl font-bold text-text-primary">{dayOneShow}</p>
          <p className="text-[11px] text-text-muted uppercase tracking-wide mt-1">Show</p>
          <p className="text-[10px] text-text-muted mt-0.5">{showRate}% of set</p>
        </div>
        <div className="bg-surface rounded-2xl border border-border p-4 text-center">
          <p className="text-3xl font-bold text-text-primary">{dayOneClose}</p>
          <p className="text-[11px] text-text-muted uppercase tracking-wide mt-1">Close</p>
          <p className="text-[10px] text-text-muted mt-0.5">{closeRate}% of shown</p>
        </div>
      </div>

      <TopPerformers title="Top 3 Trainers" units="closes" performers={data.top_trainers} />

      <PieChart title="Day One Booked" data={data.day_one_booked} colorMap={{ 'Yes': '#38a169', 'No': '#e53e3e' }} />
      <PieChart title="Day One Status" data={data.day_one_status} colorMap={STATUS_COLORS} />
      <PieChart title="Day One Sale" data={data.day_one_sale} colorMap={{ 'Sale': '#38a169', 'No Sale': '#e53e3e' }} />
    </div>
  )
}
