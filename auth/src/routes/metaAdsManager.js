// Meta Ads Manager — write API.
//
// This is the create/edit counterpart to routes/metaAds.js (which is read-only
// reporting). Everything here is admin-only: it spends real money and edits a
// live ad account, so it is deliberately NOT wired into the roles grid or the
// report-grant system. requireRole('admin') is the whole gate.
//
// Meta's own token already carries ads_management + business_management (it is
// a never-expiring system-user token), so there is no per-user OAuth dance.
const { Router } = require('express')
const multer = require('multer')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const META_API = 'https://graph.facebook.com/v21.0'

// Images are capped well under Meta's own 30MB limit; video gets the full 1GB
// Meta allows for a resumable-free simple upload.
const uploadImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })
const uploadVideo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } })

function getConfig() {
  const token = process.env.META_ACCESS_TOKEN
  const adAccountId = process.env.META_AD_ACCOUNT_ID
  if (!token || !adAccountId) throw new Error('Meta Ads not configured (META_ACCESS_TOKEN / META_AD_ACCOUNT_ID)')
  const accountId = adAccountId.startsWith('act_') ? adAccountId : 'act_' + adAccountId
  return { token, accountId }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
//
// Meta meters ads_management per ad account on THREE independent budgets, each
// reported as a percentage in the x-business-use-case-usage header:
//   call_count    - share of the hourly call allowance
//   total_cputime - share of the CPU budget
//   total_time    - share of the wall-clock budget
// Hitting 100 on ANY of them throttles the whole account. In practice it is
// total_time that trips first here: a few broad, deeply-expanded queries cost
// far more than many narrow ones, so "just make fewer calls" is the wrong fix.
//
// The allowance is 300 + 40 x active ads per hour on the standard tier, and
// this app is currently on the limited/development tier, so the ceiling is low.
let lastUsage = null

function recordUsage(res, accountId) {
  try {
    const raw = res.headers.get('x-business-use-case-usage')
    if (!raw) return
    const parsed = JSON.parse(raw)
    const bare = String(accountId).replace(/^act_/, '')
    const entry = (parsed[bare] || [])[0]
    if (!entry) return
    lastUsage = {
      call_count: entry.call_count,
      total_cputime: entry.total_cputime,
      total_time: entry.total_time,
      retry_after_minutes: entry.estimated_time_to_regain_access || 0,
      tier: entry.ads_api_access_tier,
      at: Date.now(),
    }
  } catch {
    // Usage telemetry is best-effort; never let it break a real request.
  }
}

// Worst of the three budgets, as a percentage.
function usagePressure() {
  if (!lastUsage) return 0
  return Math.max(lastUsage.call_count || 0, lastUsage.total_cputime || 0, lastUsage.total_time || 0)
}

// 80004/2446079 is the documented ads_management throttle; 17 and 613 are the
// older generic request-limit codes Meta still returns in places.
function isThrottleError(err) {
  const m = err && err.meta
  if (!m) return false
  return m.code === 80004 || m.code === 17 || m.code === 613 || m.error_subcode === 2446079
}

// Meta returns its real complaint inside error.error_user_msg far more often
// than in error.message ("Invalid parameter" is the useless default). Surface
// the most specific string available or the UI is unusable.
function metaError(data, res) {
  const e = data && data.error
  const msg = (e && (e.error_user_msg || e.message)) || 'Meta API error'
  const detail = e && e.error_user_title ? `${e.error_user_title}: ${msg}` : msg
  const err = new Error(detail)
  err.meta = e || null
  return err
}

async function metaFetch(path, params, token) {
  const url = new URL(`${META_API}${path}`)
  url.searchParams.set('access_token', token)
  for (const [key, val] of Object.entries(params || {})) {
    if (val === undefined || val === null) continue
    url.searchParams.set(key, typeof val === 'object' ? JSON.stringify(val) : String(val))
  }
  const res = await fetch(url.toString())
  recordUsage(res, getConfig().accountId)
  const data = await res.json()
  if (data.error) throw metaError(data)
  return data
}

// Every write goes through here. Object/array values must be JSON-encoded —
// Meta rejects bracket-notation form fields for things like targeting.
async function metaWrite(path, body, token, method = 'POST') {
  const form = new URLSearchParams()
  form.set('access_token', token)
  for (const [key, val] of Object.entries(body || {})) {
    if (val === undefined || val === null) continue
    form.set(key, typeof val === 'object' ? JSON.stringify(val) : String(val))
  }
  const res = await fetch(`${META_API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  recordUsage(res, getConfig().accountId)
  const data = await res.json()
  if (data.error) throw metaError(data)
  return data
}

// Graph's batch endpoint, chunked at its 50-per-request ceiling. This saves
// HTTP round-trips, NOT rate limit — Meta explicitly meters each sub-request
// individually — so it also watches the usage budget and stops early rather
// than driving the account into a lockout.
async function metaBatch(operations, token) {
  const results = []
  for (let i = 0; i < operations.length; i += 50) {
    const chunk = operations.slice(i, i + 50)
    const form = new URLSearchParams()
    form.set('access_token', token)
    form.set('batch', JSON.stringify(chunk.map(op => ({
      method: op.method || 'POST',
      relative_url: op.relative_url,
      body: op.body,
    }))))
    const res = await fetch(`${META_API}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    recordUsage(res, getConfig().accountId)
    const data = await res.json()
    if (data.error) throw metaError(data)
    // Batch replies are positional, and a failed sub-request reports inside
    // its own envelope rather than failing the whole batch.
    chunk.forEach((op, idx) => {
      const reply = (data || [])[idx]
      let error = null
      if (!reply) error = 'No response from Meta'
      else if (reply.code >= 300) {
        try {
          const parsed = JSON.parse(reply.body || '{}')
          error = (parsed.error && (parsed.error.error_user_msg || parsed.error.message)) || `HTTP ${reply.code}`
        } catch { error = `HTTP ${reply.code}` }
      }
      results.push({ ...op.meta, id: op.id, ok: !error, error })
    })

    // Batching saves HTTP round-trips but NOT rate limit: Meta meters every
    // sub-request individually. So a long sweep has to watch the budget and
    // stop while the account is still usable, reporting how far it got.
    if (usagePressure() >= BATCH_STOP_PRESSURE && i + 50 < operations.length) {
      return { results, stoppedEarly: true, remaining: operations.length - (i + 50) }
    }
  }
  return { results, stoppedEarly: false, remaining: 0 }
}

// Leaves headroom for the rest of the app rather than running to 100 and
// locking the whole ad account out for everyone.
const BATCH_STOP_PRESSURE = 80

// Walk every page of an edge. The ad account is past 500 ads, so anything
// that reasons about "all ads" has to page or it silently works on a subset.
async function metaFetchAll(path, params, token, maxPages = 25) {
  const out = []
  let url = new URL(`${META_API}${path}`)
  url.searchParams.set('access_token', token)
  for (const [key, val] of Object.entries(params || {})) {
    if (val === undefined || val === null) continue
    url.searchParams.set(key, typeof val === 'object' ? JSON.stringify(val) : String(val))
  }
  let next = url.toString()
  for (let page = 0; page < maxPages && next; page++) {
    const res = await fetch(next)
    recordUsage(res, getConfig().accountId)
    const data = await res.json()
    if (data.error) throw metaError(data)
    out.push(...(data.data || []))
    next = (data.paging && data.paging.next) || null
  }
  return out
}

function fail(res, err, label) {
  console.error(`[Meta Ads Manager] ${label}:`, err.message)

  // A throttled ad account is a wait-and-retry situation, not a bad request.
  // Give the UI the minutes Meta itself reported so it can say something useful.
  if (isThrottleError(err)) {
    const mins = (lastUsage && lastUsage.retry_after_minutes) || 0
    return res.status(429).json({
      error: mins
        ? `Meta is rate-limiting this ad account. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`
        : 'Meta is rate-limiting this ad account. Try again shortly.',
      rate_limited: true,
      retry_after_minutes: mins,
      usage: lastUsage,
    })
  }

  const status = err.meta && err.meta.code === 190 ? 502 : 400
  res.status(status).json({ error: err.message, meta: err.meta || undefined })
}

// Budgets cross the wire as dollars and live at Meta as minor units. Doing the
// conversion in one place keeps the UI free of cents arithmetic.
function toMinorUnits(dollars) {
  if (dollars === undefined || dollars === null || dollars === '') return undefined
  const n = Number(dollars)
  if (!Number.isFinite(n) || n < 0) throw new Error('Budget must be a positive number')
  return String(Math.round(n * 100))
}

// GET /meta-ads-manager/usage — the last observed rate-limit budget. Reads
// cached header data, so it costs nothing against the account itself.
router.get('/usage', (req, res) => {
  res.json(lastUsage || { call_count: 0, total_cputime: 0, total_time: 0, retry_after_minutes: 0, tier: null })
})

// ---------------------------------------------------------------------------
// Account / pages
// ---------------------------------------------------------------------------

// GET /meta-ads-manager/account
// Everything the create forms need to populate their dropdowns: the account
// itself plus every Page the business owns and its linked Instagram actor.
router.get('/account', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const account = await metaFetch(`/${accountId}`, {
      fields: 'name,account_id,account_status,currency,timezone_name,business,funding_source_details',
    }, token)

    let pages = []
    if (account.business && account.business.id) {
      try {
        const owned = await metaFetch(`/${account.business.id}/owned_pages`, {
          fields: 'name,id,instagram_business_account{id,username}',
          limit: 100,
        }, token)
        pages = (owned.data || []).map(p => ({
          id: p.id,
          name: p.name,
          instagram_id: p.instagram_business_account ? p.instagram_business_account.id : null,
          instagram_username: p.instagram_business_account ? p.instagram_business_account.username : null,
        }))
      } catch (err) {
        // A page-permission gap should degrade the form, not break the screen.
        console.error('[Meta Ads Manager] owned_pages failed:', err.message)
      }
    }

    res.json({
      id: account.id,
      account_id: account.account_id,
      name: account.name,
      currency: account.currency,
      timezone: account.timezone_name,
      status: account.account_status,
      business: account.business || null,
      pixel_id: process.env.META_PIXEL_ID || null,
      pages,
    })
  } catch (err) {
    fail(res, err, 'account')
  }
})

