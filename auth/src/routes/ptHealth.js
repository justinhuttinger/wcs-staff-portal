const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireReportAccess } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { funnel, scheduledInRange, statusLabel } = require('../lib/dayOneReporting')
const { wrap, wrapSWR } = require('../services/memoryCache')
const { parseLocationSlugParam, locationCacheKey } = require('../utils/locationSlug')

// Phase 2 perf: cache the heavy ABC+GHL aggregation payload across users.
const PT_HEALTH_FRESH_MS = 5 * 60 * 1000
const PT_HEALTH_STALE_MS = 30 * 60 * 1000

// PT Health — overview dashboard combining Day Ones (GHL), New PT (ABC sales),
// and Deactivated PT (ABC churn) into one set of summary numbers + per-location
// breakdown. Numbers match the dedicated reports for each component.

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
router.use(requireReportAccess('lead', ['pt-health']))

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

// Per-member ABC lookups, cached only long enough to dedupe repeat calls
// within one report run — high cardinality (thousands of PT members across
// seven clubs), so this deliberately does NOT persist across runs. Backed by
// the shared memoryCache helper, which caps total entries and sweeps expired
// ones so a busy day of report runs can't grow this without bound.
const MEMBER_LOOKUP_TTL_MS = 5 * 60 * 1000

async function fetchPTPurchaseHistory(clubNumber, memberId) {
  if (!memberId) return []
  const key = `pt-health:history:${clubNumber}:${memberId}`
  return wrap(key, MEMBER_LOOKUP_TTL_MS, async () => {
    try {
      const data = await abcGet(`/${clubNumber}/members/${memberId}/services/purchasehistory`, {
        purchaseDateRange: '2020-01-01',
      })
      return (data.serviceSummaries || []).filter(s => isPT(s.serviceName))
    } catch (e) {
      console.warn(`[PT Health] purchasehistory failed for ${memberId}@${clubNumber}:`, e.message)
      return []
    }
  })
}

async function fetchMemberAllRS(clubNumber, memberId) {
  if (!memberId) return []
  const key = `pt-health:member-rs:${clubNumber}:${memberId}`
  return wrap(key, MEMBER_LOOKUP_TTL_MS, async () => {
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
      return all
    } catch (e) {
      return []
    }
  })
}

