const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { wrapSWR } = require('../services/memoryCache')
const { CLUBS, CLUB_BY_SLUG } = require('../config/clubs')
const { buildScoreboard, clubForCampaign, isPaidChannel, daysInMonth } = require('../lib/marketingScoreboard')
const { ga4 } = require('./googleAnalytics')

// ---------------------------------------------------------------------------
// /reports/marketing-scoreboard — daily leads / carts / joins per channel.
//
// Meta (paid Facebook / Instagram) and Organic (the website with no paid
// click), each with a row per day, totals, month-end pace and goals. The
// counting rules live in migration 221; this adds Meta spend / impressions /
// link clicks (split by club from the campaign name) and GA4 organic sessions.
// Meta leads = Meta's Instant Form count + GHL's paid website leads (231).
// Each Meta day then takes Meta's own lead / purchase count when that's
// higher (view-through and in-club joins Meta matched to an ad).
//
// Admin only for now (Justin's view). The roles grid entry is admin-only too.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const META_API = 'https://graph.facebook.com/v21.0'
const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
// East Side (milwaukie) has its own website, outside this GA4 property.
const OWN_WEBSITE = new Set(['milwaukie'])

const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''))

function pacificToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

function resolveClub(param) {
  const slug = String(param || 'all').toLowerCase()
  if (slug === 'all') return { slug: 'all', club: null }
  const club = CLUB_BY_SLUG[slug]
  return club ? { slug, club } : null
}

async function metaFetchAll(endpoint, params) {
  const token = process.env.META_ACCESS_TOKEN
  const adAccountId = process.env.META_AD_ACCOUNT_ID
  if (!token || !adAccountId) throw new Error('Meta Ads not configured')
  const accountId = adAccountId.startsWith('act_') ? adAccountId : 'act_' + adAccountId
  const url = new URL(`${META_API}/${accountId}${endpoint}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  const rows = []
  let next = url.toString()
  while (next) {
    const res = await fetch(next)
    const data = await res.json()
    if (data.error) throw new Error(data.error.message || 'Meta API error')
    rows.push(...(data.data || []))
    next = data.paging && data.paging.next
  }
  return rows
}

// Meta's own count of Instant Form leads (the form inside Facebook /
// Instagram). Read from Meta rather than GHL: GHL only has the ones its
// Facebook integration delivered (none at all Oct 3-5 2026) and never counts a
// repeat lead, so its count can fall far short.
const INSTANT_FORM_ACTION = 'onsite_conversion.lead_grouped'
// Meta's own totals in the account's default attribution window (7-day click
// + 1-day view): every lead (Instant Form + pixel), and every purchase (the
// in-club joins ghl-sync sends as offline Purchases + Online Join pixel).
const REPORTED_LEAD_ACTION = 'lead'
const REPORTED_JOIN_ACTION = 'omni_purchase'
const actionCount = (actions, type) => {
  const a = (actions || []).find(x => x.action_type === type)
  return a ? parseInt(a.value || 0, 10) : 0
}

// day -> { spend, impressions, clicks, instantLeads, reportedLeads,
// reportedJoins } for one club (campaign name) or all.
async function metaDaily(start, end, clubSlug) {
  const rows = await wrapSWR(`scoreboard:meta3:${start}:${end}`, FRESH_MS, STALE_MS, () =>
    metaFetchAll('/insights', {
      level: 'campaign',
      fields: 'campaign_name,spend,impressions,inline_link_clicks,actions',
      time_increment: 1,
      time_range: { since: start, until: end },
      limit: 500,
    }))
  const byDay = new Map()
  for (const r of rows) {
    if (clubSlug !== 'all' && clubForCampaign(r.campaign_name, CLUBS) !== clubSlug) continue
    const day = r.date_start
    const cur = byDay.get(day) || { spend: 0, impressions: 0, clicks: 0, instantLeads: 0, reportedLeads: 0, reportedJoins: 0 }
    cur.spend += parseFloat(r.spend || 0)
    cur.impressions += parseInt(r.impressions || 0, 10)
    cur.clicks += parseInt(r.inline_link_clicks || 0, 10)
    cur.instantLeads += actionCount(r.actions, INSTANT_FORM_ACTION)
    cur.reportedLeads += actionCount(r.actions, REPORTED_LEAD_ACTION)
    cur.reportedJoins += actionCount(r.actions, REPORTED_JOIN_ACTION)
    byDay.set(day, cur)
  }
  return byDay
}

// day -> organic (non-paid channel) website sessions, or null when GA4 can't
// answer for this selection.
async function organicSessions(start, end, clubSlug) {
  if (OWN_WEBSITE.has(clubSlug)) return null
  const propertyId = await ga4.getPropertyId()
  if (!propertyId) return null
  const rows = await wrapSWR(`scoreboard:ga4:${propertyId}:${start}:${end}:${clubSlug}`, FRESH_MS, STALE_MS, async () => {
    const body = {
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      limit: 5000,
    }
    const filter = clubSlug === 'all' ? null : ga4.buildLocationFilter(clubSlug)
    if (filter) body.dimensionFilter = filter
    const report = await ga4.runReport(propertyId, body)
    return (report.rows || []).map(r => ({
      date: r.dimensionValues[0].value,
      channel: r.dimensionValues[1].value,
      sessions: Number(r.metricValues[0].value) || 0,
    }))
  })
  const byDay = new Map()
  for (const r of rows) {
    if (isPaidChannel(r.channel)) continue
    const day = `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`
    byDay.set(day, (byDay.get(day) || 0) + r.sessions)
  }
  return byDay
}

async function loadGoals(month, clubKey) {
  const { data, error } = await supabaseAdmin
    .from('marketing_scoreboard_goals')
    .select('channel, leads, carts, joins, target_cpl')
    .eq('month', `${month}-01`)
    .eq('club_number', clubKey)
  if (error) throw new Error(`goals: ${error.message}`)
  const out = {}
  for (const g of data || []) out[g.channel] = g
  return out
}

// GET /reports/marketing-scoreboard?month=YYYY-MM&club=all|<slug>
router.get('/', async (req, res) => {
  try {
    const today = pacificToday()
    const month = isMonth(req.query.month) ? String(req.query.month) : today.slice(0, 7)
    const sel = resolveClub(req.query.club)
    if (!sel) return res.status(400).json({ error: 'unknown club' })

    const start = `${month}-01`
    const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
    if (start > today) return res.status(400).json({ error: 'month is in the future' })
    const end = monthEnd < today ? monthEnd : today
    const clubKey = sel.club ? sel.club.clubNumber : 'all'

    const warnings = []
    let metaOk = true
    const [dailyRes, metaByDay, sessionsByDay, goals] = await Promise.all([
      supabaseAdmin.rpc('marketing_scoreboard_daily', {
        p_start: start, p_end: end, p_clubs: sel.club ? [sel.club.clubNumber] : null,
      }),
      metaDaily(start, end, sel.slug).catch(err => {
        metaOk = false
        warnings.push(`Meta spend unavailable (Instant Form leads are GHL's count): ${err.message}`)
        return new Map()
      }),
      organicSessions(start, end, sel.slug).catch(err => {
        warnings.push(`Website sessions unavailable: ${err.message}`)
        return null
      }),
      loadGoals(month, clubKey),
    ])
    if (dailyRes.error) throw new Error(dailyRes.error.message)

    // Instant Form leads come from Meta when we have Meta's numbers and the
    // RPC splits them out (migration 231); otherwise GHL's count stands.
    const instantFromMeta = metaOk && (dailyRes.data || []).some(r => r.instant_leads !== undefined)
    const board = buildScoreboard({ month, today, daily: dailyRes.data, metaByDay, sessionsByDay, goals, instantFromMeta, useMetaReported: metaOk })
    if (OWN_WEBSITE.has(sel.slug)) {
      warnings.push('East Side Athletic Club has its own website, which is not in Google Analytics here.')
    }
    res.json({ ...board, club: sel.slug, warnings })
  } catch (err) {
    console.error('[marketing-scoreboard] error:', err.message)
    res.status(500).json({ error: 'Failed to build the scoreboard' })
  }
})

