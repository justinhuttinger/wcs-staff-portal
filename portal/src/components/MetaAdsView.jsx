import { useState, useEffect } from 'react'
import { getMetaAdsOverview, getMetaAdsCampaigns, getMetaAdsDaily } from '../lib/api'

const QUICK_RANGES = [
  { key: 'last_7', label: 'Last 7 Days' },
  { key: 'last_30', label: 'Last 30 Days' },
  { key: 'last_90', label: 'Last 90 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
]

function getQuickRange(key) {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  switch (key) {
    case 'last_7': { const s = new Date(now); s.setDate(s.getDate() - 7); return { start: s.toISOString().split('T')[0], end: today } }
    case 'last_30': { const s = new Date(now); s.setDate(s.getDate() - 30); return { start: s.toISOString().split('T')[0], end: today } }
    case 'last_90': { const s = new Date(now); s.setDate(s.getDate() - 90); return { start: s.toISOString().split('T')[0], end: today } }
    case 'this_month': return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0], end: today }
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: s.toISOString().split('T')[0], end: e.toISOString().split('T')[0] }
    }
    default: return { start: today, end: today }
  }
}

function fmtMoney(val) { return '$' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtNum(val) { return Number(val || 0).toLocaleString() }
function fmtPct(val) { return Number(val || 0).toFixed(2) + '%' }

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 text-center">
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mt-1">{label}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

// Simple bar chart using divs
function MiniChart({ data, dataKey, label, color = 'bg-wcs-red' }) {
  if (!data || data.length === 0) return null
  const maxVal = Math.max(...data.map(d => d[dataKey] || 0), 1)
  return (
    <div>
      <p className="text-xs text-text-muted uppercase font-semibold mb-2">{label}</p>
      <div className="flex items-end gap-[2px] h-24">
        {data.map((d, i) => {
          const val = d[dataKey] || 0
          const pct = (val / maxVal) * 100
          return (
            <div key={i} className="flex-1 flex flex-col items-center group relative">
              <div className={`w-full ${color} rounded-t-sm opacity-80 group-hover:opacity-100 transition-opacity`} style={{ height: `${Math.max(pct, 2)}%` }} />
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-navy text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                {d.date}: {dataKey === 'spend' ? fmtMoney(val) : fmtNum(val)}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-text-muted">{data[0]?.date}</span>
        <span className="text-[10px] text-text-muted">{data[data.length - 1]?.date}</span>
      </div>
    </div>
  )
}

export default function MetaAdsView({ onBack }) {
  const [overview, setOverview] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [daily, setDaily] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeQuick, setActiveQuick] = useState('last_30')
  const [startDate, setStartDate] = useState(() => getQuickRange('last_30').start)
  const [endDate, setEndDate] = useState(() => getQuickRange('last_30').end)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const params = { start_date: startDate, end_date: endDate }
      const [ov, camps, dy] = await Promise.all([
        getMetaAdsOverview(params),
        getMetaAdsCampaigns({ ...params, status: showAll ? 'all' : 'active' }),
        getMetaAdsDaily(params),
      ])
      setOverview(ov)
      setCampaigns(camps.campaigns || [])
      setDaily(dy.daily || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function applyQuickRange(key) {
    setActiveQuick(key)
    const range = getQuickRange(key)
    setStartDate(range.start)
    setEndDate(range.end)
  }

  function handleApply() {
    setActiveQuick(null)
    loadData()
  }

  // Re-fetch when quick range changes
  useEffect(() => {
    if (activeQuick) loadData()
  }, [activeQuick, showAll])

  return (
    <div className="max-w-5xl mx-auto w-full px-8 py-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <h2 className="text-xl font-bold text-text-primary">Ad Reports</h2>
        <p className="text-sm text-text-muted">Meta / Facebook Ads</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex gap-1.5">
          {QUICK_RANGES.map(qr => (
            <button
              key={qr.key}
              onClick={() => applyQuickRange(qr.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                activeQuick === qr.key
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-surface text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {qr.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setActiveQuick(null) }}
            className="px-2 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-primary" />
          <span className="text-text-muted text-xs">to</span>
          <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setActiveQuick(null) }}
            className="px-2 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-primary" />
          {!activeQuick && (
            <button onClick={handleApply} className="px-3 py-1.5 bg-wcs-red text-white text-xs font-medium rounded-lg">
              Apply
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm mb-6">{error}</div>
      )}

      {loading && <p className="text-text-muted text-sm py-12 text-center">Loading ad data...</p>}

      {!loading && overview && (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <StatCard label="Spend" value={fmtMoney(overview.spend)} />
            <StatCard label="Leads" value={fmtNum(overview.leads)} sub={overview.cost_per_lead ? `${fmtMoney(overview.cost_per_lead)} / lead` : null} />
            <StatCard label="Impressions" value={fmtNum(overview.impressions)} />
            <StatCard label="Link Clicks" value={fmtNum(overview.link_clicks)} sub={`${fmtPct(overview.ctr)} CTR`} />
            <StatCard label="Landing Views" value={fmtNum(overview.landing_page_views)} />
          </div>

          {/* Daily Charts */}
          {daily.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-surface border border-border rounded-xl p-4">
                <MiniChart data={daily} dataKey="spend" label="Daily Spend" />
              </div>
              <div className="bg-surface border border-border rounded-xl p-4">
                <MiniChart data={daily} dataKey="leads" label="Daily Leads" color="bg-green-500" />
              </div>
            </div>
          )}

          {/* Campaigns Table */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <p className="text-xs text-text-muted font-semibold uppercase">Campaigns ({campaigns.length})</p>
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                {showAll ? 'Active only' : 'Show all'}
              </button>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Campaign</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted">Spend</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted">Leads</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted">CPL</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted">Clicks</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted text-sm">No campaign data for this period</td></tr>
                  )}
                  {campaigns.map(c => (
                    <tr key={c.campaign_id} className="border-b border-border last:border-0 hover:bg-bg transition-colors">
                      <td className="px-4 py-2.5 text-text-primary font-medium text-xs max-w-[240px] truncate">{c.campaign_name}</td>
                      <td className="px-4 py-2.5 text-right text-text-primary text-xs">{fmtMoney(c.spend)}</td>
                      <td className="px-4 py-2.5 text-right text-text-primary text-xs font-medium">{fmtNum(c.leads)}</td>
                      <td className="px-4 py-2.5 text-right text-text-muted text-xs">{c.cost_per_lead ? fmtMoney(c.cost_per_lead) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-text-muted text-xs">{fmtNum(c.clicks)}</td>
                      <td className="px-4 py-2.5 text-right text-text-muted text-xs">{fmtPct(c.ctr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