// GET /meta-ads-manager/pages/:id/lead-forms — the Instant Forms that live on
// a Page. Lead ads point at one of these instead of a website.
//
// Reading leadgen_forms needs pages_manage_ads (or leads_retrieval), which
// ads_management does NOT imply. Our system-user token carries neither, and a
// Page token minted from it inherits the same scopes, so the fallback below
// only helps a token that was scoped differently. When both fail on a scope
// error we answer 200 with restricted:true rather than an error: creating the
// ad only needs the form id, so the builder can still take one by hand instead
// of the whole feature going dark over a permission Meta grants in Business
// Settings.
const LEAD_FORM_SCOPE_HINT =
  'This Meta token cannot list Instant Forms. Its system user needs the ' +
  'pages_manage_ads permission (Business Settings → System Users → Generate ' +
  'New Token) and access to this Page. Until then, paste the form ID from ' +
  'Meta: Page → Meta Business Suite → All tools → Instant Forms.'

function isScopeError(err) {
  const m = err && err.meta
  if (!m) return false
  // 200 = "requires <permission> permission", 10 = permission not granted,
  // 190 = the token itself is bad, which is the same dead end for the caller.
  return m.code === 200 || m.code === 10 || m.code === 190
}

router.get('/pages/:id/lead-forms', async (req, res) => {
  const { token } = getConfig()
  const pageId = req.params.id
  const params = { fields: 'id,name,status,created_time,leadgen_form_type', limit: 200 }

  async function load(useToken) {
    const data = await metaFetch(`/${pageId}/leadgen_forms`, params, useToken)
    return (data.data || [])
      // Archived and draft forms cannot take a new ad; showing them is a trap.
      .filter(f => f.status === 'ACTIVE')
      .map(f => ({ id: f.id, name: f.name, created_time: f.created_time }))
  }

  try {
    return res.json({ data: await load(token) })
  } catch (err) {
    let pageErr = err
    if (!isScopeError(err)) {
      try {
        const page = await metaFetch(`/${pageId}`, { fields: 'access_token' }, token)
        if (page.access_token) return res.json({ data: await load(page.access_token) })
      } catch (retryErr) {
        pageErr = retryErr
      }
    }
    if (isScopeError(pageErr)) {
      console.error('[Meta Ads Manager] lead forms blocked:', pageErr.message)
      return res.json({ data: [], restricted: true, message: LEAD_FORM_SCOPE_HINT })
    }
    return fail(res, pageErr, 'lead forms list')
  }
})

