const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { getAccessToken, getStoredTokens } = require('./googleBusiness')

const router = Router()

const GA_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const ENV_PROPERTY_ID = process.env.GA4_PROPERTY_ID

// 10-minute in-memory cache
const cache = {}
const CACHE_TTL = 10 * 60 * 1000

function getCached(key) {
  const e = cache[key]
  if (e && Date.now() - e.ts < CACHE_TTL) return e.data
  return null
}
function setCache(key, data) { cache[key] = { data, ts: Date.now() } }

async function getPropertyId() {
  if (ENV_PROPERTY_ID) return ENV_PROPERTY_ID
  try {
    const { data } = await supabaseAdmin
      .from('app_config')
      .select('value')
      .eq('key', 'ga4_property_id')
      .single()
    return data?.value || null
  } catch {
    return null
  }
}

function todayISO() { return new Date().toISOString().slice(0, 10) }

function dateMinus(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function rangeLengthDays(start, end) {
  const s = new Date(start + 'T00:00:00Z').getTime()
  const e = new Date(end + 'T00:00:00Z').getTime()
  return Math.round((e - s) / 86400000) + 1
}

function previousRange(start, end) {
  const len = rangeLengthDays(start, end)
  const prevEnd = dateMinus(start, 1)
  const prevStart = dateMinus(prevEnd, len - 1)
  return { startDate: prevStart, endDate: prevEnd }
}

function buildLocationFilter(locationSlug) {
  if (!locationSlug || locationSlug === 'all') return null
  return {
    filter: {
      fieldName: 'pagePath',
      stringFilter: {
        matchType: 'BEGINS_WITH',
        value: '/' + locationSlug,
        caseSensitive: false,
      },
    },
  }
}

async function runReport(propertyId, body) {
  const token = await getAccessToken()
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (data.error) {
    const msg = data.error.message || 'GA4 API error'
    const err = new Error(msg)
    err.status = data.error.code || 500
    throw err
  }
  return data
}

// Sum a metric column from a runReport response
function sumMetric(report, metricIdx) {
  let total = 0
  for (const row of (report.rows || [])) {
    const v = row.metricValues?.[metricIdx]?.value
    total += parseFloat(v) || 0
  }
  return total
}

// Average a metric column weighted by another, OR a simple mean
function avgMetric(report, metricIdx) {
  const rows = report.rows || []
  if (rows.length === 0) return 0
  let sum = 0
  for (const row of rows) {
    sum += parseFloat(row.metricValues?.[metricIdx]?.value) || 0
  }
  return sum / rows.length
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

async function tokensWithAnalyticsScope() {
  const tokens = await getStoredTokens()
  if (!tokens?.refresh_token) return { ok: false, reason: 'no_tokens' }
  const scopeStr = tokens.scope || ''
  // Older tokens may not have stored scope; we treat absence as "unknown" and
  // let the actual API call surface a permission error.
  if (scopeStr && !scopeStr.includes('analytics.readonly')) {
    return { ok: false, reason: 'scope_missing' }
  }
  return { ok: true, tokens }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /google-analytics/status
router.get('/status', authenticate, requireRole('corporate'), async (req, res) => {
  const tokens = await getStoredTokens()
  const propertyId = await getPropertyId()
  const scopeStr = tokens?.scope || ''
  const scopeMissing = !!tokens && !!scopeStr && !scopeStr.includes('analytics.readonly')
  res.json({
    authorized: !!(tokens?.refresh_token),
    scope_missing: scopeMissing,
    has_property_id: !!propertyId,
  })
})

// Fetch overview metrics + per-day time series for a date range
async function fetchOverview(propertyId, startDate, endDate, locationSlug) {
  const dimensionFilter = buildLocationFilter(locationSlug)

  // Totals
  const totalsBody = {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'engagementRate' },
      { name: 'averageSessionDuration' },
    ],
  }
  if (dimensionFilter) totalsBody.dimensionFilter = dimensionFilter
  const totalsReport = await runReport(propertyId, totalsBody)
  const row = totalsReport.rows?.[0]
  const totals = row ? {
    sessions: parseFloat(row.metricValues[0].value) || 0,
    users: parseFloat(row.metricValues[1].value) || 0,
    new_users: parseFloat(row.metricValues[2].value) || 0,
    engagement_rate: parseFloat(row.metricValues[3].value) || 0,
    avg_session_duration: parseFloat(row.metricValues[4].value) || 0,
  } : { sessions: 0, users: 0, new_users: 0, engagement_rate: 0, avg_session_duration: 0 }

  // Daily series (sessions only — keep payload small)
  const seriesBody = {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  }
  if (dimensionFilter) seriesBody.dimensionFilter = dimensionFilter
  const seriesReport = await runReport(propertyId, seriesBody)
  const series = (seriesReport.rows || []).map(r => ({
    date: r.dimensionValues[0].value,
    sessions: parseFloat(r.metricValues[0].value) || 0,
    users: parseFloat(r.metricValues[1].value) || 0,
  }))

  return { ...totals, series }
}

// GET /google-analytics/overview
router.get('/overview', authenticate, requireRole('corporate'), async (req, res) => {
  try {
    const propertyId = await getPropertyId()
    if (!propertyId) return res.status(400).json({ error: 'GA4 property ID not configured' })

    const guard = await tokensWithAnalyticsScope()
    if (!guard.ok) return res.status(400).json({ error: 'Google Analytics not authorized', reason: guard.reason })

    const startDate = req.query.start_date || dateMinus(todayISO(), 30)
    const endDate = req.query.end_date || todayISO()
    const locationSlug = req.query.location_slug || 'all'
    const compare = req.query.compare === 'true' || req.query.compare === '1'

    const cacheKey = `overview:${propertyId}:${startDate}:${endDate}:${locationSlug}:${compare}`
    const cached = getCached(cacheKey)
    if (cached) return res.json(cached)

    const current = await fetchOverview(propertyId, startDate, endDate, locationSlug)
    let previous = null
    if (compare) {
      const prev = previousRange(startDate, endDate)
      previous = await fetchOverview(propertyId, prev.startDate, prev.endDate, locationSlug)
    }

    const result = compare ? { current, previous } : { current }
    setCache(cacheKey, result)
    res.json(result)
  } catch (err) {
    console.error('[GA4] overview error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /google-analytics/sources
router.get('/sources', authenticate, requireRole('corporate'), async (req, res) => {
  try {
    const propertyId = await getPropertyId()
    if (!propertyId) return res.status(400).json({ error: 'GA4 property ID not configured' })

    const startDate = req.query.start_date || dateMinus(todayISO(), 30)
    const endDate = req.query.end_date || todayISO()
    const locationSlug = req.query.location_slug || 'all'

    const cacheKey = `sources:${propertyId}:${startDate}:${endDate}:${locationSlug}`
    const cached = getCached(cacheKey)
    if (cached) return res.json(cached)

    const dimensionFilter = buildLocationFilter(locationSlug)

    const channelsBody = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    }
    if (dimensionFilter) channelsBody.dimensionFilter = dimensionFilter

    const sourcesBody = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    }
    if (dimensionFilter) sourcesBody.dimensionFilter = dimensionFilter

    const [channelsReport, sourcesReport] = await Promise.all([
      runReport(propertyId, channelsBody),
      runReport(propertyId, sourcesBody),
    ])

    const channels = (channelsReport.rows || []).map(r => ({
      name: r.dimensionValues[0].value,
      sessions: parseFloat(r.metricValues[0].value) || 0,
      users: parseFloat(r.metricValues[1].value) || 0,
    }))
    const sources = (sourcesReport.rows || []).map(r => ({
      name: r.dimensionValues[0].value,
      sessions: parseFloat(r.metricValues[0].value) || 0,
      users: parseFloat(r.metricValues[1].value) || 0,
    }))

    const result = { channels, sources }
    setCache(cacheKey, result)
    res.json(result)
  } catch (err) {
    console.error('[GA4] sources error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /google-analytics/pages
router.get('/pages', authenticate, requireRole('corporate'), async (req, res) => {
  try {
    const propertyId = await getPropertyId()
    if (!propertyId) return res.status(400).json({ error: 'GA4 property ID not configured' })

    const startDate = req.query.start_date || dateMinus(todayISO(), 30)
    const endDate = req.query.end_date || todayISO()
    const locationSlug = req.query.location_slug || 'all'

    const cacheKey = `pages:${propertyId}:${startDate}:${endDate}:${locationSlug}`
    const cached = getCached(cacheKey)
    if (cached) return res.json(cached)

    const dimensionFilter = buildLocationFilter(locationSlug)
    const body = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'sessions' },
        { name: 'totalUsers' },
      ],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10,
    }
    if (dimensionFilter) body.dimensionFilter = dimensionFilter

    const report = await runReport(propertyId, body)
    const pages = (report.rows || []).map(r => ({
      path: r.dimensionValues[0].value,
      title: r.dimensionValues[1].value,
      views: parseFloat(r.metricValues[0].value) || 0,
      sessions: parseFloat(r.metricValues[1].value) || 0,
      users: parseFloat(r.metricValues[2].value) || 0,
    }))

    const result = { pages }
    setCache(cacheKey, result)
    res.json(result)
  } catch (err) {
    console.error('[GA4] pages error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /google-analytics/devices-geo
router.get('/devices-geo', authenticate, requireRole('corporate'), async (req, res) => {
  try {
    const propertyId = await getPropertyId()
    if (!propertyId) return res.status(400).json({ error: 'GA4 property ID not configured' })

    const startDate = req.query.start_date || dateMinus(todayISO(), 30)
    const endDate = req.query.end_date || todayISO()
    const locationSlug = req.query.location_slug || 'all'

    const cacheKey = `devicesgeo:${propertyId}:${startDate}:${endDate}:${locationSlug}`
    const cached = getCached(cacheKey)
    if (cached) return res.json(cached)

    const dimensionFilter = buildLocationFilter(locationSlug)

    const devicesBody = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }
    if (dimensionFilter) devicesBody.dimensionFilter = dimensionFilter

    const citiesBody = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'city' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 5,
    }
    if (dimensionFilter) citiesBody.dimensionFilter = dimensionFilter

    const [devicesReport, citiesReport] = await Promise.all([
      runReport(propertyId, devicesBody),
      runReport(propertyId, citiesBody),
    ])

    const devices = (devicesReport.rows || []).map(r => ({
      category: r.dimensionValues[0].value,
      sessions: parseFloat(r.metricValues[0].value) || 0,
    }))
    const cities = (citiesReport.rows || []).map(r => ({
      name: r.dimensionValues[0].value,
      sessions: parseFloat(r.metricValues[0].value) || 0,
      users: parseFloat(r.metricValues[1].value) || 0,
    }))

    const result = { devices, cities }
    setCache(cacheKey, result)
    res.json(result)
  } catch (err) {
    console.error('[GA4] devices-geo error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /google-analytics/key-events
// Returns key events configured in GA4. Empty array if none.
router.get('/key-events', authenticate, requireRole('corporate'), async (req, res) => {
  try {
    const propertyId = await getPropertyId()
    if (!propertyId) return res.status(400).json({ error: 'GA4 property ID not configured' })

    const startDate = req.query.start_date || dateMinus(todayISO(), 30)
    const endDate = req.query.end_date || todayISO()
    const locationSlug = req.query.location_slug || 'all'

    const cacheKey = `keyevents:${propertyId}:${startDate}:${endDate}:${locationSlug}`
    const cached = getCached(cacheKey)
    if (cached) return res.json(cached)

    const dimensionFilter = buildLocationFilter(locationSlug)
    const body = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'keyEvents' }, { name: 'eventCount' }],
      orderBys: [{ metric: { metricName: 'keyEvents' }, desc: true }],
      limit: 25,
    }
    if (dimensionFilter) body.dimensionFilter = dimensionFilter

    const report = await runReport(propertyId, body)
    const all = (report.rows || []).map(r => ({
      name: r.dimensionValues[0].value,
      key_event_count: parseFloat(r.metricValues[0].value) || 0,
      event_count: parseFloat(r.metricValues[1].value) || 0,
    }))
    // Only return rows that are actually marked as key events
    const events = all.filter(e => e.key_event_count > 0)

    const result = { events }
    setCache(cacheKey, result)
    res.json(result)
  } catch (err) {
    console.error('[GA4] key-events error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
