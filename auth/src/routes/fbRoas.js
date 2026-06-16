/**
 * /reports/fb-roas — Own-calculated ROAS for Facebook ads.
 *
 * Why this exists: Meta's reported "purchases" / "memberships sold" has been
 * unreliable. We can compute ROAS ourselves by joining:
 *   - GHL contacts tagged 'sale' with a first-touch attribution to a FB adId
 *     (date filter applied on first-touch date, i.e. created_at_ghl)
 *   - Meta Insights /ads spend for the same window
 *
 * Revenue per sale is flat $990 LTV per Justin (2026-05-11). When that needs
 * to be variable later, change FLAT_LTV or accept ?ltv= override.
 */

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireReportAccess } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

const FLAT_LTV = 990

const META_API = 'https://graph.facebook.com/v21.0'

function getMetaConfig() {
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

/**
 * Fetch FB-attributed sales within [start, end] from Supabase, grouped by adId.
 *
 * Primary path: `fb_sales_by_ad` RPC (migration 018) — aggregates in Postgres
 * with the right indexes, sub-second. Fall-back path: paginated row scan
 * (original impl) so the endpoint keeps working before the migration lands.
 *
 * Filters:
 *   - tags contains 'sale'
 *   - attribution_source->>'adId' IS NOT NULL
 *   - created_at_ghl in [start, end]  (first-touch attribution date)
 *
 * Returns Map<adId, { adId, adsetId, adsetName, campaignId, campaignName,
 *                     salesCount, sampleContactIds }>
 */
async function fetchGhlSalesByAd(startDate, endDate) {
  const startISO = startDate + 'T00:00:00.000Z'
  const endISO = endDate + 'T23:59:59.999Z'

  // Fast path: SQL aggregation via RPC.
  const rpc = await supabaseAdmin.rpc('fb_sales_by_ad', {
    start_iso: startISO,
    end_iso: endISO,
  })
  if (!rpc.error) {
    const byAd = new Map()
    for (const r of (rpc.data || [])) {
      byAd.set(r.ad_id, {
        adId: r.ad_id,
        adsetId: r.ad_group_id || null,
        adsetName: r.utm_medium || null,
        campaignId: r.campaign_id || null,
        campaignName: r.campaign_name || null,
        salesCount: parseInt(r.sales, 10) || 0,
        sampleContactIds: r.sample_ids || [],
      })
    }
    return byAd
  }
  // PGRST202 = function not found (migration not yet applied)
  const missing = rpc.error.code === 'PGRST202' || /Could not find the function/i.test(rpc.error.message || '')
  if (!missing) throw new Error(`Supabase fetch failed: ${rpc.error.message}`)

  console.warn('[FB ROAS] fb_sales_by_ad RPC missing; falling back to row scan. Apply migration 018_perf_helpers.sql.')

  // Fall-back: paginated scan + JS aggregation.
  const byAd = new Map()
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('ghl_contacts_v2')
      .select('id, attribution_source, created_at_ghl')
      .contains('tags', ['sale'])
      .not('attribution_source->>adId', 'is', null)
      .gte('created_at_ghl', startDate)
      .lte('created_at_ghl', endISO)
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`Supabase fetch failed: ${error.message}`)
    if (!data || data.length === 0) break
    for (const row of data) {
      const a = row.attribution_source || {}
      const adId = a.adId
      if (!adId) continue
      let entry = byAd.get(adId)
      if (!entry) {
        entry = {
          adId,
          adsetId: a.adGroupId || null,
          adsetName: a.utmMedium || null,
          campaignId: a.campaignId || null,
          campaignName: a.campaign || null,
          salesCount: 0,
          sampleContactIds: [],
        }
        byAd.set(adId, entry)
      }
      entry.salesCount += 1
      if (entry.sampleContactIds.length < 5) entry.sampleContactIds.push(row.id)
    }
    if (data.length < PAGE) break
    offset += PAGE
  }
  return byAd
}

/**
 * Fetch Meta Insights at level=ad for the date range. Returns Map<adId, { spend, impressions, clicks, leads }>.
 */
async function fetchMetaAdSpend(startDate, endDate) {
  const { token, accountId } = getMetaConfig()
  const byAd = new Map()
  let after = null
  const limit = 500
  const MAX_PAGES = 20  // safety cap: 20 × 500 = 10k ads max

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = {
      level: 'ad',
      fields: 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions',
      time_range: { since: startDate, until: endDate },
      limit,
    }
    if (after) params.after = after
    const data = await metaFetch(`/${accountId}/insights`, params, token)
    const rows = data.data || []
    for (const row of rows) {
      const actions = row.actions || []
      byAd.set(row.ad_id, {
        adId: row.ad_id,
        adName: row.ad_name,
        adsetId: row.adset_id,
        adsetName: row.adset_name,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        spend: parseFloat(row.spend || 0),
        impressions: parseInt(row.impressions || 0),
        clicks: parseInt(row.clicks || 0),
        leads: parseInt(actions.find(a => a.action_type === 'lead')?.value || 0),
      })
    }
    after = data.paging?.cursors?.after
    if (!after || rows.length < limit) break
  }
  return byAd
}

const router = Router()
router.use(authenticate)
// FB ROAS is part of the Meta Ads report — same grant unlocks it for custom roles.
router.use(requireReportAccess('corporate', ['meta-ads']))