// ---------------------------------------------------------------------------
// Cascading pause
// ---------------------------------------------------------------------------
//
// Meta stops *delivering* children of a paused parent, but it does not change
// their own status — they sit at ACTIVE with an effective_status of
// CAMPAIGN_PAUSED / ADSET_PAUSED. The moment the parent is switched back on,
// every one of them resumes at once, which is rarely what anyone intended.
// Pausing here therefore pauses the whole subtree so "off" means off.
//
// Deliberately one-way: reactivating a parent does NOT reactivate children.
// Turning a campaign on should not silently start spending on every ad that
// ever lived under it.

async function pauseChildren(level, id, token) {
  const paused = { adsets: [], ads: [] }
  let stoppedEarly = false

  if (level === 'campaign') {
    const adsets = await metaFetchAll(`/${id}/adsets`, { fields: 'id,name,status', limit: 200 }, token)
    const liveAdsets = adsets.filter(a => a.status === 'ACTIVE')
    if (liveAdsets.length) {
      const batch = await metaBatch(liveAdsets.map(a => ({
        relative_url: a.id, body: 'status=PAUSED', id: a.id, meta: { name: a.name },
      })), token)
      paused.adsets = batch.results
      if (batch.stoppedEarly) stoppedEarly = true
    }
  }

  // The campaign edge returns every ad beneath it, so one call covers all of
  // its ad sets rather than one call per ad set.
  const ads = await metaFetchAll(`/${id}/ads`, { fields: 'id,name,status', limit: 200 }, token)
  const liveAds = ads.filter(a => a.status === 'ACTIVE')
  if (liveAds.length) {
    const batch = await metaBatch(liveAds.map(a => ({
      relative_url: a.id, body: 'status=PAUSED', id: a.id, meta: { name: a.name },
    })), token)
    paused.ads = batch.results
    if (batch.stoppedEarly) stoppedEarly = true
  }

  return {
    adsets_paused: paused.adsets.filter(r => r.ok).length,
    ads_paused: paused.ads.filter(r => r.ok).length,
    failures: [...paused.adsets, ...paused.ads].filter(r => !r.ok),
    stopped_early: stoppedEarly,
  }
}

// An ad whose own status is ACTIVE but whose parent is paused. Harmless while
// the parent stays off, a mass reactivation the moment it does not.
const STRANDED_STATUSES = ['CAMPAIGN_PAUSED', 'ADSET_PAUSED']

// The audit is cached because it is the single most expensive query this
// screen makes, and re-running it after every pause is what drove total_time
// past 100 and got the whole ad account throttled.
let strandedCache = null
const STRANDED_TTL = 5 * 60 * 1000

async function findStrandedAds(token, accountId, { force } = {}) {
  if (!force && strandedCache && (Date.now() - strandedCache.at) < STRANDED_TTL) {
    return strandedCache.ads
  }

  // Filter server-side. Asking Meta for all 500+ ads and discarding 70% of
  // them in Node is what made this query expensive: the cost is in the work
  // Meta does, not in the number of round-trips.
  const ads = await metaFetchAll(`/${accountId}/ads`, {
    fields: 'id,name,status,effective_status,adset{id,name,status},campaign{id,name,status}',
    effective_status: STRANDED_STATUSES,
    limit: 200,
  }, token)

  // effective_status narrows it to paused-parent ads; the ACTIVE check is what
  // separates genuinely-stranded ads from ones already switched off.
  const stranded = ads.filter(a => a.status === 'ACTIVE' && STRANDED_STATUSES.includes(a.effective_status))
  strandedCache = { ads: stranded, at: Date.now() }
  return stranded
}

// GET /meta-ads-manager/audit/stranded-ads
// The sweep: every ad switched on inside a paused parent, grouped by campaign.
router.get('/audit/stranded-ads', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const stranded = await findStrandedAds(token, accountId, { force: req.query.refresh === '1' })

    const groups = new Map()
    for (const ad of stranded) {
      const campaign = ad.campaign || {}
      const key = campaign.id || 'unknown'
      if (!groups.has(key)) {
        groups.set(key, { campaign_id: campaign.id, campaign_name: campaign.name || 'Unknown campaign', campaign_status: campaign.status, ads: [] })
      }
      groups.get(key).ads.push({
        id: ad.id,
        name: ad.name,
        effective_status: ad.effective_status,
        adset_id: (ad.adset || {}).id,
        adset_name: (ad.adset || {}).name,
        adset_status: (ad.adset || {}).status,
      })
    }

    res.json({
      total: stranded.length,
      by_paused_adset: stranded.filter(a => a.effective_status === 'ADSET_PAUSED').length,
      by_paused_campaign: stranded.filter(a => a.effective_status === 'CAMPAIGN_PAUSED').length,
      groups: [...groups.values()].sort((a, b) => b.ads.length - a.ads.length),
      usage: lastUsage,
      cached_at: strandedCache ? strandedCache.at : null,
    })
  } catch (err) {
    fail(res, err, 'stranded audit')
  }
})

// POST /meta-ads-manager/audit/stranded-ads/pause
// Switches them off. Pass ad_ids to pause a subset; omit it to sweep the lot.
// Re-derives the stranded set server-side either way, so a stale browser list
// can never pause an ad that has since become legitimately active.
router.post('/audit/stranded-ads/pause', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const { ad_ids } = req.body || {}

    const stranded = await findStrandedAds(token, accountId, { force: true })
    const wanted = Array.isArray(ad_ids) && ad_ids.length ? new Set(ad_ids) : null
    const targets = wanted ? stranded.filter(a => wanted.has(a.id)) : stranded

    if (!targets.length) return res.json({ paused: 0, failed: 0, results: [] })

    const batch = await metaBatch(targets.map(a => ({
      relative_url: a.id, body: 'status=PAUSED', id: a.id, meta: { name: a.name },
    })), token)

    strandedCache = null // the audit is stale the moment anything is paused
    const results = batch.results
    const paused = results.filter(r => r.ok).length
    console.log(`[Meta Ads Manager] stranded sweep paused ${paused}/${targets.length} ads` +
      (batch.stoppedEarly ? ` (stopped early, ${batch.remaining} left)` : ''))
    res.json({
      paused,
      failed: results.length - paused,
      results,
      stopped_early: batch.stoppedEarly,
      remaining: batch.remaining,
      usage: lastUsage,
    })
  } catch (err) {
    fail(res, err, 'stranded sweep')
  }
})

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