function parsePriceField(raw) {
  if (raw == null || raw === '') return 0
  const cleaned = String(raw).replace(/[$,]/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

// New PT — mirror PT New Clients backend: sales (RS + PIF) inside the window,
// classified New Client vs Resign by the 90-day prior-purchase lookback. We
// only return aggregates here.
async function computeNewPT(club, startDate, endDate) {
  const lookbackStart = new Date(startDate + 'T00:00:00')
  lookbackStart.setDate(lookbackStart.getDate() - 90)
  const lookbackStartISO = fmtDate(lookbackStart)

  const allSales = await fetchPTRecurringServices(club.clubNumber, lookbackStartISO, endDate, 'saleTimestampRange')

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

  let count = 0
  let newClientCount = 0
  let resignCount = 0
  let revenue = 0
  let newClientRevenue = 0
  let resignRevenue = 0

  for (const sales of byMember.values()) {
    for (let i = 0; i < sales.length; i++) {
      const { saleDate, raw } = sales[i]
      if (saleDate < startDate || saleDate > endDate) continue
      count++
      const price = parsePriceField(raw.invoiceTotal ?? raw.totalPrice)
      revenue += price
      const cutoff = new Date(saleDate + 'T00:00:00')
      cutoff.setDate(cutoff.getDate() - 90)
      const cutoffISO = fmtDate(cutoff)
      let hasPrior = false
      for (let j = 0; j < i; j++) {
        if (sales[j].saleDate < cutoffISO) continue
        if (sales[j].saleDate >= saleDate) break
        hasPrior = true
        break
      }
      if (hasPrior) { resignCount++; resignRevenue += price }
      else { newClientCount++; newClientRevenue += price }
    }
  }

  return { count, newClientCount, resignCount, revenue, newClientRevenue, resignRevenue }
}

// Deactivated PT — mirror Deactivated PT backend: non-active RS within window
// + PIF Burned verified by full-history check. Aggregates only.
async function computeDeactivatedPT(club, startDate, endDate) {
  const allSvcs = await fetchPTRecurringServices(club.clubNumber, startDate, endDate, 'lastModifiedTimestampRange')

  let deactivatedRSCount = 0
  let deactivatedRSValue = 0
  const pifCandidates = new Set()

  for (const s of allSvcs) {
    if (isPIF(s)) {
      pifCandidates.add(s.memberId)
      continue
    }
    const status = String(s.recurringServiceStatus || '').toLowerCase()
    if (status === 'active' || !status) continue
    deactivatedRSCount++
    deactivatedRSValue += parsePriceField(s.invoiceTotal)
  }

  let burnedPIFCount = 0
  let burnedPIFValue = 0
  const candidates = [...pifCandidates]
  for (let i = 0; i < candidates.length; i += 5) {
    const batch = candidates.slice(i, i + 5)
    await Promise.all(batch.map(async memberId => {
      const [history, allMemberRS] = await Promise.all([
        fetchPTPurchaseHistory(club.clubNumber, memberId),
        fetchMemberAllRS(club.clubNumber, memberId),
      ])
      if (!history.length) return
      if (history.some(h => parseInt(h.available || '0', 10) > 0)) return
      if (allMemberRS.some(s => !isPIF(s) && String(s.recurringServiceStatus || '').toLowerCase() === 'active')) return
      const sorted = [...history].sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''))
      burnedPIFCount++
      burnedPIFValue += parsePriceField(sorted[0].totalPrice)
    }))
    if (i + 5 < candidates.length) await new Promise(r => setTimeout(r, 200))
  }

  return {
    count: deactivatedRSCount + burnedPIFCount,
    deactivatedRSCount,
    burnedPIFCount,
    value: deactivatedRSValue + burnedPIFValue,
    deactivatedRSValue,
    burnedPIFValue,
  }
}

// Day Ones, from day_one_appointments (see lib/dayOneReporting).
//
// This used to read ghl_contacts_report's day_one_* columns, which are a
// snapshot of GHL contact CUSTOM FIELDS: a Day One only counted if a workflow
// had written the field, and a contact carries one set of them, so a member
// with two Day Ones counted once. Measured over August that undercounted the
// set by 23%.
//
//   Set   = every Day One SCHEDULED in the window, cancellations included
//   Show  = status  = 'completed'
//   Close = Show and outcome = 'Sale'
//
// Windowed on scheduled_date (when the appointment IS), never booked_at (when
// it was booked) — different cohorts, and mixing them was the original sin of
// the legacy version. scheduled_date is a real date column, which also retires
// the epoch-millisecond bounds and the Pacific-offset bug that kept pushing
// bookings dated the 1st of a month into the month before.
async function computeDayOnes(slug, startDate, endDate) {
  return funnel({ locationSlug: slug, startDate, endDate })
}

