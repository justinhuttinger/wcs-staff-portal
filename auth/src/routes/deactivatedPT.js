const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { wrapSWR } = require('../services/memoryCache')

// Phase 2 perf: cache the heavy ABC-aggregation payload across users. Auth +
// role checks still run per request via the router-level middleware below; the
// cache key intentionally excludes caller identity since the response is the
// same for any authorized caller asking for the same (date range, location).
const DEACTIVATED_PT_FRESH_MS = 5 * 60 * 1000
const DEACTIVATED_PT_STALE_MS = 30 * 60 * 1000

// 'Deactivated PT' — surfaces two flavors of PT churn that overlap in the
// front-desk mental model:
//   • Deactivated RS: a PT recurring service whose `recurringServiceStatus`
//     is anything other than 'active' and was last modified in the window.
//   • PIF Burned: a member with one or more PIF PT packages whose entire PT
//     purchase history is now `available = 0` AND who has no active RS.
//
// Both flavors are anchored to ABC's `lastModifiedTimestampRange` filter on
// /members/recurringservices so the date range maps to "things that changed
// in this window".

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const ABC_APP_ID = process.env.ABC_APP_ID
const ABC_APP_KEY = process.env.ABC_APP_KEY

const CLUBS = [
  { slug: 'salem', clubNumber: '30935', name: 'Salem' },
  { slug: 'keizer', clubNumber: '31599', name: 'Keizer' },
  { slug: 'eugene', clubNumber: '7655', name: 'Eugene' },
  { slug: 'springfield', clubNumber: '31598', name: 'Springfield' },
  { slug: 'clackamas', clubNumber: '31600', name: 'Clackamas' },
  { slug: 'milwaukie', clubNumber: '31601', name: 'Milwaukie' },
  { slug: 'medford', clubNumber: '32073', name: 'Medford' },
]

const router = Router()
router.use(authenticate)
router.use(requireRole('lead'))

function isPT(name) {
  const n = (name || '').toUpperCase()
  if (n.includes('CONSULT')) return false
  return n.includes('PT') || n.includes('TRAIN') || n.includes('PARTNER') ||
    n.includes('SMALL GROUP') || n.includes('ONLINE') || n.includes('CHALLENGE')
}