const CAMPAIGN_FIELDS = 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,' +
  'buying_type,bid_strategy,special_ad_categories,start_time,stop_time,created_time,updated_time'

router.get('/campaigns', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const params = { fields: CAMPAIGN_FIELDS, limit: 200 }
    // Default view hides the graveyard; ?status=all shows everything.
    if (req.query.status !== 'all') {
      params.effective_status = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES']
    }
    const data = await metaFetch(`/${accountId}/campaigns`, params, token)
    res.json({ data: (data.data || []).filter(c => c.status !== 'DELETED') })
  } catch (err) {
    fail(res, err, 'campaigns list')
  }
})

router.post('/campaigns', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const { name, objective, status, daily_budget, lifetime_budget, special_ad_categories, bid_strategy } = req.body || {}
    if (!name) return res.status(400).json({ error: 'Campaign name is required' })
    if (!objective) return res.status(400).json({ error: 'Objective is required' })

    const body = {
      name,
      objective,
      // New campaigns start paused unless explicitly activated — nobody should
      // be able to start spending by mis-clicking Save.
      status: status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      // Required by Meta on every create, even when empty.
      special_ad_categories: Array.isArray(special_ad_categories) ? special_ad_categories : [],
    }
    const daily = toMinorUnits(daily_budget)
    const lifetime = toMinorUnits(lifetime_budget)
    // Campaign-level budget (CBO) is optional; when set, the ad sets under it
    // must NOT carry their own budget, so the UI keeps these mutually exclusive.
    if (daily) body.daily_budget = daily
    else if (lifetime) body.lifetime_budget = lifetime
    if (daily || lifetime) body.bid_strategy = bid_strategy || 'LOWEST_COST_WITHOUT_CAP'
    // Without a campaign budget Meta refuses the create until you answer the
    // Advantage budget-sharing question outright ("Must specify True or False
    // in is_adset_budget_sharing_enabled"). Default False: sharing lets ad sets
    // hand 20% of their budget to each other, which would blur the per-ad-set
    // spend the multi-variant tests depend on.
    else body.is_adset_budget_sharing_enabled = req.body.is_adset_budget_sharing_enabled === true

    const created = await metaWrite(`/${accountId}/campaigns`, body, token)
    const full = await metaFetch(`/${created.id}`, { fields: CAMPAIGN_FIELDS }, token)
    res.json(full)
  } catch (err) {
    fail(res, err, 'campaign create')
  }
})

// Moving a campaign off Advantage campaign budget onto per-ad-set budgets is
// not a matter of clearing the campaign's budget — Meta has no "unset". The
// documented way is `adset_budgets`, which removes the campaign budget and
// assigns every ad set its own in one atomic write. Every ad set under the
// campaign must be given a budget, or the ones left out would have none at all.
function buildAdsetBudgets(entries, lifetime) {
  if (!Array.isArray(entries) || !entries.length) return undefined
  const key = lifetime ? 'lifetime_budget' : 'daily_budget'
  return entries.map(entry => {
    const adsetId = entry && (entry.adset_id || entry.id)
    if (!adsetId) throw new Error('Every ad set budget needs an ad set id')
    const amount = toMinorUnits(entry.budget !== undefined ? entry.budget : entry[key])
    if (!amount || Number(amount) <= 0) {
      throw new Error(`Ad set ${entry.name || adsetId} needs a budget above zero`)
    }
    return { adset_id: String(adsetId), [key]: Number(amount) }
  })
}

router.put('/campaigns/:id', async (req, res) => {
  try {
    const { token } = getConfig()
    const { name, status, daily_budget, lifetime_budget, bid_strategy, adset_budgets } = req.body || {}
    const body = {}
    if (name !== undefined) body.name = name
    if (status !== undefined) body.status = status
    const daily = toMinorUnits(daily_budget)
    const lifetime = toMinorUnits(lifetime_budget)
    if (daily) body.daily_budget = daily
    if (lifetime) body.lifetime_budget = lifetime
    if (bid_strategy) body.bid_strategy = bid_strategy

    // Handing back budget control to the ad sets. Mutually exclusive with
    // setting a campaign budget in the same call, which would contradict it.
    if (adset_budgets) {
      if (daily || lifetime) {
        return res.status(400).json({
          error: 'A campaign cannot have its own budget and per-ad-set budgets at the same time',
        })
      }
      body.adset_budgets = buildAdsetBudgets(adset_budgets, req.body.adset_budget_type === 'lifetime')
      // Same rule as create: a campaign leaving CBO has to state whether its ad
      // sets share budget. Default False for the same reason.
      body.is_adset_budget_sharing_enabled = req.body.is_adset_budget_sharing_enabled === true
    } else if (req.body.is_adset_budget_sharing_enabled !== undefined) {
      body.is_adset_budget_sharing_enabled = req.body.is_adset_budget_sharing_enabled === true
    }

    if (!Object.keys(body).length) return res.status(400).json({ error: 'Nothing to update' })

    await metaWrite(`/${req.params.id}`, body, token)

    // Pausing a campaign pauses everything under it. Opt out with
    // cascade:false; reactivation never cascades.
    let cascade
    if (status === 'PAUSED' && req.body.cascade !== false) {
      cascade = await pauseChildren('campaign', req.params.id, token)
    }

    const full = await metaFetch(`/${req.params.id}`, { fields: CAMPAIGN_FIELDS }, token)
    res.json({ ...full, cascade })
  } catch (err) {
    fail(res, err, 'campaign update')
  }
})

// Meta's "delete" is a soft status change — the object stays recoverable in
// Ads Manager, which is what we want for an admin panel.
router.delete('/campaigns/:id', async (req, res) => {
  try {
    const { token } = getConfig()
    await metaWrite(`/${req.params.id}`, { status: 'DELETED' }, token)
    res.json({ ok: true, id: req.params.id })
  } catch (err) {
    fail(res, err, 'campaign delete')
  }
})

