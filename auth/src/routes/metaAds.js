const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('lead'))

const META_API = 'https://graph.facebook.com/v21.0'

function getConfig() {
  const token = process.env.META_ACCESS_TOKEN
  const adAccountId = process.env.META_AD_ACCOUNT_ID
  if (!token || !adAccountId) throw new Error('Meta Ads not configured')
  const accountId = adAccountId.startsWith('act_') ? adAccountId : 'act_' + adAccountId
  return { token, accountId }
}

async function metaFetch(path, token) {
  const url = `${META_API}${path}${path.includes('?') ? '&' : '?'}access_token=${token}`
  const res = await fetch(url)
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'Meta API error')
  return data
}

function buildTimeRange(start_date, end_date) {
  if (start_date && end_date) {
    return `&time_range=${encodeURIComponent(JSON.stringify({ since: start_date, until: end_date }))}`
  }
  return '&date_preset=last_30d'
}

function extractMetrics(row) {
  const actions = row.actions || []
  const costPerAction = row.cost_per_action_type || []
  const leads = actions.find(a => a.action_type === 'lead')?.value || 0
  const linkClicks = actions.find(a => a.action_type === 'link_click')?.value || 0
  const landingPageViews = actions.find(a => a.action_type === 'landing_page_view')?.value || 0
  const costPerLead = costPerAction.find(a => a.action_type === 'lead')?.value || null
  return {
    spend: parseFloat(row.spend || 0),
    impressions: parseInt(row.impressions || 0),
    clicks: parseInt(row.clicks || 0),
    leads: parseInt(leads),
    link_clicks: parseInt(linkClicks),
    landing_page_views: parseInt(landingPageViews),
    cost_per_lead: costPerLead ? parseFloat(costPerLead) : null,
  }
}

// GET /meta-ads/overview — account-level metrics
router.get('/overview', async (req, res) => {
  const { start_date, end_date } = req.query
  try {
    const { token, accountId } = getConfig()
    const fields = 'spend,impressions,clicks,actions,cost_per_action_type'
    const data = await metaFetch(
      `/${accountId}/insights?fields=${fields}${buildTimeRange(start_date, end_date)}&level=account`,
      token
    )
    const row = data.data?.[0] || {}
    res.json({ ...extractMetrics(row), date_start: row.date_start, date_stop: row.date_stop })
  } catch (err) {
    console.error('[Meta Ads] Overview error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /meta-ads/campaigns — campaign list with budget + last edit
router.get('/campaigns', async (req, res) => {
  const { start_date, end_date, status } = req.query
  try {
    const { token, accountId } = getConfig()

    // Fetch campaign metadata (budget, updated_time, status, objective)
    const statusParam = status === 'all' ? '' : '&effective_status=["ACTIVE"]'
    const metaData = await metaFetch(
      `/${accountId}/campaigns?fields=name,status,objective,daily_budget,lifetime_budget,updated_time,effective_status&limit=100${statusParam}`,
      token
    )
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

    // Fetch insights per campaign
    const statusFilter = status === 'all' ? '' : `&filtering=[{"field":"campaign.effective_status","operator":"IN","value":["ACTIVE"]}]`
    const fields = 'campaign_name,campaign_id,spend,impressions,clicks,actions,cost_per_action_type'
    const data = await metaFetch(
      `/${accountId}/insights?fields=${fields}${buildTimeRange(start_date, end_date)}&level=campaign${statusFilter}&limit=100&sort=spend_descending`,
      token
    )

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

    res.json({ campaigns })
  } catch (err) {
    console.error('[Meta Ads] Campaigns error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /meta-ads/adsets?campaign_id=XXX — ad sets for a campaign
router.get('/adsets', async (req, res) => {
  const { campaign_id, start_date, end_date } = req.query
  if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' })

  try {
    const { token, accountId } = getConfig()

    // Fetch ad set metadata
    const metaData = await metaFetch(
      `/${accountId}/adsets?fields=name,status,daily_budget,lifetime_budget,updated_time,effective_status&filtering=[{"field":"campaign_id","operator":"EQUAL","value":"${campaign_id}"}]&limit=100`,
      token
    )
    const adsetMeta = {}
    for (const a of (metaData.data || [])) {
      adsetMeta[a.id] = {
        status: a.effective_status || a.status,
        daily_budget: a.daily_budget ? parseFloat(a.daily_budget) / 100 : null,
        lifetime_budget: a.lifetime_budget ? parseFloat(a.lifetime_budget) / 100 : null,
        updated_time: a.updated_time,
      }
    }

    // Fetch insights
    const fields = 'adset_name,adset_id,spend,impressions,clicks,actions,cost_per_action_type'
    const data = await metaFetch(
      `/${accountId}/insights?fields=${fields}${buildTimeRange(start_date, end_date)}&level=adset&filtering=[{"field":"campaign_id","operator":"EQUAL","value":"${campaign_id}"}]&limit=100&sort=spend_descending`,
      token
    )

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

// GET /meta-ads/ads?adset_id=XXX — ads for an ad set
router.get('/ads', async (req, res) => {
  const { adset_id, start_date, end_date } = req.query
  if (!adset_id) return res.status(400).json({ error: 'adset_id is required' })

  try {
    const { token, accountId } = getConfig()

    // Fetch ad metadata
    const metaData = await metaFetch(
      `/${accountId}/ads?fields=name,status,updated_time,effective_status&filtering=[{"field":"adset_id","operator":"EQUAL","value":"${adset_id}"}]&limit=100`,
      token
    )
    const adMeta = {}
    for (const a of (metaData.data || [])) {
      adMeta[a.id] = {
        status: a.effective_status || a.status,
        updated_time: a.updated_time,
      }
    }

    // Fetch insights
    const fields = 'ad_name,ad_id,spend,impressions,clicks,actions,cost_per_action_type'
    const data = await metaFetch(
      `/${accountId}/insights?fields=${fields}${buildTimeRange(start_date, end_date)}&level=ad&filtering=[{"field":"adset_id","operator":"EQUAL","value":"${adset_id}"}]&limit=100&sort=spend_descending`,
      token
    )

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

// GET /meta-ads/daily — daily metrics for charting
router.get('/daily', async (req, res) => {
  const { start_date, end_date } = req.query
  try {
    const { token, accountId } = getConfig()
    const fields = 'spend,impressions,clicks,actions'
    const data = await metaFetch(
      `/${accountId}/insights?fields=${fields}${buildTimeRange(start_date, end_date)}&time_increment=1&limit=90`,
      token
    )
    const daily = (data.data || []).map(row => {
      const actions = row.actions || []
      const leads = actions.find(a => a.action_type === 'lead')?.value || 0
      return {
        date: row.date_start,
        spend: parseFloat(row.spend || 0),
        impressions: parseInt(row.impressions || 0),
        clicks: parseInt(row.clicks || 0),
        leads: parseInt(leads),
      }
    })
    res.json({ daily })
  } catch (err) {
    console.error('[Meta Ads] Daily error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
