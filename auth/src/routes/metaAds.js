const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('lead'))

const META_API = 'https://graph.facebook.com/v21.0'

// Simple in-memory cache (5 min TTL) to reduce Meta API calls
const cache = {}
const CACHE_TTL = 5 * 60 * 1000

function getCached(key) {
  const entry = cache[key]
  if (entry && (Date.now() - entry.ts) < CACHE_TTL) return entry.data
  return null
}

function setCache(key, data) {
  cache[key] = { data, ts: Date.now() }
  // Prune old entries
  const now = Date.now()
  for (const k of Object.keys(cache)) {
    if ((now - cache[k].ts) > CACHE_TTL * 2) delete cache[k]
  }
}

function getConfig() {
  const token = process.env.META_ACCESS_TOKEN
  const adAccountId = process.env.META_AD_ACCOUNT_ID
  if (!token || !adAccountId) throw new Error('Meta Ads not configured')
  const accountId = adAccountId.startsWith('act_') ? adAccountId : 'act_' + adAccountId
  return { token, accountId }
}

async function metaFetch(endpoint, params, token) {
  const url = new URL(`${META_API}${endpoint}`)
  url.searchParams.set('access_token', token)
  for (const [key, val] of Object.entries(params || {})) {
    if (val !== undefined && val !== null) {
      url.searchParams.set(key, typeof val === 'object' ? JSON.stringify(val) : String(val))
    }
  }
  const res = await fetch(url.toString())
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'Meta API error')
  return data
}

function timeRange(start_date, end_date) {
  if (start_date && end_date) return { since: start_date, until: end_date }
  return undefined
}

function extractMetrics(row) {
  const actions = row.actions || []
  const costPerAction = row.cost_per_action_type || []
  const linkClicks = parseInt(actions.find(a => a.action_type === 'link_click')?.value || 0)
  const spend = parseFloat(row.spend || 0)
  return {
    spend,
    impressions: parseInt(row.impressions || 0),
    clicks: parseInt(row.clicks || 0),
    leads: parseInt(actions.find(a => a.action_type === 'lead')?.value || 0),
    link_clicks: linkClicks,
    landing_page_views: parseInt(actions.find(a => a.action_type === 'landing_page_view')?.value || 0),
    cost_per_lead: costPerAction.find(a => a.action_type === 'lead')?.value ? parseFloat(costPerAction.find(a => a.action_type === 'lead').value) : null,
    cost_per_link_click: linkClicks > 0 ? spend / linkClicks : null,
  }
}