// ---------------------------------------------------------------------------
// Ad sets
// ---------------------------------------------------------------------------

const ADSET_FIELDS = 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,' +
  'billing_event,optimization_goal,bid_strategy,bid_amount,targeting,promoted_object,' +
  'destination_type,start_time,end_time,created_time,updated_time'

router.get('/adsets', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const { campaign_id } = req.query
    const params = { fields: ADSET_FIELDS, limit: 200 }
    if (req.query.status !== 'all') {
      params.effective_status = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES']
    }
    // Scoped to a campaign when given, otherwise the whole account.
    const path = campaign_id ? `/${campaign_id}/adsets` : `/${accountId}/adsets`
    const data = await metaFetch(path, params, token)
    res.json({ data: (data.data || []).filter(a => a.status !== 'DELETED') })
  } catch (err) {
    fail(res, err, 'adsets list')
  }
})

router.get('/adsets/:id', async (req, res) => {
  try {
    const { token } = getConfig()
    res.json(await metaFetch(`/${req.params.id}`, { fields: ADSET_FIELDS }, token))
  } catch (err) {
    fail(res, err, 'adset get')
  }
})

// Meta now REQUIRES an explicit Advantage audience decision on every ad set
// write: targeting.targeting_automation.advantage_audience must be 0 or 1, or
// the create fails with "Advantage Audience Flag Required". There is no
// default. We opt out (0) unless the caller says otherwise, for the same
// reason Advantage+ creative enhancements default to OPT_OUT: letting Meta
// broaden the audience past the targeting that was actually chosen makes an
// A/B test meaningless.
function withAdvantageAudience(targeting, advantageAudience) {
  const existing = targeting.targeting_automation || {}
  let flag = advantageAudience
  if (flag === undefined || flag === null || flag === '') {
    flag = existing.advantage_audience
  }
  const on = flag === true || flag === 1 || flag === '1' || flag === 'true'
  return {
    ...targeting,
    targeting_automation: { ...existing, advantage_audience: on ? 1 : 0 },
  }
}

function buildAdsetBody(input) {
  const {
    name, campaign_id, status, daily_budget, lifetime_budget, billing_event,
    optimization_goal, bid_strategy, bid_amount, targeting, promoted_object,
    destination_type, start_time, end_time, advantage_audience,
  } = input || {}

  const body = {}
  if (name !== undefined) body.name = name
  if (campaign_id) body.campaign_id = campaign_id
  if (status !== undefined) body.status = status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED'
  if (billing_event) body.billing_event = billing_event
  if (optimization_goal) body.optimization_goal = optimization_goal
  if (destination_type) body.destination_type = destination_type
  if (start_time) body.start_time = start_time
  if (end_time) body.end_time = end_time
  if (targeting) body.targeting = withAdvantageAudience(targeting, advantage_audience)
  if (promoted_object) body.promoted_object = promoted_object

  const daily = toMinorUnits(daily_budget)
  const lifetime = toMinorUnits(lifetime_budget)
  if (daily) body.daily_budget = daily
  else if (lifetime) body.lifetime_budget = lifetime

  if (bid_strategy) body.bid_strategy = bid_strategy
  // bid_amount is only legal on capped strategies; sending it with
  // LOWEST_COST_WITHOUT_CAP is an outright error from Meta.
  if (bid_amount && bid_strategy && bid_strategy !== 'LOWEST_COST_WITHOUT_CAP') {
    body.bid_amount = toMinorUnits(bid_amount)
  }
  return body
}

router.post('/adsets', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const { name, campaign_id, targeting } = req.body || {}
    if (!name) return res.status(400).json({ error: 'Ad set name is required' })
    if (!campaign_id) return res.status(400).json({ error: 'Campaign is required' })
    if (!targeting) return res.status(400).json({ error: 'Targeting is required' })

    const body = buildAdsetBody(req.body)
    if (!body.status) body.status = 'PAUSED'
    if (!body.billing_event) body.billing_event = 'IMPRESSIONS'
    if (!body.bid_strategy && (body.daily_budget || body.lifetime_budget)) {
      body.bid_strategy = 'LOWEST_COST_WITHOUT_CAP'
    }

    const created = await metaWrite(`/${accountId}/adsets`, body, token)
    const full = await metaFetch(`/${created.id}`, { fields: ADSET_FIELDS }, token)
    res.json(full)
  } catch (err) {
    fail(res, err, 'adset create')
  }
})

router.put('/adsets/:id', async (req, res) => {
  try {
    const { token } = getConfig()
    const body = buildAdsetBody(req.body)
    // campaign_id is immutable after creation — sending it back errors.
    delete body.campaign_id
    if (!Object.keys(body).length) return res.status(400).json({ error: 'Nothing to update' })
    await metaWrite(`/${req.params.id}`, body, token)

    // Same one-way cascade as campaigns: pausing an ad set pauses its ads.
    let cascade
    if (req.body.status === 'PAUSED' && req.body.cascade !== false) {
      cascade = await pauseChildren('adset', req.params.id, token)
    }

    const full = await metaFetch(`/${req.params.id}`, { fields: ADSET_FIELDS }, token)
    res.json({ ...full, cascade })
  } catch (err) {
    fail(res, err, 'adset update')
  }
})

// POST /meta-ads-manager/adsets/:id/duplicate
//
// Meta's own /copies edge does this server-side, which is the only way to get a
// faithful copy: targeting, budget, schedule, promoted object and every child
// ad, without this app having to re-derive a shape it may not fully model.
//
// The copy is ALWAYS paused, whatever the source was doing, and deep_copy keeps
// the child ads paused too. Copying an ad set is a setup step; nothing should
// start spending because someone duplicated something. Activating is a separate,
// deliberate click — the same rule as everywhere else here.
router.post('/adsets/:id/duplicate', async (req, res) => {
  try {
    const { token } = getConfig()
    const { campaign_id, name, include_ads } = req.body || {}

    const body = {
      deep_copy: !!include_ads,
      status_option: 'PAUSED',
    }
    // Copying into another campaign is legal only when the objective matches;
    // Meta says so itself, and its message is clearer than a guess of ours.
    if (campaign_id) body.campaign_id = campaign_id

    const copied = await metaWrite(`/${req.params.id}/copies`, body, token)
    const newId = copied.copied_adset_id || copied.id
    if (!newId) throw new Error('Meta did not return the new ad set id')

    // /copies names the copy "<source> - Copy"; rename it in a second call
    // rather than fighting rename_options, which only appends.
    if (name) {
      try {
        await metaWrite(`/${newId}`, { name }, token)
      } catch (err) {
        console.error('[Meta Ads Manager] copy rename failed:', err.message)
      }
    }

    const full = await metaFetch(`/${newId}`, { fields: ADSET_FIELDS }, token)
    let ads = 0
    if (include_ads) {
      const list = await metaFetch(`/${newId}/ads`, { fields: 'id', limit: 200 }, token)
      ads = (list.data || []).length
    }
    res.json({ ...full, copied_ads: ads })
  } catch (err) {
    fail(res, err, 'ad set duplicate')
  }
})

