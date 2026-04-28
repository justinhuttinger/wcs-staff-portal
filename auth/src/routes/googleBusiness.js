const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

const GOOGLE_CLIENT_ID = process.env.GOOGLE_BUSINESS_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_BUSINESS_CLIENT_SECRET
const REDIRECT_URI = (process.env.AUTH_API_URL || 'https://api.wcstrength.com') + '/google-business/callback'
const SCOPES = 'https://www.googleapis.com/auth/business.manage https://www.googleapis.com/auth/analytics.readonly'

// Store tokens in Supabase config table (or env var as fallback)
async function getStoredTokens() {
  try {
    const { data } = await supabaseAdmin
      .from('app_config')
      .select('value')
      .eq('key', 'google_business_tokens')
      .single()
    return data?.value ? JSON.parse(data.value) : null
  } catch {
    return null
  }
}

async function storeTokens(tokens) {
  await supabaseAdmin
    .from('app_config')
    .upsert({ key: 'google_business_tokens', value: JSON.stringify(tokens) }, { onConflict: 'key' })
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error_description || data.error)
  return data.access_token
}

async function getAccessToken() {
  const tokens = await getStoredTokens()
  if (!tokens?.refresh_token) throw new Error('Google Business not authorized. Visit /google-business/authorize to connect.')

  // Check if access token is still valid (with 5 min buffer)
  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 300000) {
    return tokens.access_token
  }

  // Refresh
  const newAccessToken = await refreshAccessToken(tokens.refresh_token)
  tokens.access_token = newAccessToken
  tokens.expires_at = Date.now() + 3600 * 1000
  await storeTokens(tokens)
  return newAccessToken
}

// Cache to avoid hitting Google rate limits
const cache = {}
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

function getCached(key) {
  const entry = cache[key]
  if (entry && (Date.now() - entry.ts) < CACHE_TTL) return entry.data
  return null
}

function setCache(key, data) {
  cache[key] = { data, ts: Date.now() }
}

async function googleFetch(url, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + accessToken },
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'Google API error')
  return data
}

// GET /google-business/authorize — redirect to Google OAuth
router.get('/authorize', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).send('Google Business not configured')

  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  })
  res.redirect(url)
})