// GET /meta-ads/overview
router.get('/overview', async (req, res) => {
  const { start_date, end_date } = req.query
  const cacheKey = `overview:${start_date}:${end_date}`
  const cached = getCached(cacheKey)
  if (cached) return res.json(cached)

  try {
    const { token, accountId } = getConfig()
    const params = {
      fields: 'spend,impressions,clicks,actions,cost_per_action_type',
      level: 'account',
    }
    const tr = timeRange(start_date, end_date)
    if (tr) params.time_range = tr
    else params.date_preset = 'last_30d'

    const data = await metaFetch(`/${accountId}/insights`, params, token)
    const row = data.data?.[0] || {}
    const result = { ...extractMetrics(row), date_start: row.date_start, date_stop: row.date_stop }
    setCache(cacheKey, result)
    res.json(result)
  } catch (err) {
    console.error('[Meta Ads] Overview error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /meta-ads/campaigns (cached 5 min)
router.get('/campaigns', async (req, res) => {
  const { start_date, end_date, status } = req.query
  const cacheKey = `campaigns:${start_date}:${end_date}:${status}`
  const cached = getCached(cacheKey)
  if (cached) return res.json(cached)

  try {
    const { token, accountId } = getConfig()

    // Fetch campaign metadata
    const metaParams = {
      fields: 'name,status,objective,daily_budget,lifetime_budget,updated_time,effective_status',
      limit: 100,
    }
    if (status !== 'all') metaParams.effective_status = JSON.stringify(['ACTIVE'])
    const metaData = await metaFetch(`/${accountId}/campaigns`, metaParams, token)
    const campaignMeta = {}
    for (const c of (metaData.data || [])) {
      campaignMeta[c.id] = {
        status: c.effective_status || c.status,
        objective: c.objective,
        daily_budget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
        lifetime_budget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
        updated_time: c.updated_time,
      }
    }

    // Fetch all ad sets to find most recent edit per campaign
    const adsetParams = { fields: 'campaign_id,updated_time', limit: 500 }
    if (status !== 'all') adsetParams.effective_status = JSON.stringify(['ACTIVE'])
    try {
      const adsetData = await metaFetch(`/${accountId}/adsets`, adsetParams, token)
      for (const as of (adsetData.data || [])) {
        const cid = as.campaign_id
        if (campaignMeta[cid] && as.updated_time) {
          const existing = campaignMeta[cid].updated_time
          if (!existing || new Date(as.updated_time) > new Date(existing)) {
            campaignMeta[cid].updated_time = as.updated_time
          }
        }
      }
    } catch (e) {
      console.warn('[Meta Ads] Could not fetch adset updated_times:', e.message)
    }

    // Fetch insights
    const insightParams = {
      fields: 'campaign_name,campaign_id,spend,impressions,clicks,actions,cost_per_action_type',
      level: 'campaign',
      limit: 100,
      sort: 'spend_descending',
    }
    const tr = timeRange(start_date, end_date)
    if (tr) insightParams.time_range = tr
    else insightParams.date_preset = 'last_30d'
    if (status !== 'all') {
      insightParams.filtering = [{ field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE'] }]
    }

    const data = await metaFetch(`/${accountId}/insights`, insightParams, token)
    const campaigns = (data.data || []).map(row => {
      const meta = campaignMeta[row.campaign_id] || {}
      return {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        ...extractMetrics(row),
        daily_budget: meta.daily_budget,
        lifetime_budget: meta.lifetime_budget,
        objective: meta.objective,
        status: meta.status,
        updated_time: meta.updated_time,
      }
    })
    const result = { campaigns }
    setCache(cacheKey, result)
    res.json(result)
  } catch (err) {
    console.error('[Meta Ads] Campaigns error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /meta-ads/adsets?campaign_id=XXX
router.get('/adsets', async (req, res) => {
  const { campaign_id, start_date, end_date } = req.query
  if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' })

  try {
    const { token, accountId } = getConfig()

    // Metadata
    const metaData = await metaFetch(`/${accountId}/adsets`, {
      fields: 'name,status,daily_budget,lifetime_budget,updated_time,effective_status',
      filtering: [{ field: 'campaign.id', operator: 'EQUAL', value: campaign_id }],
      limit: 100,
    }, token)
    const adsetMeta = {}
    for (const a of (metaData.data || [])) {
      adsetMeta[a.id] = {
        status: a.effective_status || a.status,
        daily_budget: a.daily_budget ? parseFloat(a.daily_budget) / 100 : null,
        lifetime_budget: a.lifetime_budget ? parseFloat(a.lifetime_budget) / 100 : null,
        updated_time: a.updated_time,
      }
    }

    // Insights
    const insightParams = {
      fields: 'adset_name,adset_id,spend,impressions,clicks,actions,cost_per_action_type',
      level: 'adset',
      filtering: [{ field: 'campaign.id', operator: 'EQUAL', value: campaign_id }],
      limit: 100,
      sort: 'spend_descending',
    }
    const tr = timeRange(start_date, end_date)
    if (tr) insightParams.time_range = tr
    else insightParams.date_preset = 'last_30d'

    const data = await metaFetch(`/${accountId}/insights`, insightParams, token)
    const adsets = (data.data || []).map(row => {
      const meta = adsetMeta[row.adset_id] || {}
      return {
        adset_id: row.adset_id,
        adset_name: row.adset_name,
        ...extractMetrics(row),
        daily_budget: meta.daily_budget,
        lifetime_budget: meta.lifetime_budget,
        status: meta.status,
        updated_time: meta.updated_time,
      }
    })
    res.json({ adsets })
  } catch (err) {
    console.error('[Meta Ads] Adsets error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /meta-ads/ads?adset_id=XXX
router.get('/ads', async (req, res) => {
  const { adset_id, start_date, end_date } = req.query
  if (!adset_id) return res.status(400).json({ error: 'adset_id is required' })

  try {
    const { token, accountId } = getConfig()

    // Metadata
    const metaData = await metaFetch(`/${accountId}/ads`, {
      fields: 'name,status,updated_time,effective_status',
      filtering: [{ field: 'adset.id', operator: 'EQUAL', value: adset_id }],
      limit: 100,
    }, token)
    const adMeta = {}
    for (const a of (metaData.data || [])) {
      adMeta[a.id] = { status: a.effective_status || a.status, updated_time: a.updated_time }
    }

    // Insights
    const insightParams = {
      fields: 'ad_name,ad_id,spend,impressions,clicks,actions,cost_per_action_type',
      level: 'ad',
      filtering: [{ field: 'adset.id', operator: 'EQUAL', value: adset_id }],
      limit: 100,
      sort: 'spend_descending',
    }
    const tr = timeRange(start_date, end_date)
    if (tr) insightParams.time_range = tr
    else insightParams.date_preset = 'last_30d'

    const data = await metaFetch(`/${accountId}/insights`, insightParams, token)
    const ads = (data.data || []).map(row => {
      const meta = adMeta[row.ad_id] || {}
      return {
        ad_id: row.ad_id,
        ad_name: row.ad_name,
        ...extractMetrics(row),
        status: meta.status,
        updated_time: meta.updated_time,
      }
    })
    res.json({ ads })
  } catch (err) {
    console.error('[Meta Ads] Ads error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /meta-ads/daily
router.get('/daily', async (req, res) => {
  const { start_date, end_date } = req.query
  try {
    const { token, accountId } = getConfig()
    const params = {
      fields: 'spend,impressions,clicks,actions',
      time_increment: 1,
      limit: 90,
    }
    const tr = timeRange(start_date, end_date)
    if (tr) params.time_range = tr
    else params.date_preset = 'last_30d'

    const data = await metaFetch(`/${accountId}/insights`, params, token)
    const daily = (data.data || []).map(row => {
      const actions = row.actions || []
      return {
        date: row.date_start,
        spend: parseFloat(row.spend || 0),
        impressions: parseInt(row.impressions || 0),
        clicks: parseInt(row.clicks || 0),
        leads: parseInt(actions.find(a => a.action_type === 'lead')?.value || 0),
      }
    })
    res.json({ daily })
  } catch (err) {
    console.error('[Meta Ads] Daily error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