router.delete('/adsets/:id', async (req, res) => {
  try {
    const { token } = getConfig()
    await metaWrite(`/${req.params.id}`, { status: 'DELETED' }, token)
    res.json({ ok: true, id: req.params.id })
  } catch (err) {
    fail(res, err, 'adset delete')
  }
})

// ---------------------------------------------------------------------------
// Ads + creatives
// ---------------------------------------------------------------------------

const AD_FIELDS = 'id,name,adset_id,campaign_id,status,effective_status,created_time,updated_time,' +
  'creative{id,name,object_story_spec,effective_object_story_id,thumbnail_url,image_url,' +
  'degrees_of_freedom_spec,asset_feed_spec}'

router.get('/ads', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const { adset_id, campaign_id } = req.query
    const params = { fields: AD_FIELDS, limit: 200 }
    if (req.query.status !== 'all') {
      params.effective_status = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED']
    }
    const path = adset_id ? `/${adset_id}/ads` : campaign_id ? `/${campaign_id}/ads` : `/${accountId}/ads`
    const data = await metaFetch(path, params, token)
    res.json({ data: (data.data || []).filter(a => a.status !== 'DELETED') })
  } catch (err) {
    fail(res, err, 'ads list')
  }
})

router.get('/ads/:id', async (req, res) => {
  try {
    const { token } = getConfig()
    res.json(await metaFetch(`/${req.params.id}`, { fields: AD_FIELDS }, token))
  } catch (err) {
    fail(res, err, 'ad get')
  }
})

// Turn one variant's flat form fields into a Meta object_story_spec. Image and
// video creatives are different enough shapes that they get separate branches,
// but the caller only ever supplies image_hash OR video_id.
function buildObjectStorySpec(variant, shared) {
  const page_id = variant.page_id || shared.page_id
  if (!page_id) throw new Error('A Facebook Page is required')

  // An Instant Form ad opens its form inside Facebook, so the `link` is never
  // where anyone lands — but Meta still requires one, and it must point OFF
  // Facebook: a Page URL is refused with "Lead Ad Creative Does Not Use
  // External URL". In practice this is the advertiser's own site, which is also
  // where the form's privacy policy lives.
  const leadFormId = variant.lead_gen_form_id || shared.lead_gen_form_id
  const link = variant.link || shared.link || ''
  if (!link) {
    throw new Error(leadFormId
      ? 'Lead ads still need your website link. Nobody lands on it — the form opens in Facebook — but Meta requires one that points off Facebook.'
      : 'A destination link is required')
  }
  if (leadFormId && /^https?:\/\/([^/]*\.)?(facebook|fb)\.(com|me)(\/|$)/i.test(link)) {
    throw new Error('A lead ad cannot link to a Facebook Page. Use your website — Meta requires an external URL on the creative.')
  }

  const ctaType = variant.call_to_action || shared.call_to_action || (leadFormId ? 'SIGN_UP' : 'LEARN_MORE')
  const call_to_action = { type: ctaType, value: { link } }
  if (leadFormId) call_to_action.value.lead_gen_form_id = String(leadFormId)

  const spec = { page_id }
  const igId = variant.instagram_user_id || shared.instagram_user_id
  if (igId) spec.instagram_user_id = igId

  if (variant.video_id) {
    spec.video_data = {
      video_id: variant.video_id,
      message: variant.message || '',
      title: variant.headline || undefined,
      link_description: variant.description || undefined,
      call_to_action,
    }
    // Meta requires a poster frame on every video creative. The upload
    // endpoint hands back an auto-generated one when the caller has none.
    if (variant.thumbnail_url) spec.video_data.image_url = variant.thumbnail_url
    else if (variant.thumbnail_hash) spec.video_data.image_hash = variant.thumbnail_hash
  } else {
    if (!variant.image_hash) throw new Error('An image or video is required')
    spec.link_data = {
      image_hash: variant.image_hash,
      link,
      message: variant.message || '',
      name: variant.headline || undefined,
      description: variant.description || undefined,
      call_to_action,
    }
  }
  return spec
}

// The individual Advantage+ enhancements that rewrite copy or alter media.
// Meta retired the single `standard_enhancements` bundle - sending it now
// fails the creative outright with "Creative should not include standard
// enhancements" - so opting out means naming each feature. Meta silently drops
// the ones that don't apply to a given creative, so one list covers image,
// video and link ads alike.
const ENHANCEMENTS_TO_DECLINE = [
  // Copy
  'text_optimizations',
  'description_automation',
  'text_extraction_for_headline',
  'add_text_overlay',
  'text_translation',
  'text_overlay_translation',
  // Media
  'image_touchups',
  'image_templates',
  'image_background_gen',
  'image_animation',
  'adapt_to_placement',
  'media_type_automation',
  'multi_photo_to_video',
  'video_to_image',
  'music_generation',
  // Extra modules bolted onto the ad
  'generate_cta',
  'site_extensions',
  'product_extensions',
  'profile_card',
  'inline_comment',
]

// Advantage+ creative enhancements silently rewrite copy and crop images.
// That defeats the whole point of hand-authored A/B variants, so we default to
// opting out and let the caller turn it back on per batch. Turning it ON means
// sending no spec at all: there is no bundle to opt into any more, and an
// absent spec is exactly what leaves Meta free to apply its own defaults.
function degreesOfFreedom(advantagePlus) {
  if (advantagePlus) return undefined
  const creative_features_spec = {}
  for (const feature of ENHANCEMENTS_TO_DECLINE) {
    creative_features_spec[feature] = { enroll_status: 'OPT_OUT' }
  }
  return { creative_features_spec }
}

