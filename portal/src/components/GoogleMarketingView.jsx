import { useState, useEffect, useRef } from 'react'
import {
  getGoogleBusinessStatus,
  getGoogleBusinessPerformance,
  getGoogleAnalyticsStatus,
  getGoogleAnalyticsOverview,
  getGoogleAnalyticsSources,
  getGoogleAnalyticsPages,
  getGoogleAnalyticsDevicesGeo,
  getGoogleAnalyticsKeyEvents,
} from '../lib/api'
import { LOCATION_OPTIONS as LOCATIONS } from '../config/locations'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const QUICK_RANGES = [
  { key: 'last_7', label: '7 Days' },
  { key: 'last_30', label: '30 Days' },
  { key: 'last_90', label: '90 Days' },
]

function getQuickRange(key) {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const days = key === 'last_7' ? 7 : key === 'last_30' ? 30 : 90
  const s = new Date(now)
  s.setDate(s.getDate() - days)
  return { start: s.toISOString().slice(0, 10), end: today }
}

function fmtNum(v) {
  return Number(v || 0).toLocaleString()
}

function fmtPct(v) {
  return `${(Number(v || 0) * 100).toFixed(1)}%`
}

function fmtDuration(secs) {
  const s = Math.round(Number(secs || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m ${r}s`
}

function locDisplayName(title) {
  if (!title) return 'Unknown'
  const dash = title.lastIndexOf('-')
  if (dash > 0) return title.substring(dash + 1).trim()
  return title
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

function DeltaChip({ current, previous, kind = 'up_good' }) {
  if (previous === null || previous === undefined) return null
  const cur = Number(current || 0)
  const prev = Number(previous || 0)
  if (prev === 0 && cur === 0) {
    return <span className="text-[11px] text-text-muted">no prior data</span>
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
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      <span>{arrow}</span>
      <span>{sign}{delta.toFixed(1)}%</span>
    </span>
  )
}

function StatCard({ label, value, current, previous, fmt = fmtNum, kind = 'up_good' }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</p>
      <div className="flex items-baseline gap-2 mt-2">
        <p className="text-2xl font-bold text-text-primary">{value !== undefined ? value : fmt(current)}</p>
        {previous !== undefined && <DeltaChip current={current} previous={previous} kind={kind} />}
      </div>
    </div>
  )
}

function ConnectBanner({ onReconnect, message }) {
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-yellow-900">Google account not connected</p>
        <p className="text-xs text-yellow-800 mt-1">{message}</p>
      </div>
      <button
        onClick={onReconnect}
        className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-red-700 transition-colors flex-shrink-0"
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
    <div className="flex items-center gap-4">
      <div
        className="w-24 h-24 rounded-full flex-shrink-0"
        style={{ background: `conic-gradient(${stops.join(', ')})` }}
      />
      <div className="space-y-1">
        {entries.map(([k, v], i) => {
          const c = (colorMap && colorMap[k]) || COLORS[i % COLORS.length]
          return (
            <div key={k} className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
              <span className="text-text-muted capitalize">{k}</span>
              <span className="font-semibold text-text-primary">{fmtNum(v)}</span>
              <span className="text-text-muted">({Math.round((v / total) * 100)}%)</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 1: GBP
// ---------------------------------------------------------------------------

function GbpSection({ startDate, endDate }) {
  const [metrics, setMetrics] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setLoading(true)
    setError(null)
    getGoogleBusinessPerformance({ start_date: startDate, end_date: endDate })
      .then(res => {
        if (id !== reqRef.current) return
        setMetrics(res.metrics || [])
        setLoading(false)
      })
      .catch(err => {
        if (id !== reqRef.current) return
        setError(err.message)
        setLoading(false)
      })
  }, [startDate, endDate])

  if (loading) return <p className="text-text-muted text-sm py-6 text-center">Loading Business Profile data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!metrics.length) return <p className="text-text-muted text-sm py-4">No locations found.</p>

  const totals = metrics.reduce((acc, m) => {
    if (m.error) return acc
    acc.searches += m.searches || 0
    acc.website_clicks += m.website_clicks || 0
    acc.calls += m.calls || 0
    acc.directions += m.directions || 0
    return acc
  }, { searches: 0, website_clicks: 0, calls: 0, directions: 0 })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Map Impressions" current={totals.searches} />
        <StatCard label="Website Clicks" current={totals.website_clicks} />
        <StatCard label="Calls" current={totals.calls} />
        <StatCard label="Directions" current={totals.directions} />
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wide">Location</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wide">Map Impressions</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wide">Website</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wide">Calls</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wide">Directions</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(m => (
              <tr key={m.location} className="border-t border-border">
                <td className="px-4 py-2 font-semibold text-text-primary">{locDisplayName(m.title)}</td>
                {m.error ? (
                  <td colSpan={4} className="px-4 py-2 text-xs text-wcs-red">{m.error}</td>
                ) : (
                  <>
                    <td className="px-4 py-2 text-right">{fmtNum(m.searches)}</td>
                    <td className="px-4 py-2 text-right">{fmtNum(m.website_clicks)}</td>
                    <td className="px-4 py-2 text-right">{fmtNum(m.calls)}</td>
                    <td className="px-4 py-2 text-right">{fmtNum(m.directions)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 2: GA4
// ---------------------------------------------------------------------------

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
      setOverview(o)
      setSources(s)
      setPages(p)
      setDevicesGeo(dg)
      setKeyEvents(ke)
    })
  }, [startDate, endDate, locationSlug, compare, ga4Status?.authorized, ga4Status?.has_property_id])

  if (!ga4Status?.has_property_id) {
    return (
      <div className="bg-surface border border-border rounded-xl p-6 text-center">
        <p className="text-sm font-semibold text-text-primary">Google Analytics property ID not configured</p>
        <p className="text-xs text-text-muted mt-2">Set <code className="bg-bg px-1 rounded">GA4_PROPERTY_ID</code> on the auth API or save it under <code className="bg-bg px-1 rounded">app_config.ga4_property_id</code>.</p>
      </div>
    )
  }
  if (!ga4Status?.authorized) {
    return <p className="text-sm text-text-muted py-4">Connect Google to enable Analytics.</p>
  }

  const cur = overview?.current
  const prev = compare ? overview?.previous : null

  return (
    <div className="space-y-4">
      {/* Overview cards */}
      {overview && cur ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <StatCard label="Sessions" current={cur.sessions} previous={prev?.sessions} />
          <StatCard label="Users" current={cur.users} previous={prev?.users} />
          <StatCard label="New Users" current={cur.new_users} previous={prev?.new_users} />
          <StatCard label="Engagement Rate" value={fmtPct(cur.engagement_rate)} current={cur.engagement_rate} previous={prev?.engagement_rate} />
          <StatCard label="Avg Duration" value={fmtDuration(cur.avg_session_duration)} current={cur.avg_session_duration} previous={prev?.avg_session_duration} />
        </div>
      ) : errors.overview ? (
        <div className="bg-surface border border-border rounded-xl p-4 text-sm text-wcs-red">{errors.overview}</div>
      ) : (
        <p className="text-text-muted text-sm py-4 text-center">Loading overview...</p>
      )}

      {/* Sources */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Top Channels</p>
          {errors.sources ? (
            <p className="text-sm text-wcs-red">{errors.sources}</p>
          ) : !sources ? (
            <p className="text-sm text-text-muted">Loading...</p>
          ) : sources.channels?.length ? (
            <table className="w-full text-sm">
              <tbody>
                {sources.channels.map(c => (
                  <tr key={c.name} className="border-t border-border first:border-t-0">
                    <td className="py-1.5 text-text-primary">{c.name}</td>
                    <td className="py-1.5 text-right font-semibold">{fmtNum(c.sessions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-text-muted">No data</p>}
        </div>

        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Top Sources</p>
          {errors.sources ? (
            <p className="text-sm text-wcs-red">{errors.sources}</p>
          ) : !sources ? (
            <p className="text-sm text-text-muted">Loading...</p>
          ) : sources.sources?.length ? (
            <table className="w-full text-sm">
              <tbody>
                {sources.sources.map(s => (
                  <tr key={s.name} className="border-t border-border first:border-t-0">
                    <td className="py-1.5 text-text-primary truncate max-w-[180px]">{s.name}</td>
                    <td className="py-1.5 text-right font-semibold">{fmtNum(s.sessions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-text-muted">No data</p>}
        </div>
      </div>

      {/* Top pages */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Top Pages</p>
        {errors.pages ? (
          <p className="text-sm text-wcs-red">{errors.pages}</p>
        ) : !pages ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : pages.pages?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-text-muted uppercase">
                <th className="text-left py-1.5 font-semibold">Page</th>
                <th className="text-right py-1.5 font-semibold">Views</th>
                <th className="text-right py-1.5 font-semibold">Sessions</th>
                <th className="text-right py-1.5 font-semibold">Users</th>
              </tr>
            </thead>
            <tbody>
              {pages.pages.map((p, i) => (
                <tr key={p.path + i} className="border-t border-border">
                  <td className="py-1.5 text-text-primary truncate max-w-[280px]" title={p.title}>{p.path}</td>
                  <td className="py-1.5 text-right">{fmtNum(p.views)}</td>
                  <td className="py-1.5 text-right">{fmtNum(p.sessions)}</td>
                  <td className="py-1.5 text-right">{fmtNum(p.users)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-text-muted">No data</p>}
      </div>

      {/* Devices + cities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Devices</p>
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

        <div className="bg-surface border border-border rounded-xl p-5">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Top Cities</p>
          {errors.devicesGeo ? (
            <p className="text-sm text-wcs-red">{errors.devicesGeo}</p>
          ) : !devicesGeo ? (
            <p className="text-sm text-text-muted">Loading...</p>
          ) : devicesGeo.cities?.length ? (
            <table className="w-full text-sm">
              <tbody>
                {devicesGeo.cities.map(c => (
                  <tr key={c.name} className="border-t border-border first:border-t-0">
                    <td className="py-1.5 text-text-primary">{c.name || '(unknown)'}</td>
                    <td className="py-1.5 text-right font-semibold">{fmtNum(c.sessions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-text-muted">No data</p>}
        </div>
      </div>

      {/* Key events */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Key Events</p>
        {errors.keyEvents ? (
          <p className="text-sm text-wcs-red">{errors.keyEvents}</p>
        ) : !keyEvents ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : keyEvents.events?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-text-muted uppercase">
                <th className="text-left py-1.5 font-semibold">Event</th>
                <th className="text-right py-1.5 font-semibold">Key Events</th>
                <th className="text-right py-1.5 font-semibold">Total Events</th>
              </tr>
            </thead>
            <tbody>
              {keyEvents.events.map(e => (
                <tr key={e.name} className="border-t border-border">
                  <td className="py-1.5 text-text-primary font-medium">{e.name}</td>
                  <td className="py-1.5 text-right font-semibold">{fmtNum(e.key_event_count)}</td>
                  <td className="py-1.5 text-right text-text-muted">{fmtNum(e.event_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-text-muted">No key events configured yet</p>
            <p className="text-xs text-text-muted mt-2">Turn on GA4 Enhanced Measurement to auto-capture phone clicks and form submits, then mark them as "Key events" in GA4 admin.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function GoogleMarketingView({ onBack }) {
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
    <div className="w-full px-8 py-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Marketing
          </button>
        )}
        <h2 className="text-xl font-bold text-text-primary mb-4">Google — Business + Analytics</h2>

        <div className="flex flex-wrap gap-2 mb-4">
          {LOCATIONS.map(loc => (
            <button
              key={loc.slug}
              onClick={() => setLocationSlug(loc.slug)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                locationSlug === loc.slug
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-bg text-text-muted border-border hover:text-text-primary hover:border-text-muted'
              }`}
            >
              {loc.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 justify-end">
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />
            Compare to prior period
          </label>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_RANGES.map(qr => (
              <button
                key={qr.key}
                onClick={() => applyQuickRange(qr.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  activeQuick === qr.key
                    ? 'bg-text-primary text-white border-text-primary'
                    : 'bg-bg text-text-muted border-border hover:text-text-primary'
                }`}
              >
                {qr.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted">From</label>
            <input
              type="date"
              value={startDate}
              onChange={e => handleDateChange('start', e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
            <label className="text-xs text-text-muted">To</label>
            <input
              type="date"
              value={endDate}
              onChange={e => handleDateChange('end', e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
          </div>
        </div>
      </div>

      {needsConnect && (
        <div className="mb-6">
          <ConnectBanner
            onReconnect={handleConnect}
            message="Authorize Google to load Business Profile + Analytics data."
          />
        </div>
      )}
      {!needsConnect && needsScopeUpgrade && (
        <div className="mb-6">
          <ConnectBanner
            onReconnect={handleConnect}
            message="Reconnect Google to grant Analytics access — you'll be prompted to approve the new scope."
          />
        </div>
      )}

      <div className="space-y-6">
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
    </div>
  )
}