function isPIF(s) {
  return (s.recurringTypeDesc || '').toLowerCase().includes('paid in full')
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateChunks(startISO, endISO) {
  const out = []
  const final = new Date(endISO + 'T23:59:59')
  let cur = new Date(startISO + 'T00:00:00')
  while (cur <= final) {
    const chunkEnd = new Date(cur)
    chunkEnd.setDate(chunkEnd.getDate() + 179)
    if (chunkEnd > final) chunkEnd.setTime(final.getTime())
    out.push(`${fmtDate(cur)},${fmtDate(chunkEnd)}`)
    cur = new Date(chunkEnd)
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

async function abcGet(path, params = {}) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
  const url = `${ABC_BASE_URL}${path}${qs ? '?' + qs : ''}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(url, {
      headers: { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`ABC API HTTP ${res.status}`)
    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchPTRecurringServices(clubNumber, startISO, endISO, paramName) {
  const seen = new Set()
  const all = []
  for (const range of dateChunks(startISO, endISO)) {
    let page = 1
    while (page <= 25) {
      const data = await abcGet(`/${clubNumber}/members/recurringservices`, {
        [paramName]: range, size: 200, page,
      })
      const svcs = data.recurringServices || []
      for (const s of svcs) {
        const id = s.recurringServiceId
        if (id && seen.has(id)) continue
        if (id) seen.add(id)
        if (!isPT(s.serviceItem)) continue
        all.push(s)
      }
      if (svcs.length < 200) break
      page++
    }
  }
  return all
}

const historyCache = new Map()
async function fetchPTPurchaseHistory(clubNumber, memberId) {
  if (!memberId) return []
  const key = `${clubNumber}:${memberId}`
  if (historyCache.has(key)) return historyCache.get(key)
  try {
    const data = await abcGet(`/${clubNumber}/members/${memberId}/services/purchasehistory`, {
      purchaseDateRange: '2020-01-01',
    })
    const summaries = (data.serviceSummaries || []).filter(s => isPT(s.serviceName))
    historyCache.set(key, summaries)
    return summaries
  } catch (e) {
    console.warn(`[Deactivated PT] purchasehistory failed for ${memberId}@${clubNumber}:`, e.message)
    historyCache.set(key, [])
    return []
  }
}

// Pull every recurring service for a single member, regardless of date — used
// to verify "no different active RS exists" before we flag someone as PIF
// Burned. The window-filtered club fetch can miss long-running active services
// that haven't been modified recently.
const memberRSCache = new Map()
async function fetchMemberAllRS(clubNumber, memberId) {
  if (!memberId) return []
  const key = `${clubNumber}:${memberId}`
  if (memberRSCache.has(key)) return memberRSCache.get(key)
  try {
    const all = []
    let page = 1
    while (page <= 5) {
      const data = await abcGet(`/${clubNumber}/members/recurringservices`, {
        memberId, size: 200, page,
      })
      const svcs = data.recurringServices || []
      for (const s of svcs) {
        if (!isPT(s.serviceItem)) continue
        all.push(s)
      }
      if (svcs.length < 200) break
      page++
    }
    memberRSCache.set(key, all)
    return all
  } catch (e) {
    console.warn(`[Deactivated PT] member RS fetch failed for ${memberId}@${clubNumber}:`, e.message)
    memberRSCache.set(key, [])
    return []
  }
}

// Plan-detail cache for rich names — same pattern as ptNewClients.js. The
// recurring-services payload returns the short `serviceItem` ("PT 60MIN");
// the full name with frequency + duration ("PT60 3X/WEEK 12 MONTHS") lives
// on the recurringServicePlan entity.
const planCache = new Map()
const PLAN_CACHE_TTL = 60 * 60 * 1000
async function fetchPlanName(clubNumber, planId) {
  if (!planId) return null
  const key = `${clubNumber}:${planId}`
  const hit = planCache.get(key)
  if (hit && (Date.now() - hit.ts) < PLAN_CACHE_TTL) return hit.name
  try {
    const data = await abcGet(`/${clubNumber}/clubs/recurringserviceplans/${planId}`)
    const name = data?.recurringServicePlanDetail?.recurringServicePlanName || null
    planCache.set(key, { name, ts: Date.now() })
    return name
  } catch (e) {
    console.warn(`[Deactivated PT] plan fetch failed for ${planId}@${clubNumber}:`, e.message)
    return null
  }
}

function memberName(s) {
  const f = (s.memberFirstName || '').trim()
  const l = (s.memberLastName || '').trim()
  return `${f} ${l}`.trim() || 'Unknown'
}

function serviceEmployee(s) {
  const f = (s.serviceEmployeeFirstName || '').trim()
  const l = (s.serviceEmployeeLastName || '').trim()
  return `${f} ${l}`.trim()
}

// Names of date fields on a recurring service entry that signal "this service
// is no longer active". `saleDate` and `nextBillingDate` represent the entry
// at its sale time / billing schedule, so we explicitly avoid them.
const TERMINATION_FIELD_NAMES = [
  'cancellationDate', 'cancellationTimestamp',
  'cancelDate', 'cancelTimestamp', 'cancelledDate',
  'terminationDate', 'terminationTimestamp', 'terminatedDate',
  'endDate', 'endTimestamp', 'enddate',
  'deactivationDate', 'deactivationTimestamp', 'deactivatedDate',
  'expirationDate', 'expirationTimestamp', 'expiresOn',
  'statusDate', 'statusTimestamp', 'statusChangedDate', 'statusChangeDate',
  'freezeDate', 'frozenDate', 'freezeStartDate',
  'lastBillingDate',
]

// Pull whichever deactivation date ABC encodes on the row. The first
// recognized field wins; fall back to top-level lastModifiedTimestamp (the
// query is filtered by lastModifiedTimestampRange, so it's always present)
// and finally to any `recurringServiceDates` value that smells like a date
// but doesn't sit in the sale/nextBilling slot.
function deactivationDate(s) {
  const dates = s.recurringServiceDates || {}
  for (const field of TERMINATION_FIELD_NAMES) {
    const v = dates[field] ?? s[field]
    if (v) return String(v).slice(0, 10)
  }
  const topLevelCandidates = [
    s.lastModifiedTimestamp, s.lastModifiedDate, s.lastModified,
    s.statusModifiedTimestamp, s.statusModifiedDate,
    s.modifiedTimestamp, s.modifiedDate, s.modifiedDateTime,
    s.lastUpdated, s.lastUpdatedDate, s.lastUpdatedTimestamp,
    s.dateModified, s.dateUpdated,
    s.cancelDate, s.cancellationDate, s.terminationDate, s.endDate,
  ]
  for (const v of topLevelCandidates) {
    if (v) return String(v).slice(0, 10)
  }
  // Last-resort sweep: any date-shaped value on recurringServiceDates that
  // isn't the sale or next-billing slot.
  const ignored = new Set(['saleDate', 'nextBillingDate', 'firstBillingDate', 'startDate', 'startdate', 'beginDate'])
  for (const [k, v] of Object.entries(dates)) {
    if (ignored.has(k)) continue
    if (v && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v).slice(0, 10)
  }
  return ''
}

function normalizeRSName(name) {
  if (!name) return name
  return name.replace(/\bSINGLE\b/gi, 'PT60')
}

function parsePriceField(raw) {
  if (raw == null || raw === '') return 0
  const cleaned = String(raw).replace(/[$,]/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

// Look up the last completed-session timestamp per (club, member) for a batch
// of members, all in one Supabase query. Returns Map<memberId, 'YYYY-MM-DD'>.
async function fetchLastSessionDates(clubNumber, memberIds) {
  const out = new Map()
  if (!memberIds.length) return out
  // Chunk into batches of 500 to avoid query length issues
  for (let i = 0; i < memberIds.length; i += 500) {
    const chunk = memberIds.slice(i, i + 500)
    const { data, error } = await supabaseAdmin
      .from('abc_calendar_events')
      .select('member_id, event_timestamp')
      .eq('club_number', clubNumber)
      .eq('status', 'Completed')
      .in('member_id', chunk)
      .order('event_timestamp', { ascending: false })
      .limit(50000)
    if (error) {
      console.warn(`[Deactivated PT] last-session query failed:`, error.message)
      continue
    }
    for (const r of (data || [])) {
      if (out.has(r.member_id)) continue // already have the most recent (DESC order)
      const day = String(r.event_timestamp || '').slice(0, 10)
      if (day) out.set(r.member_id, day)
    }
  }
  return out
}

async function buildClub(club, startDate, endDate) {
  // Pull anything that *changed* in the window — covers both deactivations
  // and PIF session-redemption activity.
  const allSvcs = await fetchPTRecurringServices(
    club.clubNumber,
    startDate,
    endDate,
    'lastModifiedTimestampRange'
  )

  // Bucket each member's window-modified footprint. Used for: identifying
  // PIF-burn candidates (anyPIF). Active-RS check is done separately against
  // the member's FULL RS history below so we don't miss steady-state active
  // services that didn't change in this window.
  const memberFootprint = new Map() // memberId -> { anyPIF, latestPIF }
  for (const s of allSvcs) {
    const f = memberFootprint.get(s.memberId) || { anyPIF: false, latestPIF: null }
    if (isPIF(s)) {
      f.anyPIF = true
      const sd = s.recurringServiceDates?.saleDate
      if (!f.latestPIF || (sd && sd > (f.latestPIF.recurringServiceDates?.saleDate || ''))) {
        f.latestPIF = s
      }
    }
    memberFootprint.set(s.memberId, f)
  }

  // Collect plan IDs we'll need rich names for (deactivated RS rows only —
  // PIF rows use a synthesized "N PACK" label).
  const planIds = new Set()
  for (const s of allSvcs) {
    if (isPIF(s)) continue
    const status = String(s.recurringServiceStatus || '').toLowerCase()
    if (status === 'active' || !status) continue
    const pid = s.recurringServicePlanId || s.servicePlanId
    if (pid) planIds.add(String(pid))
  }
  const planNames = new Map()
  const uniquePlans = [...planIds]
  for (let i = 0; i < uniquePlans.length; i += 5) {
    const batch = uniquePlans.slice(i, i + 5)
    const results = await Promise.all(batch.map(pid => fetchPlanName(club.clubNumber, pid)))
    results.forEach((name, idx) => { if (name) planNames.set(batch[idx], name) })
    if (i + 5 < uniquePlans.length) await new Promise(r => setTimeout(r, 100))
  }

  const rows = []

  // --- Deactivated RS rows ---------------------------------------------------
  for (const s of allSvcs) {
    if (isPIF(s)) continue
    const status = String(s.recurringServiceStatus || '').toLowerCase()
    if (status === 'active' || !status) continue
    const pid = s.recurringServicePlanId || s.servicePlanId
    const planName = (pid && planNames.get(String(pid))) || s.recurringServicePlanName || s.serviceItem || 'Unknown'
    rows.push({
      type: 'Deactivated RS',
      memberId: s.memberId,
      memberName: memberName(s),
      package: normalizeRSName(planName),
      serviceEmployee: serviceEmployee(s),
      saleDate: s.recurringServiceDates?.saleDate?.slice(0, 10) || '',
      cancelDate: deactivationDate(s),
      // Monthly recurring price (per-billing invoice total).
      value: parsePriceField(s.invoiceTotal),
      clubName: club.name,
      locationSlug: club.slug,
    })
  }

  // --- PIF Burned rows -------------------------------------------------------
  // Candidate set: members with PIF activity in the window. We verify each
  // against their full history before flagging as burned: must have zero
  // sessions left AND no different active RS anywhere on their record.
  const pifCandidates = [...memberFootprint.entries()]
    .filter(([, f]) => f.anyPIF)
    .map(([memberId]) => memberId)

  const verifiedBurned = []
  for (let i = 0; i < pifCandidates.length; i += 5) {
    const batch = pifCandidates.slice(i, i + 5)
    await Promise.all(batch.map(async memberId => {
      const [history, allMemberRS] = await Promise.all([
        fetchPTPurchaseHistory(club.clubNumber, memberId),
        fetchMemberAllRS(club.clubNumber, memberId),
      ])
      if (!history.length) return
      const hasSessionsLeft = history.some(h => parseInt(h.available || '0', 10) > 0)
      if (hasSessionsLeft) return
      const hasActiveRS = allMemberRS.some(s =>
        !isPIF(s) && String(s.recurringServiceStatus || '').toLowerCase() === 'active'
      )
      if (hasActiveRS) return
      verifiedBurned.push({ memberId, history, allMemberRS })
    }))
    if (i + 5 < pifCandidates.length) await new Promise(r => setTimeout(r, 200))
  }

  // Fetch the last completed-session date for the verified burned set in one
  // bulk query against abc_calendar_events.
  const lastSessionMap = await fetchLastSessionDates(
    club.clubNumber,
    verifiedBurned.map(v => v.memberId)
  )

  for (const v of verifiedBurned) {
    const sorted = [...v.history].sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''))
    const latestSummary = sorted[0]
    const footprint = memberFootprint.get(v.memberId)
    const latestPIFRow = footprint?.latestPIF
    // Display the pack count exactly like the PT New Clients report does:
    // {N} PACK using the purchased session count from purchasehistory.
    const totalBought = parseInt(latestSummary.purchased || '0', 10)
    const pkg = totalBought > 0 ? `${totalBought} PACK` : 'PACK'
    rows.push({
      type: 'PIF Burned',
      memberId: v.memberId,
      memberName: latestPIFRow ? memberName(latestPIFRow) : (`${(latestSummary.memberFirstName || '').trim()} ${(latestSummary.memberLastName || '').trim()}`.trim() || 'Unknown'),
      package: pkg,
      serviceEmployee: latestPIFRow ? serviceEmployee(latestPIFRow) : '',
      saleDate: latestSummary.purchaseDate?.slice(0, 10) || '',
      cancelDate: lastSessionMap.get(v.memberId) || '',
      // Total PIF purchase price (one-time).
      value: parsePriceField(latestSummary.totalPrice),
      clubName: club.name,
      locationSlug: club.slug,
    })
  }

  return rows
}

// Extracted so the cache warmer can invoke the same code path the route does.
// Throws (err.status) for bad-request conditions; the route handler maps
// these to res.status(err.status).
async function buildDeactivatedPTPayload({ start_date, end_date, location_slug }) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    const err = new Error('ABC API credentials not configured')
    err.status = 500
    throw err
  }
  if (!start_date || !end_date) {
    const err = new Error('start_date and end_date are required (YYYY-MM-DD)')
    err.status = 400
    throw err
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    const err = new Error('Dates must be YYYY-MM-DD')
    err.status = 400
    throw err
  }
  if (start_date > end_date) {
    const err = new Error('start_date must be on or before end_date')
    err.status = 400
    throw err
  }

  let targetClubs = CLUBS
  let slugKey = 'all'
  if (location_slug && location_slug !== 'all') {
    const club = CLUBS.find(c => c.slug === location_slug.toLowerCase())
    if (!club) {
      const err = new Error(`Unknown location: ${location_slug}`)
      err.status = 400
      throw err
    }
    targetClubs = [club]
    slugKey = club.slug
  }

  const cacheKey = `reports:deactivated-pt:${start_date}:${end_date}:${slugKey}`
  return wrapSWR(
    cacheKey,
    DEACTIVATED_PT_FRESH_MS,
    DEACTIVATED_PT_STALE_MS,
    async () => {
        const results = await Promise.allSettled(
          targetClubs.map(c => buildClub(c, start_date, end_date))
        )

        const rows = []
        const errors = []
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') rows.push(...r.value)
          else errors.push({ club: targetClubs[i].name, error: r.reason?.message || 'Unknown error' })
        })

        rows.sort((a, b) =>
          (b.cancelDate || '').localeCompare(a.cancelDate || '') ||
          (a.memberName || '').localeCompare(b.memberName || '')
        )

        const summary = rows.reduce(
          (acc, r) => {
            if (r.type === 'Deactivated RS') acc.deactivatedCount++
            else acc.burnedCount++
            return acc
          },
          { deactivatedCount: 0, burnedCount: 0 }
        )
        summary.total = rows.length

        return {
          rows,
          summary,
          errors: errors.length ? errors : undefined,
        }
      }
    )
}

// GET /reports/deactivated-pt?start_date=&end_date=&location_slug=
router.get('/', async (req, res) => {
  try {
    const payload = await buildDeactivatedPTPayload(req.query)
    res.json(payload)
  } catch (err) {
    console.error('[Deactivated PT] Error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /reports/deactivated-pt/member/:memberId?location_slug=salem
// Returns live contact info from ABC for the member-detail popup on the
// Deactivated PT report. Sensitive enough that we re-check role (lead+).
router.get('/member/:memberId', async (req, res) => {
  try {
    if (!ABC_APP_ID || !ABC_APP_KEY) {
      return res.status(500).json({ error: 'ABC API credentials not configured' })
    }
    const { memberId } = req.params
    const slug = (req.query.location_slug || '').toLowerCase()
    if (!memberId) return res.status(400).json({ error: 'memberId is required' })
    const club = CLUBS.find(c => c.slug === slug)
    if (!club) return res.status(400).json({ error: `Unknown or missing location_slug: ${slug}` })

    const data = await abcGet(`/${club.clubNumber}/members/${encodeURIComponent(memberId)}`)
    // ABC returns the same shape as the list endpoint — `members` array with
    // one entry holding `personal` and `agreement` blocks.
    const m = (data?.members || [])[0]
    if (!m) return res.status(404).json({ error: 'Member not found in ABC' })
    const p = m.personal || {}
    res.json({
      memberId: m.memberId || memberId,
      clubName: club.name,
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      name: `${(p.firstName || '').trim()} ${(p.lastName || '').trim()}`.trim() || 'Unknown',
      email: p.email || '',
      primaryPhone: p.primaryPhone || '',
      mobilePhone: p.mobilePhone || '',
    })
  } catch (err) {
    console.error('[Deactivated PT] /member lookup failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /reports/deactivated-pt/debug-sample?location_slug=salem
// Admin-only. Inspect a raw deactivated recurring service row so we can
// confirm which ABC field carries the cancellation date in this tenant.
router.get('/debug-sample', async (req, res) => {
  try {
    if (req.staff.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' })
    }
    if (!ABC_APP_ID || !ABC_APP_KEY) {
      return res.status(500).json({ error: 'ABC API credentials not configured' })
    }
    const slug = (req.query.location_slug || 'salem').toLowerCase()
    const club = CLUBS.find(c => c.slug === slug)
    if (!club) return res.status(400).json({ error: `Unknown location: ${slug}` })

    const today = new Date()
    const start = new Date(today)
    start.setDate(start.getDate() - 90)
    const allSvcs = await fetchPTRecurringServices(
      club.clubNumber,
      fmtDate(start),
      fmtDate(today),
      'lastModifiedTimestampRange'
    )
    const deactivated = allSvcs.filter(s => {
      if (isPIF(s)) return false
      const st = String(s.recurringServiceStatus || '').toLowerCase()
      return st && st !== 'active'
    }).slice(0, 3)
    res.json({
      club: club.name,
      count: deactivated.length,
      samples: deactivated,
      detected_dates: deactivated.map(s => ({
        memberId: s.memberId,
        status: s.recurringServiceStatus,
        detected_cancel_date: deactivationDate(s),
        recurringServiceDates: s.recurringServiceDates,
        top_level_date_keys: Object.keys(s).filter(k => /date|time|modified|updated/i.test(k)),
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.warmCache = buildDeactivatedPTPayload
