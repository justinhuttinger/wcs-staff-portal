const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { wrapSWR } = require('../services/memoryCache')
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
    console.warn(`[PT Health] purchasehistory failed for ${memberId}@${clubNumber}:`, e.message)
    historyCache.set(key, [])
    return []
  }
}

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
    memberRSCache.set(key, [])
    return []
  }
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

  for (const sales of byMember.values()) {
    for (let i = 0; i < sales.length; i++) {
      const { saleDate, raw } = sales[i]
      if (saleDate < startDate || saleDate > endDate) continue
      count++
      revenue += parsePriceField(raw.invoiceTotal ?? raw.totalPrice)
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
      if (hasPrior) resignCount++
      else newClientCount++
    }
  }

  return { count, newClientCount, resignCount, revenue }
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

// Day Ones — mirror /reports/pt exactly so PT Health funnel reconciles
// cell-for-cell with the Day One dashboard. Two non-obvious details:
//   • Filter on `day_one_date` (when the appointment is), NOT
//     `day_one_booking_date` (when it was booked). These are different
//     fields and produce different cohorts.
//   • `day_one_booked` must be non-null + non-empty (any value) — not
//     strictly equal to 'Yes'.
//
//   Set   = total contacts in the filter
//   Show  = day_one_status = 'Completed'
//   Close = Show ∩ day_one_sale = 'Sale'
// Mirror /reports/pt's date-to-ms helper. GHL stores custom-field dates as
// UTC ms but the UI thinks in Pacific calendar dates, so the day boundaries
// need a Pacific offset (+7h PDT, +8h PST) added before they hit Supabase.
// Without this, PT Health was sweeping in ~7h of events from the prior
// Pacific day at the start of the range.
function getPacificOffsetMs(date) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false })
  const utcHour = date.getUTCHours()
  const pacificHour = parseInt(formatter.format(date), 10)
  const diff = (utcHour - pacificHour + 24) % 24
  return diff * 3600000
}

function pacificDateToMs(dateStr, endOfDay = false) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const d = endOfDay
    ? new Date(dateStr + 'T23:59:59.999Z')
    : new Date(dateStr + 'T00:00:00.000Z')
  if (isNaN(d.getTime())) return null
  return (d.getTime() + getPacificOffsetMs(d)).toString()
}

async function computeDayOnes(slug, startDate, endDate) {
  const startMs = pacificDateToMs(startDate, false)
  const endMs = pacificDateToMs(endDate, true)

  // Mirror /reports/pt exactly: same select shape, same filter chain, single
  // .order() query (no manual pagination) so the result set matches even at
  // the Supabase-default row-limit boundary.
  let q = supabaseAdmin
    .from('ghl_contacts_report')
    .select(
      'id, day_one_booked, day_one_booking_date, day_one_date, day_one_status, day_one_sale, day_one_trainer, location_slug'
    )
    .not('day_one_booked', 'is', null)
    .neq('day_one_booked', '')
  if (slug && slug !== 'all') q = q.eq('location_slug', slug)
  if (startMs) q = q.gte('day_one_date', startMs)
  if (endMs) q = q.lte('day_one_date', endMs)

  const { data, error } = await q.order('day_one_date', { ascending: false })
  if (error) throw new Error(error.message)
  const rows = data || []

  // Set = total contacts in result. Show = byStatus['Completed'] (strict,
  // case-sensitive — matches PT report which keys a dictionary on the raw
  // status string). Close = subset of Show with day_one_sale = 'Sale'.
  let show = 0
  let close = 0
  for (const r of rows) {
    if (r.day_one_status !== 'Completed') continue
    show++
    if (r.day_one_sale === 'Sale') close++
  }

  return { set: rows.length, show, close }
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
          acc.deactivated.count += c.deactivated.count
          acc.deactivated.deactivatedRSCount += c.deactivated.deactivatedRSCount
          acc.deactivated.burnedPIFCount += c.deactivated.burnedPIFCount
          acc.deactivated.value += c.deactivated.value
          acc.deactivated.deactivatedRSValue += c.deactivated.deactivatedRSValue
          acc.deactivated.burnedPIFValue += c.deactivated.burnedPIFValue
          return acc
        }, {
          dayOnes: { set: 0, show: 0, close: 0 },
          newPT: { count: 0, newClientCount: 0, resignCount: 0, revenue: 0 },
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
    const startMs = pacificDateToMs(start_date, false)
    const endMs = pacificDateToMs(end_date, true)
    let q = supabaseAdmin
      .from('ghl_contacts_report')
      .select('id, full_name, day_one_booked, day_one_booking_date, day_one_date, day_one_status, day_one_sale, location_slug')
      .not('day_one_booked', 'is', null)
      .neq('day_one_booked', '')
    if (location_slug && location_slug !== 'all') q = q.eq('location_slug', location_slug)
    if (startMs) q = q.gte('day_one_date', startMs)
    if (endMs) q = q.lte('day_one_date', endMs)
    const { data, error } = await q.order('day_one_date', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    const rows = data || []
    const byStatus = {}
    const bySale = {}
    let showCount = 0
    let closeCount = 0
    for (const r of rows) {
      const st = r.day_one_status || 'Unknown'
      byStatus[st] = (byStatus[st] || 0) + 1
      if (r.day_one_status === 'Completed') {
        showCount++
        const sale = r.day_one_sale || 'No Sale'
        bySale[sale] = (bySale[sale] || 0) + 1
        if (r.day_one_sale === 'Sale') closeCount++
      }
    }
    res.json({
      query: { startMs, endMs, location_slug },
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
