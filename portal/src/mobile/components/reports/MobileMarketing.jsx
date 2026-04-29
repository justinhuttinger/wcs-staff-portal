import React, { useState, useEffect, useMemo } from 'react'
import {
  getMetaAdsOverview,
  getMetaAdsCampaigns,
  getMetaAdsets,
  getMetaAds,
} from '../../../lib/api'
import MobileLoading from '../MobileLoading'

/* ── helpers ────────────────────────────────────────── */

function fmtMoney(val) {
  return '$' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtNum(val) {
  return Number(val || 0).toLocaleString()
}
function classifyCampaign(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('retarget')) return 'Retargeting'
  if (n.includes('lead') || n.includes('1 year free') || n.includes('test drive')) return 'Lead'
  if (n.includes('traffic')) return 'Traffic'
  return 'Other'
}
function detectLocation(name) {
  const LOCS = ['Salem', 'Keizer', 'Eugene', 'Springfield', 'Clackamas', 'Milwaukie', 'Medford']
  const n = (name || '').toLowerCase()
  for (const loc of LOCS) { if (n.includes(loc.toLowerCase())) return loc }
  return null
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10)
}

function getPresetRange(preset) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (preset) {
    case '7d': {
      const s = new Date(today)
      s.setDate(s.getDate() - 6)
      return { start: toDateStr(s), end: toDateStr(today) }
    }
    case '30d': {
      const s = new Date(today)
      s.setDate(s.getDate() - 29)
      return { start: toDateStr(s), end: toDateStr(today) }
    }
    case '90d': {
      const s = new Date(today)
      s.setDate(s.getDate() - 89)
      return { start: toDateStr(s), end: toDateStr(today) }
    }
    case 'this_month': {
      const s = new Date(today.getFullYear(), today.getMonth(), 1)
      return { start: toDateStr(s), end: toDateStr(today) }
    }
    case 'last_month': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const e = new Date(today.getFullYear(), today.getMonth(), 0)
      return { start: toDateStr(s), end: toDateStr(e) }
    }
    default:
      return null
  }
}

const LOCATIONS = ['All', 'Salem', 'Keizer', 'Eugene', 'Springfield', 'Clackamas', 'Milwaukie', 'Medford']
const TYPES = ['All', 'Lead', 'Traffic', 'Retargeting', 'Other']
const DATE_PRESETS = [
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '90d', label: '90 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
]

/* ── spinner ────────────────────────────────────────── */

function Spinner() {
  return <MobileLoading variant="stats" count={4} />
}

/* ── pill button ────────────────────────────────────── */

function Pill({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
        active
          ? 'bg-wcs-red text-white'
          : 'bg-bg text-text-secondary border border-border'
      }`}
    >
      {children}
    </button>
  )
}

/* ── ad row (innermost level) ───────────────────────── */

function AdRow({ ad }) {
  return (
    <div className="py-2 px-3 bg-bg/50 border-t border-border/50">
      <p className="text-xs font-medium text-text-primary truncate">{ad.ad_name || ad.name || 'Unnamed Ad'}</p>
      <div className="flex gap-3 mt-1 text-xs text-text-muted">
        <span>Spend {fmtMoney(ad.spend)}</span>
        <span>Leads {fmtNum(ad.leads)}</span>
        <span>Clicks {fmtNum(ad.clicks)}</span>
      </div>
    </div>
  )
}

/* ── adset card ─────────────────────────────────────── */

function AdsetCard({ adset, dateRange }) {
  const [expanded, setExpanded] = useState(false)
  const [ads, setAds] = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  async function loadAds() {
    if (loaded) { setExpanded(e => !e); return }
    setExpanded(true)
    setLoading(true)
    try {
      const res = await getMetaAds({
        adset_id: adset.adset_id,
        start_date: dateRange.start,
        end_date: dateRange.end,
      })
      setAds(res.ads || [])
      setLoaded(true)
    } catch { setAds([]) }
    setLoading(false)
  }

  return (
    <div className="border-t border-border/50">
      <button
        onClick={loadAds}
        className="w-full text-left px-3 py-2.5 bg-surface/80 active:bg-bg transition-colors"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-text-primary truncate pr-2 flex-1">
            {adset.adset_name || adset.name || 'Unnamed Ad Set'}
          </p>
          <svg
            className={`w-3.5 h-3.5 text-text-muted shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <div className="flex gap-3 mt-1 text-xs text-text-muted">
          <span>Spend {fmtMoney(adset.spend)}</span>
          <span>Leads {fmtNum(adset.leads)}</span>
          <span>CPL {fmtMoney(adset.cost_per_lead)}</span>
        </div>
      </button>
      {expanded && (
        <div className="ml-3 border-l-2 border-wcs-red/20">
          {loading ? (
            <div className="py-3 flex justify-center">
              <div className="w-4 h-4 border-2 border-wcs-red/20 border-t-wcs-red rounded-full animate-spin" />
            </div>
          ) : ads.length === 0 ? (
            <p className="text-xs text-text-muted py-2 px-3">No ads found</p>
          ) : (
            ads.map((ad, i) => <AdRow key={ad.ad_id || i} ad={ad} />)
          )}
        </div>
      )}
    </div>
  )
}