async function createOneAd(variant, shared, token, accountId) {
  const spec = buildObjectStorySpec(variant, shared)
  const creativeBody = {
    name: (variant.name || 'Ad') + ' — creative',
    object_story_spec: spec,
    degrees_of_freedom_spec: degreesOfFreedom(shared.advantage_plus),
  }
  const creative = await metaWrite(`/${accountId}/adcreatives`, creativeBody, token)

  const ad = await metaWrite(`/${accountId}/ads`, {
    name: variant.name,
    adset_id: shared.adset_id,
    creative: { creative_id: creative.id },
    status: shared.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
  }, token)

  return { ad_id: ad.id, creative_id: creative.id }
}

// POST /meta-ads-manager/ads
// The core of this feature: N variants sharing one ad set, one link and one
// CTA, each with its own name, copy and media. Variants are created
// sequentially so Meta's per-account write throttle stays happy, and one bad
// variant reports itself without taking down the rest of the batch.
router.post('/ads', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const {
      adset_id, page_id, instagram_user_id, link, call_to_action,
      status, advantage_plus, variants, lead_gen_form_id,
    } = req.body || {}

    if (!adset_id) return res.status(400).json({ error: 'Ad set is required' })
    if (!Array.isArray(variants) || !variants.length) {
      return res.status(400).json({ error: 'At least one ad variant is required' })
    }
    if (variants.length > 25) {
      return res.status(400).json({ error: 'Create at most 25 variants at a time' })
    }
    if (variants.some(v => !v || !v.name)) {
      return res.status(400).json({ error: 'Every variant needs a name' })
    }

    const shared = {
      adset_id, page_id, instagram_user_id, link, call_to_action,
      status, advantage_plus, lead_gen_form_id,
    }
    const results = []
    for (const variant of variants) {
      try {
        const created = await createOneAd(variant, shared, token, accountId)
        results.push({ ok: true, name: variant.name, ...created })
      } catch (err) {
        console.error(`[Meta Ads Manager] variant "${variant.name}" failed:`, err.message)
        results.push({ ok: false, name: variant.name, error: err.message })
      }
    }

    const created = results.filter(r => r.ok).length
    res.json({ created, failed: results.length - created, results })
  } catch (err) {
    fail(res, err, 'ads create')
  }
})

// PUT /meta-ads-manager/ads/:id
// Renaming and pausing edit the ad in place. Changing any creative field can't
// — Meta creatives are immutable — so we mint a fresh creative and point the
// existing ad at it, which is exactly what Ads Manager does under the hood.
router.put('/ads/:id', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const { name, status, creative } = req.body || {}
    const body = {}
    if (name !== undefined) body.name = name
    if (status !== undefined) body.status = status

    if (creative) {
      const spec = buildObjectStorySpec(creative, creative)
      const newCreative = await metaWrite(`/${accountId}/adcreatives`, {
        name: (name || creative.name || 'Ad') + ' — creative',
        object_story_spec: spec,
        degrees_of_freedom_spec: degreesOfFreedom(creative.advantage_plus),
      }, token)
      body.creative = { creative_id: newCreative.id }
    }

    if (!Object.keys(body).length) return res.status(400).json({ error: 'Nothing to update' })
    await metaWrite(`/${req.params.id}`, body, token)
    const full = await metaFetch(`/${req.params.id}`, { fields: AD_FIELDS }, token)
    res.json(full)
  } catch (err) {
    fail(res, err, 'ad update')
  }
})

router.delete('/ads/:id', async (req, res) => {
  try {
    const { token } = getConfig()
    await metaWrite(`/${req.params.id}`, { status: 'DELETED' }, token)
    res.json({ ok: true, id: req.params.id })
  } catch (err) {
    fail(res, err, 'ad delete')
  }
})

// POST /meta-ads-manager/ads/:id/duplicate
// Copies an existing ad's creative into new ads — the fast path for "same ad,
// three more headlines". Overrides let the caller vary copy or media per copy.
router.post('/ads/:id/duplicate', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const { adset_id, variants } = req.body || {}
    if (!Array.isArray(variants) || !variants.length) {
      return res.status(400).json({ error: 'At least one variant is required' })
    }

    const source = await metaFetch(`/${req.params.id}`, { fields: AD_FIELDS }, token)
    const srcSpec = (source.creative && source.creative.object_story_spec) || {}
    const srcLink = srcSpec.link_data || srcSpec.video_data || {}

    // Seed each new variant from the source ad, then apply overrides.
    const shared = {
      adset_id: adset_id || source.adset_id,
      page_id: srcSpec.page_id,
      instagram_user_id: srcSpec.instagram_user_id,
      link: srcLink.link || (srcLink.call_to_action && srcLink.call_to_action.value && srcLink.call_to_action.value.link),
      call_to_action: srcLink.call_to_action && srcLink.call_to_action.type,
      status: req.body.status,
      advantage_plus: req.body.advantage_plus,
    }

    const results = []
    for (const v of variants) {
      const merged = {
        name: v.name || `${source.name} (copy)`,
        message: v.message !== undefined ? v.message : srcLink.message,
        headline: v.headline !== undefined ? v.headline : (srcLink.name || srcLink.title),
        description: v.description !== undefined ? v.description : (srcLink.description || srcLink.link_description),
        image_hash: v.image_hash !== undefined ? v.image_hash : srcLink.image_hash,
        video_id: v.video_id !== undefined ? v.video_id : srcLink.video_id,
        thumbnail_url: v.thumbnail_url,
        link: v.link,
        call_to_action: v.call_to_action,
      }
      try {
        const created = await createOneAd(merged, shared, token, accountId)
        results.push({ ok: true, name: merged.name, ...created })
      } catch (err) {
        results.push({ ok: false, name: merged.name, error: err.message })
      }
    }

    const created = results.filter(r => r.ok).length
    res.json({ created, failed: results.length - created, results })
  } catch (err) {
    fail(res, err, 'ad duplicate')
  }
})

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

