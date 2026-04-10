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
  // Ensure act_ prefix
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

// GET /meta-ads/overview — account-level metrics for date range
router.get('/overview', async (req, res) => {
  const { start_date, end_date } = req.query

  try {
    const { token, accountId } = getConfig()

    const fields = 'spend,impressions,clicks,cpc,ctr,actions,cost_per_action_type'
    let timeRange = ''
    if (start_date && end_date) {
      timeRange = `&time_range={"since":"${start_date}","until":"${end_date}"}`
    } else {
      timeRange = '&date_preset=last_30d'
    }

    const data = await metaFetch(
      `/${accountId}/insights?fields=${fields}${timeRange}&level=account`,
      token
    )

    const row = data.data?.[0] || {}
    const actions = row.actions || []
    const costPerAction = row.cost_per_action_type || []

    // Extract key metrics from actions array
    const leads = actions.find(a => a.action_type === 'lead')?.value || 0
    const linkClicks = actions.find(a => a.action_type === 'link_click')?.value || 0
    const landingPageViews = actions.find(a => a.action_type === 'landing_page_view')?.value || 0
    const messagingConversations = actions.find(a => a.action_type === 'onsite_conversion.messaging_conversation_started_7d')?.value || 0
    const costPerLead = costPerAction.find(a => a.action_type === 'lead')?.value || null

    res.json({
      spend: parseFloat(row.spend || 0),
      impressions: parseInt(row.impressions || 0),
      clicks: parseInt(row.clicks || 0),
      cpc: parseFloat(row.cpc || 0),
      ctr: parseFloat(row.ctr || 0),
      leads: parseInt(leads),
      link_clicks: parseInt(linkClicks),
      landing_page_views: parseInt(landingPageViews),
      messaging_conversations: parseInt(messagingConversations),
      cost_per_lead: costPerLead ? parseFloat(costPerLead) : null,
      date_start: row.date_start,
      date_stop: row.date_stop,
    })
  } catch (err) {
    console.error('[Meta Ads] Overview error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /meta-ads/campaigns — per-campaign breakdown
router.get('/campaigns', async (req, res) => {
  const { start_date, end_date, status } = req.query

  try {
    const { token, accountId } = getConfig()

    // Get campaigns
    const statusFilter = status === 'all' ? '' : `&filtering=[{"field":"campaign.effective_status","operator":"IN","value":["ACTIVE"]}]`
    const fields = 'campaign_name,campaign_id,spend,impressions,clicks,cpc,ctr,actions,cost_per_action_type'
    let timeRange = ''
    if (start_date && end_date) {
      timeRange = `&time_range={"since":"${start_date}","until":"${end_date}"}`
    } else {
      timeRange = '&date_preset=last_30d'
    }

    const data = await metaFetch(
      `/${accountId}/insights?fields=${fields}${timeRange}&level=campaign${statusFilter}&limit=100&sort=spend_descending`,
      token
    )

    const campaigns = (data.data || []).map(row => {
      const actions = row.actions || []
      const costPerAction = row.cost_per_action_type || []
      const leads = actions.find(a => a.action_type === 'lead')?.value || 0
      const costPerLead = costPerAction.find(a => a.action_type === 'lead')?.value || null

      return {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        spend: parseFloat(row.spend || 0),
        impressions: parseInt(row.impressions || 0),
        clicks: parseInt(row.clicks || 0),
        cpc: parseFloat(row.cpc || 0),
        ctr: parseFloat(row.ctr || 0),
        leads: parseInt(leads),
        cost_per_lead: costPerLead ? parseFloat(costPerLead) : null,
      }
    })

    res.json({ campaigns })
  } catch (err) {
    console.error('[Meta Ads] Campaigns error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /meta-ads/daily — daily metrics for charting
router.get('/daily', async (req, res) => {
  const { start_date, end_date } = req.query

  try {
    const { token, accountId } = getConfig()

    const fields = 'spend,impressions,clicks,actions'
    let timeRange = ''
    if (start_date && end_date) {
      timeRange = `&time_range={"since":"${start_date}","until":"${end_date}"}`
    } else {
      timeRange = '&date_preset=last_30d'
    }

    const data = await metaFetch(
      `/${accountId}/insights?fields=${fields}${timeRange}&time_increment=1&limit=90`,
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