// Extracted so the cache warmer can invoke the same code path the route does.
async function buildPtHealthPayload({ start_date, end_date, location_slug }) {
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

  const parsedLocs = parseLocationSlugParam(location_slug)
  if (parsedLocs.invalid) {
    const err = new Error(`Unknown location: ${parsedLocs.invalid}`)
    err.status = 400
    throw err
  }
  const targetClubs = parsedLocs.all ? CLUBS : CLUBS.filter(c => parsedLocs.slugs.includes(c.slug))
  const slugKey = locationCacheKey(parsedLocs)

  const cacheKey = `reports:pt-health:${start_date}:${end_date}:${slugKey}`
  return wrapSWR(
    cacheKey,
    PT_HEALTH_FRESH_MS,
    PT_HEALTH_STALE_MS,
    async () => {
        const perClub = await Promise.all(targetClubs.map(async club => {
          const [newPT, deact, dayOnes] = await Promise.all([
            computeNewPT(club, start_date, end_date),
            computeDeactivatedPT(club, start_date, end_date),
            computeDayOnes(club.slug, start_date, end_date),
          ])
          return {
            clubName: club.name,
            locationSlug: club.slug,
            dayOnes,
            newPT,
            deactivated: deact,
            netClients: newPT.count - deact.count,
            netRevenue: newPT.revenue - deact.value,
          }
        }))

        // Totals across all returned clubs
        const totals = perClub.reduce((acc, c) => {
          acc.dayOnes.set += c.dayOnes.set
          acc.dayOnes.show += c.dayOnes.show
          acc.dayOnes.close += c.dayOnes.close
          acc.newPT.count += c.newPT.count
          acc.newPT.newClientCount += c.newPT.newClientCount
          acc.newPT.resignCount += c.newPT.resignCount
          acc.newPT.revenue += c.newPT.revenue
          acc.newPT.newClientRevenue += c.newPT.newClientRevenue
          acc.newPT.resignRevenue += c.newPT.resignRevenue
          acc.deactivated.count += c.deactivated.count
          acc.deactivated.deactivatedRSCount += c.deactivated.deactivatedRSCount
          acc.deactivated.burnedPIFCount += c.deactivated.burnedPIFCount
          acc.deactivated.value += c.deactivated.value
          acc.deactivated.deactivatedRSValue += c.deactivated.deactivatedRSValue
          acc.deactivated.burnedPIFValue += c.deactivated.burnedPIFValue
          return acc
        }, {
          dayOnes: { set: 0, show: 0, close: 0 },
          newPT: { count: 0, newClientCount: 0, resignCount: 0, revenue: 0, newClientRevenue: 0, resignRevenue: 0 },
          deactivated: {
            count: 0, deactivatedRSCount: 0, burnedPIFCount: 0,
            value: 0, deactivatedRSValue: 0, burnedPIFValue: 0,
          },
        })
        totals.netClients = totals.newPT.count - totals.deactivated.count
        totals.netRevenue = totals.newPT.revenue - totals.deactivated.value

        return {
          period: { start: start_date, end: end_date },
          totals,
          byLocation: perClub,
        }
      }
    )
}

// GET /reports/pt-health?start_date=&end_date=&location_slug=
router.get('/', async (req, res) => {
  try {
    const payload = await buildPtHealthPayload(req.query)
    res.json(payload)
  } catch (err) {
    console.error('[PT Health] Error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /reports/pt-health/debug-day-one?start_date=&end_date=&location_slug=
// Admin-only. Returns the exact rows PT Health is using for Day Ones so we
// can compare against /reports/pt row-for-row when numbers diverge.
router.get('/debug-day-one', async (req, res) => {
  try {
    if (req.staff.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' })
    }
    const { start_date, end_date, location_slug } = req.query
    const rows = await scheduledInRange({
      locationSlug: location_slug, startDate: start_date, endDate: end_date,
    })
    const byStatus = {}
    const bySale = {}
    let showCount = 0
    let closeCount = 0
    for (const r of rows) {
      // Reported under the legacy labels so this still reads against the older
      // dashboards it exists to be compared with.
      const st = statusLabel(r.status)
      byStatus[st] = (byStatus[st] || 0) + 1
      if (r.status === 'completed') {
        showCount++
        const sale = r.outcome || 'No Sale'
        bySale[sale] = (bySale[sale] || 0) + 1
        if (r.outcome === 'Sale') closeCount++
      }
    }
    res.json({
      query: { start_date, end_date, location_slug, source: 'day_one_appointments' },
      set: rows.length,
      show: showCount,
      close: closeCount,
      byStatus,
      bySaleOnCompleted: bySale,
      sampleRows: rows.slice(0, 5),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
module.exports.warmCache = buildPtHealthPayload