// POST /meta-ads-manager/media/image — one or more images in a single request.
// Meta keys its response by filename, so the mapping back to each upload runs
// off the name we send rather than the array order.
router.post('/media/image', uploadImage.array('files', 20), async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const files = req.files || []
    if (!files.length) return res.status(400).json({ error: 'No image uploaded' })

    const form = new FormData()
    form.set('access_token', token)
    const names = []
    files.forEach((file, i) => {
      // Meta collides on duplicate filenames within one request; index them.
      const name = `${i}_${(file.originalname || 'image.jpg').replace(/[^\w.\-]/g, '_')}`
      names.push({ name, originalname: file.originalname })
      form.set(name, new Blob([file.buffer], { type: file.mimetype }), name)
    })

    const upstream = await fetch(`${META_API}/${accountId}/adimages`, { method: 'POST', body: form })
    const data = await upstream.json()
    if (data.error) throw metaError(data)

    const images = data.images || {}
    const out = names.map(({ name, originalname }) => {
      const img = images[name] || {}
      return { name: originalname, hash: img.hash || null, url: img.url || null }
    })
    res.json({ images: out })
  } catch (err) {
    fail(res, err, 'image upload')
  }
})

// POST /meta-ads-manager/media/video
// Videos are not usable the instant they upload — Meta transcodes first. The
// response carries the id plus a poster frame; the UI polls /media/video/:id.
router.post('/media/video', uploadVideo.single('file'), async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    if (!req.file) return res.status(400).json({ error: 'No video uploaded' })

    const form = new FormData()
    form.set('access_token', token)
    form.set('name', req.file.originalname || 'video.mp4')
    form.set('source', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || 'video.mp4')

    const upstream = await fetch(`${META_API}/${accountId}/advideos`, { method: 'POST', body: form })
    const data = await upstream.json()
    if (data.error) throw metaError(data)

    res.json({ id: data.id, name: req.file.originalname, status: 'processing' })
  } catch (err) {
    fail(res, err, 'video upload')
  }
})

// Poll target for the transcode above. `ready` gates the Create button so an
// ad is never submitted against a video Meta cannot render yet.
router.get('/media/video/:id', async (req, res) => {
  try {
    const { token } = getConfig()
    const data = await metaFetch(`/${req.params.id}`, {
      fields: 'id,status,picture,thumbnails{uri,is_preferred}',
    }, token)
    const phase = (data.status && data.status.video_status) || 'processing'
    const thumbs = (data.thumbnails && data.thumbnails.data) || []
    const preferred = thumbs.find(t => t.is_preferred) || thumbs[0]
    res.json({
      id: data.id,
      status: phase,
      ready: phase === 'ready',
      thumbnail_url: (preferred && preferred.uri) || data.picture || null,
    })
  } catch (err) {
    fail(res, err, 'video status')
  }
})

// Images already in the ad account, newest first — lets a second variant reuse
// media uploaded moments earlier without a re-upload.
router.get('/media/images', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const data = await metaFetch(`/${accountId}/adimages`, {
      fields: 'hash,url,name,width,height,created_time',
      limit: Number(req.query.limit) || 100,
    }, token)
    res.json({ data: data.data || [] })
  } catch (err) {
    fail(res, err, 'images list')
  }
})

router.get('/media/videos', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const data = await metaFetch(`/${accountId}/advideos`, {
      fields: 'id,title,picture,created_time,length',
      limit: Number(req.query.limit) || 50,
    }, token)
    res.json({ data: data.data || [] })
  } catch (err) {
    fail(res, err, 'videos list')
  }
})

// ---------------------------------------------------------------------------
// Targeting search + previews
// ---------------------------------------------------------------------------

// Typeahead for the ad set geo picker. Cities carry a radius; regions and
// countries do not, which the UI reflects.
router.get('/targeting/locations', async (req, res) => {
  try {
    const { token } = getConfig()
    const q = (req.query.q || '').trim()
    if (!q) return res.json({ data: [] })
    const data = await metaFetch('/search', {
      type: 'adgeolocation',
      q,
      location_types: ['city', 'region', 'zip', 'country'],
      limit: 25,
    }, token)
    res.json({ data: data.data || [] })
  } catch (err) {
    fail(res, err, 'location search')
  }
})

router.get('/targeting/interests', async (req, res) => {
  try {
    const { token } = getConfig()
    const q = (req.query.q || '').trim()
    if (!q) return res.json({ data: [] })
    const data = await metaFetch('/search', {
      type: 'adinterest', q, limit: 25,
    }, token)
    res.json({ data: data.data || [] })
  } catch (err) {
    fail(res, err, 'interest search')
  }
})

// Saved audiences are whole targeting specs (geo + age + interests + audience
// exclusions) that Meta stores under the account — distinct from the custom
// audiences below, which are just people lists. The ad set form loads one as a
// starting point, so the full targeting object rides along.
router.get('/targeting/saved-audiences', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const data = await metaFetch(`/${accountId}/saved_audiences`, {
      fields: 'id,name,description,targeting,run_status',
      limit: 200,
    }, token)
    // Meta keeps deleted saved audiences addressable; only offer live ones.
    const usable = (data.data || []).filter(a => a.targeting && a.run_status !== 'DELETED')
    res.json({ data: usable })
  } catch (err) {
    fail(res, err, 'saved audiences list')
  }
})

// Custom + lookalike audiences — the people lists themselves.
router.get('/targeting/audiences', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const data = await metaFetch(`/${accountId}/customaudiences`, {
      fields: 'id,name,subtype,approximate_count_lower_bound,delivery_status',
      limit: 100,
    }, token)
    res.json({ data: data.data || [] })
  } catch (err) {
    fail(res, err, 'audiences list')
  }
})

// POST /meta-ads-manager/previews
// Renders an unsaved variant exactly as Meta will show it. Takes the same
// variant shape as the create call so the builder can preview before writing.
router.post('/previews', async (req, res) => {
  try {
    const { token, accountId } = getConfig()
    const { variant, shared, ad_format } = req.body || {}
    if (!variant) return res.status(400).json({ error: 'A variant is required' })

    const spec = buildObjectStorySpec(variant, shared || {})
    // generatepreviews is a read edge — the creative rides in the query string.
    const data = await metaFetch(`/${accountId}/generatepreviews`, {
      creative: { object_story_spec: spec },
      ad_format: ad_format || 'MOBILE_FEED_STANDARD',
    }, token)
    const body = (data.data && data.data[0] && data.data[0].body) || null
    res.json({ html: body })
  } catch (err) {
    fail(res, err, 'preview')
  }
})

module.exports = router
