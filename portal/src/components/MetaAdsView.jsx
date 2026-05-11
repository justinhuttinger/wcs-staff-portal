import { useState, useEffect } from 'react'
import { getMetaAdsOverview, getMetaAdsCampaigns, getMetaAdsets, getMetaAds, getFbRoas } from '../lib/api'

const QUICK_RANGES = [
  { key: 'last_7', label: '7 Days' },
  { key: 'last_30', label: '30 Days' },
  { key: 'last_90', label: '90 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
]

import { LOCATIONS_WITH_ALL as LOCATIONS } from '../config/locations'
const TYPES = ['All', 'Lead', 'Traffic', 'Retargeting', 'Other']

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
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
function fmtBudget(daily, lifetime) {
  if (daily) return fmtMoney(daily) + '/day'
  if (lifetime) return fmtMoney(lifetime) + ' lifetime'
  return '—'
}

function classifyCampaign(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('retarget')) return 'Retargeting'
  if (n.includes('lead') || n.includes('1 year free') || n.includes('test drive')) return 'Lead'
  if (n.includes('traffic')) return 'Traffic'
  return 'Other'
}

function detectLocation(name) {
  const n = (name || '').toLowerCase()
  for (const loc of LOCATIONS.slice(1)) {
    if (n.includes(loc.toLowerCase())) return loc
  }
  return null
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 text-center">
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mt-1">{label}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}


function FilterPills({ options, value, onChange, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-muted font-medium">{label}:</span>
      <div className="flex gap-1 flex-wrap">
        {options.map(opt => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              value === opt
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-surface text-text-muted border-border hover:text-text-primary'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// Shared table row component
function MetricRow({ name, spend, leads, costPerLead, costPerLinkClick, isTraffic, clicks, impressions, budget, updatedTime, onClick, depth = 0, sales, revenue, ltv }) {
  const displayLeads = isTraffic ? 0 : leads
  const costLabel = isTraffic ? (costPerLinkClick ? fmtMoney(costPerLinkClick) : '—') : (costPerLead ? fmtMoney(costPerLead) : '—')
  const salesNum = sales || 0
  const rev = revenue != null ? revenue : (salesNum * (ltv || 0))
  const roas = spend > 0 ? rev / spend : null
  const cps = salesNum > 0 ? spend / salesNum : null
  return (
    <tr onClick={onClick} className={`border-b border-border last:border-0 hover:bg-bg transition-colors ${onClick ? 'cursor-pointer' : ''}`}>
      <td className="px-4 py-2.5 text-text-primary font-medium text-xs max-w-[260px]">
        <span style={{ paddingLeft: depth * 16 }}>{name}</span>
      </td>
      <td className="px-3 py-2.5 text-right text-text-primary text-xs">{fmtMoney(spend)}</td>
      <td className="px-3 py-2.5 text-right text-text-primary text-xs font-medium">{fmtNum(displayLeads)}</td>
      <td className="px-3 py-2.5 text-right text-text-muted text-xs">{costLabel}</td>
      <td className={`px-3 py-2.5 text-right text-xs font-semibold ${salesNum > 0 ? 'text-green-600' : 'text-text-muted'}`}>{salesNum > 0 ? fmtNum(salesNum) : '—'}</td>
      <td className={`px-3 py-2.5 text-right text-xs font-semibold ${roas != null && roas >= 1 ? 'text-green-600' : roas != null ? 'text-wcs-red' : 'text-text-muted'}`}>{roas != null ? roas.toFixed(2) + 'x' : '—'}</td>
      <td className="px-3 py-2.5 text-right text-text-muted text-xs">{cps != null ? fmtMoney(cps) : '—'}</td>
      <td className="px-3 py-2.5 text-right text-text-muted text-xs">{fmtNum(clicks)}</td>
      <td className="px-3 py-2.5 text-right text-text-muted text-xs">{fmtNum(impressions)}</td>
      <td className="px-3 py-2.5 text-right text-text-muted text-xs">{budget || '—'}</td>
      <td className="px-3 py-2.5 text-right text-text-muted text-xs whitespace-nowrap">{fmtDate(updatedTime)}</td>
    </tr>
  )
}

export default function MetaAdsView({ onBack }) {
  const [overview, setOverview] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeQuick, setActiveQuick] = useState('last_30')
  const [startDate, setStartDate] = useState(() => getQuickRange('last_30').start)
  const [endDate, setEndDate] = useState(() => getQuickRange('last_30').end)
  const [showAll, setShowAll] = useState(false)

  // Filters
  const [locationFilter, setLocationFilter] = useState('All')
  const [typeFilter, setTypeFilter] = useState('All')

  // Drill-down
  const [expandedCampaign, setExpandedCampaign] = useState(null)
  const [adsets, setAdsets] = useState([])
  const [adsetsLoading, setAdsetsLoading] = useState(false)
  const [expandedAdset, setExpandedAdset] = useState(null)
  const [ads, setAds] = useState([])
  const [adsLoading, setAdsLoading] = useState(false)

  // FB ROAS (own-calculated from GHL 'sale' tag × LTV ÷ spend)
  const [roasData, setRoasData] = useState(null) // { rows: [...], totals: {...}, ltv }

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    setExpandedCampaign(null)
    setExpandedAdset(null)
    try {
      const params = { start_date: startDate, end_date: endDate }
      const [ov, camps, roas] = await Promise.all([
        getMetaAdsOverview(params),
        getMetaAdsCampaigns({ ...params, status: showAll ? 'all' : 'active' }),
        getFbRoas({ ...params, group_by: 'ad' }).catch(err => {
          // ROAS endpoint can fail if attribution backfill hasn't run yet —
          // degrade gracefully and still show Meta data
          console.warn('[MetaAds] FB ROAS unavailable:', err.message)
          return null
        }),
      ])
      setOverview(ov)
      setCampaigns(camps.campaigns || [])
      setRoasData(roas)
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

  useEffect(() => { if (activeQuick) loadData() }, [activeQuick, showAll])

  function handleApply() { setActiveQuick(null); loadData() }

  async function toggleCampaign(campaignId) {
    if (expandedCampaign === campaignId) {
      setExpandedCampaign(null)
      setAdsets([])
      setExpandedAdset(null)
      setAds([])
      return
    }
    setExpandedCampaign(campaignId)
    setExpandedAdset(null)
    setAds([])
    setAdsetsLoading(true)
    try {
      const data = await getMetaAdsets({ campaign_id: campaignId, start_date: startDate, end_date: endDate })
      setAdsets(data.adsets || [])
    } catch { setAdsets([]) }
    setAdsetsLoading(false)
  }

  async function toggleAdset(adsetId) {
    if (expandedAdset === adsetId) {
      setExpandedAdset(null)
      setAds([])
      return
    }
    setExpandedAdset(adsetId)
    setAdsLoading(true)
    try {
      const data = await getMetaAds({ adset_id: adsetId, start_date: startDate, end_date: endDate })
      setAds(data.ads || [])
    } catch { setAds([]) }
    setAdsLoading(false)
  }

  // Apply filters
  const isFiltered = locationFilter !== 'All' || typeFilter !== 'All'
  const filteredCampaigns = campaigns.filter(c => {
    if (locationFilter !== 'All') {
      const loc = detectLocation(c.campaign_name)
      if (loc !== locationFilter) return false
    }
    if (typeFilter !== 'All') {
      const type = classifyCampaign(c.campaign_name)
      if (type !== typeFilter) return false
    }
    return true
  })

  // Build ROAS lookups by adId / adsetId / campaignId from per-ad rows
  const ltv = roasData?.ltv || 990
  const salesByAdId = new Map()
  const salesByAdsetId = new Map()
  const salesByCampaignId = new Map()
  if (roasData?.rows) {
    for (const r of roasData.rows) {
      if (r.adId) salesByAdId.set(r.adId, { sales: r.sales, revenue: r.revenue })
      if (r.adsetId) {
        const agg = salesByAdsetId.get(r.adsetId) || { sales: 0, revenue: 0 }
        agg.sales += r.sales || 0
        agg.revenue += r.revenue || 0
        salesByAdsetId.set(r.adsetId, agg)
      }
      if (r.campaignId) {
        const agg = salesByCampaignId.get(r.campaignId) || { sales: 0, revenue: 0 }
        agg.sales += r.sales || 0
        agg.revenue += r.revenue || 0
        salesByCampaignId.set(r.campaignId, agg)
      }
    }
  }

  // Compute filtered overview from campaign-level data when filters are active
  const displayOverview = isFiltered ? (() => {
    const totals = { spend: 0, impressions: 0, clicks: 0, leads: 0, link_clicks: 0, landing_page_views: 0 }
    for (const c of filteredCampaigns) {
      totals.spend += c.spend || 0
      totals.impressions += c.impressions || 0
      totals.clicks += c.clicks || 0
      totals.leads += c.leads || 0
      totals.link_clicks += c.link_clicks || c.clicks || 0
      totals.landing_page_views += c.landing_page_views || 0
    }
    totals.cost_per_lead = totals.leads > 0 ? totals.spend / totals.leads : null
    return totals
  })() : overview

  return (
    <div className="max-w-6xl mx-auto w-full px-8 py-6">
      {/* Header */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-5">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <h2 className="text-xl font-bold text-text-primary">Ad Reports</h2>
        <p className="text-sm text-text-muted">Meta / Facebook Ads</p>
      </div>

      {/* Date Controls + Filters in white card */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {QUICK_RANGES.map(qr => (
              <button key={qr.key} onClick={() => applyQuickRange(qr.key)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  activeQuick === qr.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'
                }`}>
                {qr.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setActiveQuick(null) }}
              className="px-2 py-1 bg-bg border border-border rounded-lg text-xs text-text-primary" />
            <span className="text-text-muted text-xs">to</span>
            <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setActiveQuick(null) }}
              className="px-2 py-1 bg-bg border border-border rounded-lg text-xs text-text-primary" />
            {!activeQuick && <button onClick={handleApply} className="px-3 py-1 bg-wcs-red text-white text-xs font-medium rounded-lg">Apply</button>}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <FilterPills options={LOCATIONS} value={locationFilter} onChange={setLocationFilter} label="Location" />
          <FilterPills options={TYPES} value={typeFilter} onChange={setTypeFilter} label="Type" />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm mb-5">{error}</div>}
      {loading && <p className="loading-card mx-auto block my-6">Loading ad data...</p>}

      {!loading && overview && (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
            <StatCard label="Spend" value={fmtMoney(displayOverview.spend)} />
            <StatCard label="Leads" value={fmtNum(displayOverview.leads)} sub={displayOverview.cost_per_lead ? `${fmtMoney(displayOverview.cost_per_lead)} / lead` : null} />
            <StatCard label="Impressions" value={fmtNum(displayOverview.impressions)} />
            <StatCard label="Link Clicks" value={fmtNum(displayOverview.link_clicks)} />
            <StatCard label="Landing Views" value={fmtNum(displayOverview.landing_page_views)} />
          </div>

          {/* Own-calculated ROAS Cards — visible only when ROAS endpoint returned data */}
          {roasData?.totals && (
            <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-bold text-text-primary">Our ROAS (GHL-based)</p>
                  <p className="text-xs text-text-muted">Memberships sold (GHL tag <code className="text-[10px]">sale</code> × ${ltv} LTV) ÷ Meta spend. First-touch attribution.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Memberships Sold" value={fmtNum(roasData.totals.sales)} />
                <StatCard label="Revenue" value={fmtMoney(roasData.totals.revenue)} />
                <StatCard
                  label="ROAS"
                  value={roasData.totals.roas != null ? roasData.totals.roas.toFixed(2) + 'x' : '—'}
                  sub={roasData.totals.roas != null && roasData.totals.roas >= 1 ? 'profitable' : roasData.totals.roas != null ? 'below 1x' : null}
                />
                <StatCard
                  label="Cost / Membership"
                  value={roasData.totals.cost_per_sale != null ? fmtMoney(roasData.totals.cost_per_sale) : '—'}
                  sub={roasData.totals.sales > 0 ? `${roasData.totals.ads_with_sales} ads with sales` : null}
                />
              </div>
            </div>
          )}
          {!roasData && !loading && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-800 mb-5">
              ROAS data unavailable — attribution sync may not have run yet. Existing Meta metrics still shown below.
            </div>
          )}

          {/* Campaigns Table with Drill-Down */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <p className="text-xs text-text-muted font-semibold uppercase">
                Campaigns ({filteredCampaigns.length})
                {(locationFilter !== 'All' || typeFilter !== 'All') && <span className="text-wcs-red ml-1">(filtered)</span>}
              </p>
              <button onClick={() => { setShowAll(!showAll) }} className="text-xs text-text-muted hover:text-text-primary transition-colors">
                {showAll ? 'Active only' : 'Show all'}
              </button>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface z-10">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Name</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">Spend</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">Leads</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">CPL</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted" title="Memberships sold from GHL 'sale' tag with FB attribution">Sales</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted" title={`Revenue ($${ltv} × sales) ÷ spend`}>ROAS</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">$/Sale</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">Clicks</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">Impr.</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">Budget</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">Last Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.length === 0 && (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-text-muted text-sm">No campaigns match filters</td></tr>
                  )}
                  {filteredCampaigns.map(c => {
                    const campSales = salesByCampaignId.get(c.campaign_id)
                    return (
                      <>
                        <MetricRow
                          key={c.campaign_id}
                          name={expandedCampaign === c.campaign_id ? '[-] ' + c.campaign_name : '[+] ' + c.campaign_name}
                          spend={c.spend} leads={c.leads} costPerLead={c.cost_per_lead}
                          costPerLinkClick={c.cost_per_link_click} isTraffic={classifyCampaign(c.campaign_name) === 'Traffic'}
                          clicks={c.clicks} impressions={c.impressions}
                          budget={fmtBudget(c.daily_budget, c.lifetime_budget)}
                          updatedTime={c.updated_time}
                          sales={campSales?.sales} revenue={campSales?.revenue} ltv={ltv}
                          onClick={() => toggleCampaign(c.campaign_id)}
                        />
                        {/* Ad Sets */}
                        {expandedCampaign === c.campaign_id && (
                          adsetsLoading ? (
                            <tr key={c.campaign_id + '-loading'}><td colSpan={11} className="px-8 py-3 text-xs text-text-muted">Loading ad sets...</td></tr>
                          ) : adsets.map(as => {
                            const adsetSales = salesByAdsetId.get(as.adset_id)
                            return (
                              <>
                                <MetricRow
                                  key={as.adset_id}
                                  name={expandedAdset === as.adset_id ? '[-] ' + as.adset_name : '[+] ' + as.adset_name}
                                  spend={as.spend} leads={as.leads} costPerLead={as.cost_per_lead}
                                  clicks={as.clicks} impressions={as.impressions}
                                  budget={fmtBudget(as.daily_budget, as.lifetime_budget)}
                                  updatedTime={as.updated_time}
                                  sales={adsetSales?.sales} revenue={adsetSales?.revenue} ltv={ltv}
                                  onClick={() => toggleAdset(as.adset_id)}
                                  depth={1}
                                />
                                {/* Ads */}
                                {expandedAdset === as.adset_id && (
                                  adsLoading ? (
                                    <tr key={as.adset_id + '-loading'}><td colSpan={11} className="px-12 py-3 text-xs text-text-muted">Loading ads...</td></tr>
                                  ) : ads.map(ad => {
                                    const adSales = salesByAdId.get(ad.ad_id)
                                    return (
                                      <MetricRow
                                        key={ad.ad_id}
                                        name={ad.ad_name}
                                        spend={ad.spend} leads={ad.leads} costPerLead={ad.cost_per_lead}
                                        clicks={ad.clicks} impressions={ad.impressions}
                                        budget="—"
                                        updatedTime={ad.updated_time}
                                        sales={adSales?.sales} revenue={adSales?.revenue} ltv={ltv}
                                        depth={2}
                                      />
                                    )
                                  })
                                )}
                              </>
                            )
                          })
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
