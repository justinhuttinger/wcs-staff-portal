const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireReportAccess } = require('../middleware/role')
const memoryCache = require('../services/memoryCache')
const { wrap, wrapSWR } = memoryCache
const { parseLocationSlugParam, locationCacheKey } = require('../utils/locationSlug')

// Phase 2 perf: cache the heavy ABC-aggregation payload across users.
const PT_NEW_CLIENTS_FRESH_MS = 5 * 60 * 1000
const PT_NEW_CLIENTS_STALE_MS = 30 * 60 * 1000

// PT "New Clients" report — recurring PT services SOLD in the requested window,
// classified as either "New Client" (member purchased no PT in the prior 90 days)
// or "Resign" (member had at least one PT purchase in the prior 90 days).
//
// Data source: ABC Financial `GET /{clubNumber}/members/recurringservices`
// queried by `saleTimestampRange`. The endpoint returns both recurring agreements
// and Paid-in-Full sessions; we display the recurring rows but consider BOTH
// when looking back 90 days for the classification.

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
router.use(requireReportAccess('lead', ['pt-new-clients']))

function isPT(name) {
  const n = (name || '').toUpperCase()
  if (n.includes('CONSULT')) return false
  return n.includes('PT') || n.includes('TRAIN') || n.includes('PARTNER') ||
    n.includes('SMALL GROUP') || n.includes('ONLINE') || n.includes('CHALLENGE')
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ABC's saleTimestampRange tops out at 180 days per request, so chunk the
// (start - 90 days, end) span into 180-day windows.
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

async function fetchPTSales(clubNumber, lookbackStart, windowEnd) {
  const seen = new Set()
  const all = []
  for (const range of dateChunks(lookbackStart, windowEnd)) {
    let page = 1
    while (page <= 25) {
      const data = await abcGet(`/${clubNumber}/members/recurringservices`, {
        saleTimestampRange: range, size: 200, page,
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

function serviceEmployee(s) {
  const f = (s.serviceEmployeeFirstName || '').trim()
  const l = (s.serviceEmployeeLastName || '').trim()
  return `${f} ${l}`.trim()
}

// Resolve the commission recipient(s) for a recurring service. ABC's
// `/members/recurringservices` payload includes `commissionsEmployeeIds` — an
// array of employee IDs — but no names. Names come from `/{club}/employees`,
// fetched once per club and passed in as `empMap` (id -> "First Last").
// Falls back to serviceEmployee() if the array is missing/unresolved so the
// column still has something useful.
function commissionEmployee(s, empMap) {
  const ids = Array.isArray(s.commissionsEmployeeIds) ? s.commissionsEmployeeIds : []
  if (ids.length && empMap) {
    const names = ids.map(id => empMap.get(id)).filter(Boolean)
    if (names.length) return names.join(', ')
  }
  return serviceEmployee(s)
}

// Pull /{club}/employees once per report run and build an id -> "First Last" map.
// Returns an empty Map on failure so callers can still fall back to serviceEmployee.
async function fetchEmployeeMap(clubNumber) {
  try {
    const data = await abcGet(`/${clubNumber}/employees`)
    const map = new Map()
    for (const emp of (data?.employees || [])) {
      const id = emp.employeeId || emp.id
      if (!id) continue
      const first = (emp.personal?.firstName || '').trim()
      const last = (emp.personal?.lastName || '').trim()
      const name = `${first} ${last}`.trim()
      if (name) map.set(id, name)
    }
    return map
  } catch (e) {
    console.warn(`[PT New Clients] /employees fetch failed for ${clubNumber}:`, e.message)
    return new Map()
  }
}

function memberName(s) {
  const f = (s.memberFirstName || '').trim()
  const l = (s.memberLastName || '').trim()
  return `${f} ${l}`.trim() || 'Unknown'
}

function parsePrice(s) {
  const raw = s.invoiceTotal ?? s.totalPrice ?? '0'
  const cleaned = String(raw).replace(/[$,]/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

function isPIF(s) {
  return (s.recurringTypeDesc || '').toLowerCase().includes('paid in full')
}

// Plan-detail cache keyed by `${clubNumber}:${planId}`. The recurring services
// endpoint returns only the short `serviceItem` (e.g. "PT 60MIN"); the rich
// name with frequency or pack count ("PT 60MIN 3XWEEK") and the per-purchase
// quantity for PIF packs live on the recurringServicePlan entity, fetched
// separately. Lower cardinality than the per-member caches below (bounded by
// distinct recurring-service plans, not members), so this keeps a longer TTL.
const PLAN_CACHE_TTL = 60 * 60 * 1000 // 1h

function toPosInt(v) {
  if (v === undefined || v === null || v === '') return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

// NOTE: unlike the per-member caches below, a failed lookup here is
// deliberately NOT cached (matches pre-refactor behavior) — plan-detail
// fetches are cheap/low-cardinality and a transient ABC error shouldn't
// suppress retries for the rest of the TTL window. So this uses memoryCache's
// get/set directly rather than wrap(), which would cache the null result.
async function fetchPlanDetail(clubNumber, planId) {
  if (!planId) return null
  const key = `pt-new-clients:plan:${clubNumber}:${planId}`
  const hit = memoryCache.get(key)
  if (hit !== undefined) return hit
  try {
    const data = await abcGet(`/${clubNumber}/clubs/recurringserviceplans/${planId}`)
    const d = data?.recurringServicePlanDetail || {}
    // Probe every quantity-shaped field ABC has historically returned on the
    // recurringServicePlanDetail (different tenants surface different ones).
    const quantity =
      toPosInt(d.billing?.serviceQuantity) ??
      toPosInt(d.billing?.totalServiceQuantity) ??
      toPosInt(d.billing?.quantity) ??
      toPosInt(d.serviceQuantity) ??
      toPosInt(d.quantity) ??
      toPosInt(d.numberOfServices) ??
      toPosInt(d.totalServices) ??
      null
    const detail = {
      name: d.recurringServicePlanName || null,
      quantity,
    }
    memoryCache.set(key, detail, PLAN_CACHE_TTL)
    return detail
  } catch (e) {
    console.warn(`[PT New Clients] Plan fetch failed for ${planId}@${clubNumber}:`, e.message)
    return null
  }
}

// "SINGLE" is ABC's marker for solo (1-on-1) PT in plan names. The front-desk
// folks read "SINGLE" as "PT60" so we swap it inline. Word-boundary so we don't
// hit substrings like "SINGLES".
function normalizeRSName(name) {
  if (!name) return name
  return name.replace(/\bSINGLE\b/gi, 'PT60')
}

// Try every place ABC might encode the PIF session count: sale entry, plan
// detail, then a numeric pack-count baked into the plan name itself.
function pifSessionCount(s, planDetail) {
  return (
    toPosInt(s.quantity) ??
    toPosInt(s.unitsPurchased) ??
    toPosInt(s.numberOfServices) ??
    toPosInt(s.numberOfSessions) ??
    toPosInt(s.sessionsPurchased) ??
    toPosInt(s.totalSessions) ??
    toPosInt(s.totalPeriods) ??
    planDetail?.quantity ??
    parsePackCountFromName(planDetail?.name || s.serviceItem) ??
    null
  )
}

function parsePackCountFromName(name) {
  if (!name) return null
  const m = String(name).toUpperCase().match(/(\d+)\s*(?:PACK|SESSIONS?|SESS)\b/)
  return m ? toPosInt(m[1]) : null
}

function pifPackageName(s, planDetail) {
  const qty = pifSessionCount(s, planDetail)
  return qty ? `${qty} PACK` : 'PACK'
}

// The recurring-services payload doesn't include the PIF session count in any
// of the fields we've tried. The /members/{id}/services/purchasehistory
// endpoint is the canonical source — its `serviceSummaries[].purchased` is the
// sessions-bought count (same field ptRoster.js reads). Cached per-member for
// the lifetime of this request batch.
// Per-member ABC lookup, cached only long enough to dedupe repeat calls
// within one report run — high cardinality (thousands of PT members across
// seven clubs), so this deliberately does NOT persist across runs. Backed by
// the shared memoryCache helper, which caps total entries and sweeps expired
// ones so a busy day of report runs can't grow this without bound.
const MEMBER_LOOKUP_TTL_MS = 5 * 60 * 1000

async function fetchMemberPTPurchaseHistory(clubNumber, memberId) {
  if (!memberId) return []
  const key = `pt-new-clients:purchase-history:${clubNumber}:${memberId}`
  return wrap(key, MEMBER_LOOKUP_TTL_MS, async () => {
    try {
      const data = await abcGet(`/${clubNumber}/members/${memberId}/services/purchasehistory`, {
        purchaseDateRange: '2020-01-01',
      })
      return (data.serviceSummaries || []).filter(s => isPT(s.serviceName))
    } catch (e) {
      console.warn(`[PT New Clients] purchasehistory failed for ${memberId}@${clubNumber}:`, e.message)
      return []
    }
  })
}

// Pick the serviceSummary whose purchaseDate sits closest to this row's
// saleDate. Anything farther than 7 days off is treated as a non-match — the
// member probably bought multiple PT packs and we don't want to attach the
// wrong count.
function matchPurchaseSummary(summaries, saleDate) {
  if (!summaries.length) return null
  const target = new Date(saleDate + 'T00:00:00').getTime()
  const SEVEN_DAYS = 7 * 86400000
  let best = null
  let bestDiff = Infinity
  for (const s of summaries) {
    const pd = String(s.purchaseDate || '').slice(0, 10)
    if (!pd) continue
    const diff = Math.abs(new Date(pd + 'T00:00:00').getTime() - target)
    if (diff < bestDiff) {
      best = s
      bestDiff = diff
    }
  }
  return bestDiff <= SEVEN_DAYS ? best : null
}

async function buildClub(club, startDate, endDate) {
  // 90-day lookback before the window start
  const lookbackStart = new Date(startDate + 'T00:00:00')
  lookbackStart.setDate(lookbackStart.getDate() - 90)
  const lookbackStartISO = fmtDate(lookbackStart)

  const [allSales, employeeMap] = await Promise.all([
    fetchPTSales(club.clubNumber, lookbackStartISO, endDate),
    fetchEmployeeMap(club.clubNumber),
  ])

  // Bucket sales by member so we can do the 90-day lookback per row in O(1)
  // after a single sort. Each entry: { saleDate: 'YYYY-MM-DD', raw }.
  const byMember = new Map()
  for (const s of allSales) {
    const sd = s.recurringServiceDates?.saleDate
    if (!sd) continue
    const day = String(sd).slice(0, 10)
    if (!byMember.has(s.memberId)) byMember.set(s.memberId, [])
    byMember.get(s.memberId).push({ saleDate: day, raw: s })
  }
  for (const list of byMember.values()) {
    list.sort((a, b) => a.saleDate.localeCompare(b.saleDate))
  }

  // Collect unique plan IDs across rows that will appear in the window so we
  // can resolve rich plan names ("3XWEEK", "10 PACK") in batches of 5.
  const windowPlanIds = new Set()
  for (const [, sales] of byMember) {
    for (const { saleDate, raw } of sales) {
      if (saleDate < startDate || saleDate > endDate) continue
      const pid = raw.recurringServicePlanId || raw.servicePlanId
      if (pid) windowPlanIds.add(String(pid))
    }
  }
  const planDetails = new Map()
  const uniquePlans = [...windowPlanIds]
  for (let i = 0; i < uniquePlans.length; i += 5) {
    const batch = uniquePlans.slice(i, i + 5)
    const results = await Promise.all(batch.map(pid => fetchPlanDetail(club.clubNumber, pid)))
    results.forEach((detail, idx) => {
      if (detail) planDetails.set(batch[idx], detail)
    })
    if (i + 5 < uniquePlans.length) await new Promise(r => setTimeout(r, 100))
  }

  // Build rows for every sale in [startDate, endDate] — both RS and PIF.
  const rows = []
  for (const [memberId, sales] of byMember) {
    for (let i = 0; i < sales.length; i++) {
      const { saleDate, raw } = sales[i]
      if (saleDate < startDate || saleDate > endDate) continue

      // Look for ANY prior PT purchase (PIF or recurring) by this member
      // with saleDate strictly less than this row's and within 90 days back.
      const cutoffDate = new Date(saleDate + 'T00:00:00')
      cutoffDate.setDate(cutoffDate.getDate() - 90)
      const cutoffISO = fmtDate(cutoffDate)

      let hasPrior = false
      for (let j = 0; j < i; j++) {
        const prev = sales[j]
        if (prev.saleDate < cutoffISO) continue
        if (prev.saleDate >= saleDate) break
        hasPrior = true
        break
      }

      const pid = raw.recurringServicePlanId || raw.servicePlanId
      const detail = pid ? planDetails.get(String(pid)) : null
      const type = isPIF(raw) ? 'PIF' : 'RS'
      const pkg = type === 'PIF'
        ? pifPackageName(raw, detail)
        : normalizeRSName(detail?.name || raw.serviceItem || 'Unknown')

      rows.push({
        memberId,
        memberName: memberName(raw),
        package: pkg,
        type,
        price: parsePrice(raw),
        commissionEmployee: commissionEmployee(raw, employeeMap),
        serviceEmployee: serviceEmployee(raw),
        saleDate,
        classification: hasPrior ? 'Resign' : 'New Client',
        clubName: club.name,
        locationSlug: club.slug,
      })
    }
  }

  // Enrich PIF rows with session counts from the per-member purchase-history
  // endpoint (the recurring-services payload doesn't include it). Batches of 5
  // with a 200ms pause so we don't hammer ABC.
  const pifRows = rows.filter(r => r.type === 'PIF')
  for (let i = 0; i < pifRows.length; i += 5) {
    const batch = pifRows.slice(i, i + 5)
    await Promise.all(batch.map(async r => {
      const summaries = await fetchMemberPTPurchaseHistory(club.clubNumber, r.memberId)
      const match = matchPurchaseSummary(summaries, r.saleDate)
      const qty = toPosInt(match?.purchased)
      if (qty) r.package = `${qty} PACK`
    }))
    if (i + 5 < pifRows.length) await new Promise(r => setTimeout(r, 200))
  }

  return rows
}

// Extracted so the cache warmer can invoke the same code path the route does.
async function buildPtNewClientsPayload({ start_date, end_date, location_slug }) {
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

  const parsedLocs = parseLocationSlugParam(location_slug)
  if (parsedLocs.invalid) {
    const err = new Error(`Unknown location: ${parsedLocs.invalid}`)
    err.status = 400
    throw err
  }
  const targetClubs = parsedLocs.all ? CLUBS : CLUBS.filter(c => parsedLocs.slugs.includes(c.slug))
  const slugKey = locationCacheKey(parsedLocs)

  const cacheKey = `reports:pt-new-clients:${start_date}:${end_date}:${slugKey}`
  return wrapSWR(
    cacheKey,
    PT_NEW_CLIENTS_FRESH_MS,
    PT_NEW_CLIENTS_STALE_MS,
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

        rows.sort((a, b) => b.saleDate.localeCompare(a.saleDate) || a.memberName.localeCompare(b.memberName))

        const summary = rows.reduce(
          (acc, r) => {
            if (r.classification === 'New Client') {
              acc.newClientCount++
              acc.newClientRevenue += r.price
            } else {
              acc.resignCount++
              acc.resignRevenue += r.price
            }
            acc.totalRevenue += r.price
            return acc
          },
          { newClientCount: 0, resignCount: 0, newClientRevenue: 0, resignRevenue: 0, totalRevenue: 0 }
        )

        return {
          rows,
          summary,
          errors: errors.length ? errors : undefined,
        }
      }
    )
}

// GET /reports/pt-new-clients?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&location_slug=salem|all
router.get('/', async (req, res) => {
  try {
    const payload = await buildPtNewClientsPayload(req.query)
    res.json(payload)
  } catch (err) {
    console.error('[PT New Clients] Error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /reports/pt-new-clients/debug-sample?location_slug=salem
// Admin-only. Inspect raw ABC response to confirm commission-employee field name.
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
    start.setDate(start.getDate() - 30)
    const data = await abcGet(`/${club.clubNumber}/members/recurringservices`, {
      saleTimestampRange: `${fmtDate(start)},${fmtDate(today)}`,
      size: 10, page: 1,
    })
    const samples = (data.recurringServices || []).filter(s => isPT(s.serviceItem)).slice(0, 3)
    res.json({ club: club.name, sample_count: samples.length, samples })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.warmCache = buildPtNewClientsPayload