const toGoal = v => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

// PUT /reports/marketing-scoreboard/goals
// Body: { month: 'YYYY-MM', channel: 'meta'|'organic', club: 'all'|<slug>,
//         leads, carts, joins, target_cpl }  (blank clears a goal)
router.put('/goals', async (req, res) => {
  try {
    const b = req.body || {}
    if (!isMonth(b.month)) return res.status(400).json({ error: 'month must be YYYY-MM' })
    if (!['meta', 'organic'].includes(b.channel)) return res.status(400).json({ error: 'channel must be meta or organic' })
    const sel = resolveClub(b.club)
    if (!sel) return res.status(400).json({ error: 'unknown club' })

    const row = {
      month: `${b.month}-01`,
      channel: b.channel,
      club_number: sel.club ? sel.club.clubNumber : 'all',
      updated_at: new Date().toISOString(),
      updated_by: req.staff?.id || null,
    }
    for (const k of ['leads', 'carts', 'joins', 'target_cpl']) {
      const v = toGoal(b[k])
      if (v === undefined) return res.status(400).json({ error: `${k} must be a non-negative number` })
      row[k] = k === 'target_cpl' || v === null ? v : Math.round(v)
    }
    if (b.channel === 'organic') row.target_cpl = null

    const { error } = await supabaseAdmin.from('marketing_scoreboard_goals').upsert(row, { onConflict: 'month,channel,club_number' })
    if (error) throw new Error(error.message)
    res.json({ ok: true })
  } catch (err) {
    console.error('[marketing-scoreboard] goals error:', err.message)
    res.status(500).json({ error: 'Failed to save goals' })
  }
})

module.exports = router
