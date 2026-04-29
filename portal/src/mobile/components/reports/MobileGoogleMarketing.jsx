import React, { useState, useEffect, useRef } from 'react'
import {
  getGoogleBusinessStatus,
  getGoogleBusinessPerformance,
  getGoogleAnalyticsStatus,
  getGoogleAnalyticsOverview,
  getGoogleAnalyticsSources,
  getGoogleAnalyticsPages,
  getGoogleAnalyticsDevicesGeo,
  getGoogleAnalyticsKeyEvents,
} from '../../../lib/api'
import { LOCATION_OPTIONS as LOCATIONS } from '../../../config/locations'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const QUICK_RANGES = [
  { key: 'last_7', label: '7 Days' },
  { key: 'last_30', label: '30 Days' },
  { key: 'last_90', label: '90 Days' },
]

function getQuickRange(key) {
  const today = new Date().toISOString().slice(0, 10)
  const days = key === 'last_7' ? 7 : key === 'last_30' ? 30 : 90
  const s = new Date()
  s.setDate(s.getDate() - days)
  return { start: s.toISOString().slice(0, 10), end: today }
}

function fmtNum(v) { return Number(v || 0).toLocaleString() }
function fmtPct(v) { return `${(Number(v || 0) * 100).toFixed(1)}%` }
function fmtDuration(secs) {
  const s = Math.round(Number(secs || 0))
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function locDisplayName(metric) {
  if (metric?.city) return metric.city
  const title = metric?.title || ''
  const dash = title.lastIndexOf('-')
  if (dash > 0) return title.substring(dash + 1).trim()
  return title || 'Unknown'
}

function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-3 pt-2 px-4">
      <div className="bg-surface/95 backdrop-blur-sm rounded-lg border border-border px-3 py-1.5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

function DeltaChip({ current, previous, kind = 'up_good' }) {
  if (previous === null || previous === undefined) return null
  const cur = Number(current || 0)
  const prev = Number(previous || 0)
  if (prev === 0 && cur === 0) {
    return <span className="text-[10px] text-text-muted">no prior</span>
  }
  const delta = prev === 0 ? 100 : ((cur - prev) / prev) * 100
  const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const goodTrend = kind === 'up_good' ? 'up' : 'down'
  const isGood = trend === goodTrend
  const isFlat = trend === 'flat'
  const cls = isFlat
    ? 'bg-bg text-text-muted border-border'
    : isGood
      ? 'bg-green-50 text-green-700 border-green-200'
      : 'bg-red-50 text-red-700 border-red-200'
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–'
  const sign = delta > 0 ? '+' : ''
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${cls}`}>
      <span>{arrow}</span>
      <span>{sign}{delta.toFixed(0)}%</span>
    </span>
  )
}

function StatCard({ label, value, current, previous, fmt = fmtNum, kind = 'up_good' }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-3">
      <p className="text-[10px] font-medium text-text-muted uppercase tracking-wide truncate">{label}</p>
      <div className="flex items-baseline gap-1.5 mt-1">
        <p className="text-xl font-bold text-text-primary">{value !== undefined ? value : fmt(current)}</p>
        {previous !== undefined && <DeltaChip current={current} previous={previous} kind={kind} />}
      </div>
    </div>
  )
}

function ConnectBanner({ onReconnect, message }) {
  return (
    <div className="mx-4 bg-yellow-50 border border-yellow-200 rounded-2xl p-4">
      <p className="text-sm font-semibold text-yellow-900">Google account not connected</p>
      <p className="text-xs text-yellow-800 mt-1">{message}</p>
      <button
        onClick={onReconnect}
        className="mt-3 w-full px-4 py-2 rounded-xl bg-wcs-red text-white text-sm font-semibold active:opacity-80"
      >
        Connect Google
      </button>
    </div>
  )
}

function PieChartSmall({ data, colorMap }) {
  const entries = Object.entries(data || {}).filter(([, v]) => v > 0)
  const total = entries.reduce((s, [, v]) => s + v, 0)
  if (total === 0) return <p className="text-sm text-text-muted">No data</p>
  const COLORS = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5']
  let cumulative = 0
  const stops = entries.map(([k, v], i) => {
    const start = cumulative
    cumulative += (v / total) * 360
    const c = (colorMap && colorMap[k]) || COLORS[i % COLORS.length]
    return `${c} ${start}deg ${cumulative}deg`
  })
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-20 h-20 rounded-full flex-shrink-0"
        style={{ background: `conic-gradient(${stops.join(', ')})` }}
      />
      <div className="space-y-1 min-w-0 flex-1">
        {entries.map(([k, v], i) => {
          const c = (colorMap && colorMap[k]) || COLORS[i % COLORS.length]
          return (
            <div key={k} className="flex items-center gap-1.5 text-xs">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
              <span className="text-text-muted capitalize truncate">{k}</span>
              <span className="font-semibold text-text-primary ml-auto">{fmtNum(v)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GbpSection({ startDate, endDate }) {
  const [metrics, setMetrics] = useState([])
  const [apiError, setApiError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setLoading(true)
    setError(null)
    setApiError(null)
    getGoogleBusinessPerformance({ start_date: startDate, end_date: endDate })
      .then(res => {
        if (id !== reqRef.current) return
        setMetrics(res.metrics || [])
        setApiError(res.error || null)
        setLoading(false)
      })
      .catch(err => {
        if (id !== reqRef.current) return
        setError(err.message)
        setLoading(false)
      })
  }, [startDate, endDate])

  if (loading) return <p className="px-4 text-text-muted text-sm py-4 text-center">Loading Business Profile...</p>
  if (error) return <p className="px-4 text-wcs-red text-sm py-3">{error}</p>
  if (!metrics.length) {
    return (
      <div className="mx-4 bg-surface border border-border rounded-2xl p-5 text-center">
        <p className="text-sm font-semibold text-text-primary">No Business Profile locations</p>
        {apiError && <p className="text-xs text-wcs-red mt-2">{apiError}</p>}
      </div>
    )
  }

  const totals = metrics.reduce((acc, m) => {
    if (m.error) return acc
    acc.searches += m.searches || 0
    acc.website_clicks += m.website_clicks || 0
    acc.calls += m.calls || 0
    acc.directions += m.directions || 0
    return acc
  }, { searches: 0, website_clicks: 0, calls: 0, directions: 0 })

  return (
    <div className="space-y-3 px-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Map Impressions" current={totals.searches} />
        <StatCard label="Website Clicks" current={totals.website_clicks} />
        <StatCard label="Calls" current={totals.calls} />
        <StatCard label="Directions" current={totals.directions} />
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {metrics.map((m, i) => (
          <div key={m.location} className={`p-3 ${i > 0 ? 'border-t border-border' : ''}`}>
            <p className="font-semibold text-sm text-text-primary mb-2">{locDisplayName(m)}</p>
            {m.error ? (
              <p className="text-xs text-wcs-red">{m.error}</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-text-muted">Map Impressions</span>
                <span className="text-right font-semibold">{fmtNum(m.searches)}</span>
                <span className="text-text-muted">Website</span>
                <span className="text-right font-semibold">{fmtNum(m.website_clicks)}</span>
                <span className="text-text-muted">Calls</span>
                <span className="text-right font-semibold">{fmtNum(m.calls)}</span>
                <span className="text-text-muted">Directions</span>
                <span className="text-right font-semibold">{fmtNum(m.directions)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function GaSection({ startDate, endDate, locationSlug, compare, ga4Status }) {
  const [overview, setOverview] = useState(null)
  const [sources, setSources] = useState(null)
  const [pages, setPages] = useState(null)
  const [devicesGeo, setDevicesGeo] = useState(null)
  const [keyEvents, setKeyEvents] = useState(null)
  const [errors, setErrors] = useState({})
  const reqRef = useRef(0)

  useEffect(() => {
    if (!ga4Status?.has_property_id || !ga4Status?.authorized) return
    const id = ++reqRef.current
    setOverview(null); setSources(null); setPages(null); setDevicesGeo(null); setKeyEvents(null)
    setErrors({})

    const params = { start_date: startDate, end_date: endDate, location_slug: locationSlug }
    const overviewParams = { ...params, compare: compare ? 'true' : 'false' }

    function safe(key, p) {
      return p.catch(err => { setErrors(e => ({ ...e, [key]: err.message })); return null })
    }

    Promise.all([
      safe('overview', getGoogleAnalyticsOverview(overviewParams)),
      safe('sources', getGoogleAnalyticsSources(params)),
      safe('pages', getGoogleAnalyticsPages(params)),
      safe('devicesGeo', getGoogleAnalyticsDevicesGeo(params)),
      safe('keyEvents', getGoogleAnalyticsKeyEvents(params)),
    ]).then(([o, s, p, dg, ke]) => {
      if (id !== reqRef.current) return
      setOverview(o); setSources(s); setPages(p); setDevicesGeo(dg); setKeyEvents(ke)
    })
  }, [startDate, endDate, locationSlug, compare, ga4Status?.authorized, ga4Status?.has_property_id])

  if (!ga4Status?.has_property_id) {
    return (
      <div className="mx-4 bg-surface border border-border rounded-2xl p-5 text-center">
        <p className="text-sm font-semibold text-text-primary">Google Analytics property ID not configured</p>
        <p className="text-xs text-text-muted mt-2">Set GA4_PROPERTY_ID on the auth API.</p>
      </div>
    )
  }
  if (!ga4Status?.authorized) {
    return <p className="px-4 text-sm text-text-muted py-3">Connect Google to enable Analytics.</p>
  }

  const cur = overview?.current
  const prev = compare ? overview?.previous : null

  return (
    <div className="space-y-3 px-4">
      {/* Overview cards */}
      {overview && cur ? (
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Sessions" current={cur.sessions} previous={prev?.sessions} />
          <StatCard label="Users" current={cur.users} previous={prev?.users} />
          <StatCard label="New Users" current={cur.new_users} previous={prev?.new_users} />
          <StatCard label="Engagement" value={fmtPct(cur.engagement_rate)} current={cur.engagement_rate} previous={prev?.engagement_rate} />
          <StatCard label="Avg Duration" value={fmtDuration(cur.avg_session_duration)} current={cur.avg_session_duration} previous={prev?.avg_session_duration} />
        </div>
      ) : errors.overview ? (
        <div className="bg-surface border border-border rounded-2xl p-3 text-sm text-wcs-red">{errors.overview}</div>
      ) : (
        <p className="text-sm text-text-muted py-2 text-center">Loading overview...</p>
      )}

      {/* Top Channels */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Top Channels</p>
        {errors.sources ? (
          <p className="text-sm text-wcs-red">{errors.sources}</p>
        ) : !sources ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : sources.channels?.length ? (
          <div className="space-y-1">
            {sources.channels.map(c => (
              <div key={c.name} className="flex items-center justify-between text-sm py-1 border-t border-border first:border-t-0">
                <span className="text-text-primary truncate">{c.name}</span>
                <span className="font-semibold text-text-primary">{fmtNum(c.sessions)}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-text-muted">No data</p>}
      </div>

      {/* Top Sources */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Top Sources</p>
        {errors.sources ? (
          <p className="text-sm text-wcs-red">{errors.sources}</p>
        ) : !sources ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : sources.sources?.length ? (
          <div className="space-y-1">
            {sources.sources.map(s => (
              <div key={s.name} className="flex items-center justify-between text-sm py-1 border-t border-border first:border-t-0 gap-2">
                <span className="text-text-primary truncate">{s.name}</span>
                <span className="font-semibold text-text-primary shrink-0">{fmtNum(s.sessions)}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-text-muted">No data</p>}
      </div>

      {/* Top Pages */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Top Pages</p>
        {errors.pages ? (
          <p className="text-sm text-wcs-red">{errors.pages}</p>
        ) : !pages ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : pages.pages?.length ? (
          <div className="space-y-2">
            {pages.pages.map((p, i) => (
              <div key={p.path + i} className="border-t border-border first:border-t-0 pt-2 first:pt-0">
                <p className="text-xs text-text-primary truncate" title={p.title}>{p.path}</p>
                <div className="flex items-center justify-between text-[11px] text-text-muted mt-1">
                  <span>Views: <span className="font-semibold text-text-primary">{fmtNum(p.views)}</span></span>
                  <span>Sessions: <span className="font-semibold text-text-primary">{fmtNum(p.sessions)}</span></span>
                  <span>Users: <span className="font-semibold text-text-primary">{fmtNum(p.users)}</span></span>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-text-muted">No data</p>}
      </div>

      {/* Devices */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-3">Devices</p>
        {errors.devicesGeo ? (
          <p className="text-sm text-wcs-red">{errors.devicesGeo}</p>
        ) : !devicesGeo ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : devicesGeo.devices?.length ? (
          <PieChartSmall
            data={Object.fromEntries(devicesGeo.devices.map(d => [d.category, d.sessions]))}
            colorMap={{ desktop: '#3182ce', mobile: '#38a169', tablet: '#d69e2e' }}
          />
        ) : <p className="text-sm text-text-muted">No data</p>}
      </div>

      {/* Top Cities */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Top Cities</p>
        {errors.devicesGeo ? (
          <p className="text-sm text-wcs-red">{errors.devicesGeo}</p>
        ) : !devicesGeo ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : devicesGeo.cities?.length ? (
          <div className="space-y-1">
            {devicesGeo.cities.map(c => (
              <div key={c.name} className="flex items-center justify-between text-sm py-1 border-t border-border first:border-t-0">
                <span className="text-text-primary truncate">{c.name || '(unknown)'}</span>
                <span className="font-semibold text-text-primary">{fmtNum(c.sessions)}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-text-muted">No data</p>}
      </div>

      {/* Key Events */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Key Events</p>
        {errors.keyEvents ? (
          <p className="text-sm text-wcs-red">{errors.keyEvents}</p>
        ) : !keyEvents ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : keyEvents.events?.length ? (
          <div className="space-y-2">
            {keyEvents.events.map(e => (
              <div key={e.name} className="border-t border-border first:border-t-0 pt-2 first:pt-0">
                <p className="text-sm font-medium text-text-primary">{e.name}</p>
                <div className="flex items-center justify-between text-[11px] text-text-muted mt-0.5">
                  <span>Key Events: <span className="font-semibold text-text-primary">{fmtNum(e.key_event_count)}</span></span>
                  <span>Total: <span className="font-semibold text-text-primary">{fmtNum(e.event_count)}</span></span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-2">
            <p className="text-xs text-text-muted">No key events configured yet</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MobileGoogleMarketing() {
  const [gbpStatus, setGbpStatus] = useState(null)
  const [gaStatus, setGaStatus] = useState(null)
  const [activeQuick, setActiveQuick] = useState('last_30')
  const initial = getQuickRange('last_30')
  const [startDate, setStartDate] = useState(initial.start)
  const [endDate, setEndDate] = useState(initial.end)
  const [locationSlug, setLocationSlug] = useState('all')
  const [compare, setCompare] = useState(true)

  useEffect(() => {
    Promise.all([
      getGoogleBusinessStatus().catch(() => ({ authorized: false })),
      getGoogleAnalyticsStatus().catch(() => ({ authorized: false, scope_missing: false, has_property_id: false })),
    ]).then(([gbp, ga]) => {
      setGbpStatus(gbp)
      setGaStatus(ga)
    })
  }, [])

  function applyQuickRange(key) {
    setActiveQuick(key)
    const r = getQuickRange(key)
    setStartDate(r.start)
    setEndDate(r.end)
  }

  function handleDateChange(field, value) {
    setActiveQuick(null)
    if (field === 'start') setStartDate(value)
    else setEndDate(value)
  }

  function handleConnect() {
    window.open(API_URL + '/google-business/authorize', '_blank', 'width=500,height=700')
  }

  const needsConnect = gbpStatus && !gbpStatus.authorized
  const needsScopeUpgrade = gaStatus && gaStatus.scope_missing

  return (
    <div className="space-y-4 pb-6">
      {/* Header card */}
      <div className="mx-4 mt-3 bg-surface/95 backdrop-blur-sm rounded-2xl border border-border p-4 space-y-3">
        {/* Location pills */}
        <div className="overflow-x-auto scrollbar-hide -mx-1">
          <div className="flex gap-2 min-w-max px-1">
            {LOCATIONS.map(loc => (
              <button
                key={loc.slug}
                onClick={() => setLocationSlug(loc.slug)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  locationSlug === loc.slug
                    ? 'bg-wcs-red text-white'
                    : 'bg-surface border border-border text-text-secondary'
                }`}
              >
                {loc.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quick range pills */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1">
          <div className="flex gap-2 min-w-max px-1">
            {QUICK_RANGES.map(qr => (
              <button
                key={qr.key}
                onClick={() => applyQuickRange(qr.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  activeQuick === qr.key
                    ? 'bg-wcs-red text-white'
                    : 'bg-surface border border-border text-text-secondary'
                }`}
              >
                {qr.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom dates */}
        <div className="flex gap-2">
          <input
            type="date"
            value={startDate}
            onChange={e => handleDateChange('start', e.target.value)}
            className="flex-1 bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text-primary"
          />
          <input
            type="date"
            value={endDate}
            onChange={e => handleDateChange('end', e.target.value)}
            className="flex-1 bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text-primary"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />
          Compare to prior period
        </label>
      </div>

      {needsConnect && (
        <ConnectBanner onReconnect={handleConnect} message="Authorize Google to load Business Profile + Analytics data." />
      )}
      {!needsConnect && needsScopeUpgrade && (
        <ConnectBanner onReconnect={handleConnect} message="Reconnect Google to grant Analytics access — you'll be prompted to approve the new scope." />
      )}

      <SectionHeader title="Google Business Profile" />
      <GbpSection startDate={startDate} endDate={endDate} />

      <SectionHeader title="Google Analytics" />
      <GaSection
        startDate={startDate}
        endDate={endDate}
        locationSlug={locationSlug}
        compare={compare}
        ga4Status={gaStatus}
      />
    </div>
  )
}