/**
 * GET /reports/fb-roas
 *   ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *   [&group_by=ad|adset|campaign]   default: ad
 *   [&ltv=990]                       default: $990 (flat LTV)
 *
 * Returns:
 *   {
 *     date_range: { start, end },
 *     ltv,
 *     totals: { sales, revenue, spend, roas, cost_per_sale, ads_with_sales, ads_with_spend },
 *     rows: [
 *       { adId, adName, adsetId, adsetName, campaignId, campaignName,
 *         spend, impressions, clicks, leads_meta,
 *         sales, revenue, roas, cost_per_sale }
 *     ]
 *   }
 *
 * Notes:
 *   - sales counts contacts with tag 'sale' AND attribution_source.adId set,
 *     filtered by created_at_ghl in [start_date, end_date]. First-touch
 *     attribution: sales credit goes to the originating ad.
 *   - spend is Meta-reported spend on the ad in the same window.
 *   - rows include ads with sales but no spend (residual sales from earlier
 *     runs of an ad) and ads with spend but no sales. cost_per_sale and roas
 *     are null when the denominator is zero.
 */
router.get('/', async (req, res) => {
  const start_date = req.query.start_date
  const end_date = req.query.end_date
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' })
  }
  const ltv = req.query.ltv ? parseFloat(req.query.ltv) : FLAT_LTV
  const groupBy = (req.query.group_by || 'ad').toLowerCase()
  if (!['ad', 'adset', 'campaign'].includes(groupBy)) {
    return res.status(400).json({ error: 'group_by must be ad, adset, or campaign' })
  }

  try {
    // GHL side is required; Meta side is best-effort so a Meta-API hiccup
    // doesn't blank the whole report.
    const [salesByAd, spendResult] = await Promise.all([
      fetchGhlSalesByAd(start_date, end_date),
      fetchMetaAdSpend(start_date, end_date).catch(err => {
        console.error('[FB ROAS] Meta spend fetch failed (continuing with GHL only):', err.message)
        return new Map()
      }),
    ])
    const spendByAd = spendResult

    // Build per-ad rows by unioning the two maps
    const adIds = new Set([...salesByAd.keys(), ...spendByAd.keys()])
    const adRows = []
    for (const adId of adIds) {
      const s = salesByAd.get(adId)
      const m = spendByAd.get(adId)
      const sales = s?.salesCount || 0
      const revenue = sales * ltv
      const spend = m?.spend || 0
      adRows.push({
        adId,
        adName: m?.adName || null,
        adsetId: m?.adsetId || s?.adsetId || null,
        adsetName: m?.adsetName || s?.adsetName || null,
        campaignId: m?.campaignId || s?.campaignId || null,
        campaignName: m?.campaignName || s?.campaignName || null,
        spend,
        impressions: m?.impressions || 0,
        clicks: m?.clicks || 0,
        leads_meta: m?.leads || 0,
        sales,
        revenue,
        roas: spend > 0 ? revenue / spend : null,
        cost_per_sale: sales > 0 ? spend / sales : null,
        sample_contact_ids: s?.sampleContactIds || [],
      })
    }

    // Optional roll-up
    let rows = adRows
    if (groupBy !== 'ad') {
      const keyFn = groupBy === 'adset'
        ? (r) => r.adsetId || `__no_adset_${r.adId}`
        : (r) => r.campaignId || `__no_campaign_${r.adId}`
      const nameFn = groupBy === 'adset'
        ? (r) => r.adsetName
        : (r) => r.campaignName
      const byKey = new Map()
      for (const r of adRows) {
        const k = keyFn(r)
        let agg = byKey.get(k)
        if (!agg) {
          agg = {
            key: k,
            name: nameFn(r) || k,
            adsetId: groupBy === 'adset' ? r.adsetId : null,
            campaignId: r.campaignId,
            spend: 0, impressions: 0, clicks: 0, leads_meta: 0,
            sales: 0, revenue: 0,
            ad_count: 0,
          }
          byKey.set(k, agg)
        }
        agg.spend += r.spend
        agg.impressions += r.impressions
        agg.clicks += r.clicks
        agg.leads_meta += r.leads_meta
        agg.sales += r.sales
        agg.revenue += r.revenue
        agg.ad_count += 1
      }
      rows = [...byKey.values()].map(r => ({
        ...r,
        roas: r.spend > 0 ? r.revenue / r.spend : null,
        cost_per_sale: r.sales > 0 ? r.spend / r.sales : null,
      }))
    }

    rows.sort((a, b) => (b.spend || 0) - (a.spend || 0))

    const totals = rows.reduce((acc, r) => {
      acc.sales += r.sales
      acc.revenue += r.revenue
      acc.spend += r.spend
      if (r.sales > 0) acc.ads_with_sales += 1
      if (r.spend > 0) acc.ads_with_spend += 1
      return acc
    }, { sales: 0, revenue: 0, spend: 0, ads_with_sales: 0, ads_with_spend: 0 })

    totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : null
    totals.cost_per_sale = totals.sales > 0 ? totals.spend / totals.sales : null

    res.json({
      date_range: { start: start_date, end: end_date },
      ltv,
      group_by: groupBy,
      totals,
      rows,
    })
  } catch (err) {
    console.error('[FB ROAS] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