// GET /google-business/callback — OAuth callback
router.get('/callback', async (req, res) => {
  const { code, error } = req.query
  if (error) return res.status(400).send('Authorization denied: ' + error)
  if (!code) return res.status(400).send('No authorization code received')

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()
    if (tokens.error) return res.status(400).send('Token exchange failed: ' + tokens.error_description)

    // Fetch account + locations NOW (during callback, one-time) to avoid future Account Management API calls
    let locationData = []
    try {
      const accounts = await googleFetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', tokens.access_token)
      const accountName = accounts.accounts?.[0]?.name
      if (accountName) {
        const locs = await googleFetch(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,storefrontAddress`,
          tokens.access_token
        )
        locationData = (locs.locations || []).map(l => ({
          name: l.name,
          title: l.title || '',
          city: l.storefrontAddress?.locality || '',
        }))
      }
    } catch (e) {
      console.warn('[Google Business] Could not fetch locations during auth:', e.message)
    }

    await storeTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
      scope: tokens.scope || '',
      locations: locationData,
    })

    // Also cache the locations
    if (locationData.length > 0) {
      setCache('locations', { locations: locationData })
    }

    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Google Business Profile connected!</h2><p>Found ${locationData.length} locations. You can close this tab and go back to the portal.</p></body></html>`)
  } catch (err) {
    res.status(500).send('Authorization failed: ' + err.message)
  }
})

// GET /google-business/status — check if authorized
router.get('/status', authenticate, requireRole('corporate'), async (req, res) => {
  const tokens = await getStoredTokens()
  res.json({ authorized: !!(tokens?.refresh_token) })
})

// GET /google-business/locations — list all business locations (cached 10 min)
router.get('/locations', authenticate, requireRole('corporate'), async (req, res) => {
  const cached = getCached('locations')
  if (cached) return res.json(cached)

  try {
    const token = await getAccessToken()

    // First get accounts
    const accounts = await googleFetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', token)
    const accountName = accounts.accounts?.[0]?.name
    if (!accountName) return res.json({ locations: [] })

    // Then get locations for the first account
    const locs = await googleFetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,storefrontAddress`,
      token
    )

    const locations = (locs.locations || []).map(l => ({
      name: l.name, // e.g. "locations/12345"
      title: l.title, // e.g. "West Coast Strength - Salem"
      address: l.storefrontAddress?.locality || '',
    }))

    const result = { locations }
    setCache('locations', result)
    res.json(result)
  } catch (err) {
    console.error('[Google Business] Locations error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /google-business/performance — get performance metrics for all locations (cached 10 min)
router.get('/performance', authenticate, requireRole('corporate'), async (req, res) => {
  const { start_date, end_date, location_name } = req.query
  const cacheKey = `perf:${start_date}:${end_date}:${location_name || 'all'}`
  const cached = getCached(cacheKey)
  if (cached) return res.json(cached)

  try {
    const token = await getAccessToken()

    // Get locations from stored tokens (fetched during authorization) — NO API call needed
    let locationData = []
    if (location_name) {
      locationData = [{ name: location_name, title: location_name }]
    } else {
      const cachedLocs = getCached('locations')
      if (cachedLocs?.locations) {
        locationData = cachedLocs.locations
      } else {
        // Read from stored tokens (locations saved during OAuth callback)
        const tokens = await getStoredTokens()
        if (tokens?.locations?.length) {
          locationData = tokens.locations
          setCache('locations', { locations: locationData })
        } else {
          return res.json({ metrics: [], error: 'No locations found. Try reconnecting Google Business Profile.' })
        }
      }
    }
    const locationNames = locationData.map(l => l.name)
    const locationTitles = {}
    for (const l of locationData) locationTitles[l.name] = l.title

    // Build date range
    const start = start_date ? new Date(start_date) : new Date(Date.now() - 30 * 86400000)
    const end = end_date ? new Date(end_date) : new Date()

    const dailyRange = {
      startDate: { year: start.getFullYear(), month: start.getMonth() + 1, day: start.getDate() },
      endDate: { year: end.getFullYear(), month: end.getMonth() + 1, day: end.getDate() },
    }

    const metrics = []
    for (const locName of locationNames) {
      try {
        const data = await googleFetch(
          `https://businessprofileperformance.googleapis.com/v1/${locName}:fetchMultiDailyMetricsTimeSeries?` +
          (() => {
            const params = new URLSearchParams()
            params.append('dailyMetrics', 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS')
            params.append('dailyMetrics', 'WEBSITE_CLICKS')
            params.append('dailyMetrics', 'CALL_CLICKS')
            params.append('dailyMetrics', 'BUSINESS_DIRECTION_REQUESTS')
            params.append('dailyRange.startDate.year', dailyRange.startDate.year)
            params.append('dailyRange.startDate.month', dailyRange.startDate.month)
            params.append('dailyRange.startDate.day', dailyRange.startDate.day)
            params.append('dailyRange.endDate.year', dailyRange.endDate.year)
            params.append('dailyRange.endDate.month', dailyRange.endDate.month)
            params.append('dailyRange.endDate.day', dailyRange.endDate.day)
            return params
          })(),
          token
        )

        // Sum up daily values for each metric
        const totals = { location: locName, title: locationTitles[locName] || locName, searches: 0, website_clicks: 0, calls: 0, directions: 0 }
        for (const series of (data.multiDailyMetricTimeSeries || [])) {
          const metric = series.dailyMetric
          const total = (series.timeSeries?.datedValues || []).reduce((sum, dv) => sum + (parseInt(dv.value) || 0), 0)
          if (metric === 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS') totals.searches = total
          if (metric === 'WEBSITE_CLICKS') totals.website_clicks = total
          if (metric === 'CALL_CLICKS') totals.calls = total
          if (metric === 'BUSINESS_DIRECTION_REQUESTS') totals.directions = total
        }
        metrics.push(totals)
      } catch (e) {
        console.warn(`[Google Business] Performance error for ${locName}:`, e.message)
        metrics.push({ location: locName, title: locationTitles[locName] || locName, error: e.message })
      }
    }

    const result = { metrics }
    setCache(cacheKey, result)
    res.json(result)
  } catch (err) {
    console.error('[Google Business] Performance error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.getAccessToken = getAccessToken
module.exports.getStoredTokens = getStoredTokens