/* ── campaign card ──────────────────────────────────── */

function CampaignCard({ campaign, dateRange }) {
  const [expanded, setExpanded] = useState(false)
  const [adsets, setAdsets] = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const type = classifyCampaign(campaign.campaign_name)
  const loc = detectLocation(campaign.campaign_name)

  async function toggle() {
    if (loaded) { setExpanded(e => !e); return }
    setExpanded(true)
    setLoading(true)
    try {
      const res = await getMetaAdsets({
        campaign_id: campaign.campaign_id,
        start_date: dateRange.start,
        end_date: dateRange.end,
      })
      setAdsets(res.adsets || [])
      setLoaded(true)
    } catch { setAdsets([]) }
    setLoading(false)
  }

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <button onClick={toggle} className="w-full text-left p-3 active:bg-bg/60 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary leading-snug line-clamp-2">
              {campaign.campaign_name}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              {loc && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">{loc}</span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                type === 'Lead' ? 'bg-green-50 text-green-600' :
                type === 'Traffic' ? 'bg-purple-50 text-purple-600' :
                type === 'Retargeting' ? 'bg-amber-50 text-amber-600' :
                'bg-gray-100 text-text-muted'
              }`}>{type}</span>
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-text-muted shrink-0 mt-0.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-2.5">
          <div>
            <p className="text-[10px] text-text-muted uppercase tracking-wide">Spend</p>
            <p className="text-sm font-bold text-text-primary">{fmtMoney(campaign.spend)}</p>
          </div>
          <div>
            <p className="text-[10px] text-text-muted uppercase tracking-wide">Leads</p>
            <p className="text-sm font-bold text-text-primary">{fmtNum(campaign.leads)}</p>
          </div>
          <div>
            <p className="text-[10px] text-text-muted uppercase tracking-wide">CPL</p>
            <p className="text-sm font-bold text-text-primary">{fmtMoney(campaign.cost_per_lead)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-1.5">
          <div>
            <p className="text-[10px] text-text-muted uppercase tracking-wide">Clicks</p>
            <p className="text-xs font-semibold text-text-secondary">{fmtNum(campaign.clicks)}</p>
          </div>
          <div>
            <p className="text-[10px] text-text-muted uppercase tracking-wide">Impressions</p>
            <p className="text-xs font-semibold text-text-secondary">{fmtNum(campaign.impressions)}</p>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {loading ? (
            <div className="py-4 flex justify-center">
              <div className="w-5 h-5 border-2 border-wcs-red/20 border-t-wcs-red rounded-full animate-spin" />
            </div>
          ) : adsets.length === 0 ? (
            <p className="text-xs text-text-muted py-3 px-3">No ad sets found</p>
          ) : (
            adsets.map((as, i) => (
              <AdsetCard key={as.adset_id || i} adset={as} dateRange={dateRange} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

/* ── main component ─────────────────────────────────── */

export default function MobileMarketing() {
  // date range
  const [preset, setPreset] = useState('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const dateRange = useMemo(() => {
    if (preset === 'custom') {
      return { start: customStart, end: customEnd }
    }
    return getPresetRange(preset)
  }, [preset, customStart, customEnd])

  // filters
  const [location, setLocation] = useState('All')
  const [type, setType] = useState('All')
  const [activeOnly, setActiveOnly] = useState(true)

  // data
  const [overview, setOverview] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notConnected, setNotConnected] = useState(false)

  // fetch data when dateRange or activeOnly changes
  useEffect(() => {
    if (!dateRange || !dateRange.start || !dateRange.end) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotConnected(false)
      try {
        const params = {
          start_date: dateRange.start,
          end_date: dateRange.end,
          ...(activeOnly ? { status: 'ACTIVE' } : {}),
        }
        const [ov, camp] = await Promise.all([
          getMetaAdsOverview(params),
          getMetaAdsCampaigns(params),
        ])
        if (cancelled) return
        setOverview(ov)
        setCampaigns(camp.campaigns || [])
      } catch (err) {
        if (cancelled) return
        const msg = (err?.message || err?.toString() || '').toLowerCase()
        if (msg.includes('not connected') || msg.includes('no meta') || msg.includes('no account') || msg.includes('401') || msg.includes('403')) {
          setNotConnected(true)
        } else {
          setError(err?.message || 'Failed to load Meta Ads data')
        }
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [dateRange?.start, dateRange?.end, activeOnly])

  // filtered campaigns
  const isFiltered = location !== 'All' || type !== 'All'
  const filtered = useMemo(() => {
    return campaigns.filter(c => {
      if (location !== 'All') {
        const loc = detectLocation(c.campaign_name)
        if (loc !== location) return false
      }
      if (type !== 'All') {
        const t = classifyCampaign(c.campaign_name)
        if (t !== type) return false
      }
      return true
    })
  }, [campaigns, location, type])

  // Recompute overview stats from filtered campaigns when filters are active
  const displayOverview = useMemo(() => {
    if (!isFiltered) return overview
    const totals = { spend: 0, impressions: 0, clicks: 0, leads: 0, link_clicks: 0, landing_page_views: 0 }
    for (const c of filtered) {
      totals.spend += c.spend || 0
      totals.impressions += c.impressions || 0
      totals.clicks += c.clicks || 0
      totals.leads += c.leads || 0
      totals.link_clicks += c.link_clicks || c.clicks || 0
      totals.landing_page_views += c.landing_page_views || 0
    }
    totals.cost_per_lead = totals.leads > 0 ? totals.spend / totals.leads : 0
    return totals
  }, [overview, filtered, isFiltered])

  // not connected state
  if (notConnected) {
    return (
      <div className="p-4">
        <h2 className="text-lg font-bold text-text-primary mb-4">Meta Ads</h2>
        <div className="bg-surface rounded-2xl border border-border p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-7 h-7 text-wcs-red" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.93 3.78-3.93 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 008.44-9.9c0-5.53-4.5-10.02-10-10.02z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-text-primary mb-1">Meta Ads Not Connected</h3>
          <p className="text-sm text-text-muted">
            Connect your Meta Ads account in the desktop portal to view campaign performance here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-6">
      {/* Header + filters in white card */}
      <div className="mx-4 mt-4 mb-3 bg-surface/95 backdrop-blur-sm rounded-2xl border border-border p-4 space-y-2">
        <h2 className="text-lg font-bold text-text-primary">Meta Ads</h2>

        {/* Date range pills */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {DATE_PRESETS.map(p => (
            <Pill
              key={p.key}
              active={preset === p.key}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </Pill>
          ))}
          <Pill active={preset === 'custom'} onClick={() => setPreset('custom')}>
            Custom
          </Pill>
        </div>

        {/* Custom date inputs */}
        {preset === 'custom' && (
          <div className="flex gap-2">
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="flex-1 bg-bg border border-border rounded-lg px-2.5 py-2 text-xs text-text-primary"
            />
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="flex-1 bg-bg border border-border rounded-lg px-2.5 py-2 text-xs text-text-primary"
            />
          </div>
        )}

        {/* Active toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary font-medium">
            {activeOnly ? 'Active campaigns' : 'All campaigns'}
          </span>
          <button
            onClick={() => setActiveOnly(v => !v)}
            className={`relative w-10 h-5 rounded-full transition-colors ${activeOnly ? 'bg-wcs-red' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${activeOnly ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="mx-4 bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700 font-medium">Error loading data</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
        </div>
      ) : (
        <>
          {/* Overview stat cards - horizontal scroll */}
          {displayOverview && (
            <div className="mb-4">
              <div className="flex gap-2.5 overflow-x-auto px-4 pb-1 no-scrollbar">
                {[
                  { label: 'Spend', value: fmtMoney(displayOverview.spend), sub: null },
                  { label: 'Leads', value: fmtNum(displayOverview.leads), sub: `CPL ${fmtMoney(displayOverview.cost_per_lead)}` },
                  { label: 'Impressions', value: fmtNum(displayOverview.impressions), sub: null },
                  { label: 'Link Clicks', value: fmtNum(displayOverview.link_clicks), sub: null },
                  { label: 'Landing Views', value: fmtNum(displayOverview.landing_page_views), sub: null },
                ].map(stat => (
                  <div
                    key={stat.label}
                    className="shrink-0 w-[130px] bg-surface rounded-xl border border-border p-3"
                  >
                    <p className="text-[10px] text-text-muted uppercase tracking-wide">{stat.label}</p>
                    <p className="text-lg font-bold text-text-primary mt-0.5">{stat.value}</p>
                    {stat.sub && (
                      <p className="text-[10px] text-wcs-red font-medium mt-0.5">{stat.sub}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Location + Type filter pills in white card */}
          <div className="mx-4 mb-3 bg-surface/95 backdrop-blur-sm rounded-2xl border border-border p-4 space-y-2">
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Location</p>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                {LOCATIONS.map(loc => (
                  <Pill key={loc} active={location === loc} onClick={() => setLocation(loc)}>
                    {loc}
                  </Pill>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Type</p>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                {TYPES.map(t => (
                  <Pill key={t} active={type === t} onClick={() => setType(t)}>
                    {t}
                  </Pill>
                ))}
              </div>
            </div>
          </div>

          {/* Campaign count */}
          <div className="px-4 mb-2">
            <p className="text-xs text-text-muted">
              {filtered.length} campaign{filtered.length !== 1 ? 's' : ''}
              {location !== 'All' || type !== 'All' ? ' (filtered)' : ''}
            </p>
          </div>

          {/* Campaign cards */}
          <div className="px-4 space-y-2.5">
            {filtered.length === 0 ? (
              <div className="bg-surface rounded-xl border border-border p-6 text-center">
                <p className="text-sm text-text-muted">No campaigns match your filters</p>
              </div>
            ) : (
              filtered.map((c, i) => (
                <CampaignCard key={c.campaign_id || i} campaign={c} dateRange={dateRange} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
