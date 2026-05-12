const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

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

// Day Ones — pulled from ghl_contacts_report (same source as the existing
// PT report). Filters by `day_one_booked = 'Yes'` and a date range applied
// to `day_one_booking_date` (epoch milliseconds in GHL custom fields).
async function computeDayOnes(slug, startDate, endDate) {
  const startMs = new Date(startDate + 'T00:00:00').getTime()
  const endMs = new Date(endDate + 'T23:59:59').getTime()
  let q = supabaseAdmin
    .from('ghl_contacts_report')
    .select('day_one_status, day_one_sale, day_one_booking_date, location_slug')
    .eq('day_one_booked', 'Yes')
    .not('day_one_booking_date', 'is', null)
  if (slug && slug !== 'all') q = q.eq('location_slug', slug)
  q = q.gte('day_one_booking_date', String(startMs)).lte('day_one_booking_date', String(endMs))

  const rows = []
  let from = 0
  while (true) {
    const { data, error } = await q.range(from, from + 999)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < 1000) break
    from += 1000
  }

  let completed = 0
  let noShow = 0
  let scheduled = 0
  let sale = 0
  for (const r of rows) {
    const st = String(r.day_one_status || '').toLowerCase()
    if (st === 'completed') completed++
    else if (st === 'no show') noShow++
    else scheduled++
    if (String(r.day_one_sale || '').toLowerCase() === 'yes') sale++
  }

  return { booked: rows.length, completed, noShow, scheduled, sale }
}

// GET /reports/pt-health?start_date=&end_date=&location_slug=
router.get('/', async (req, res) => {
  try {
    if (!ABC_APP_ID || !ABC_APP_KEY) {
      return res.status(500).json({ error: 'ABC API credentials not configured' })
    }
    const { start_date, end_date, location_slug } = req.query
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' })
    }

    let targetClubs = CLUBS
    if (location_slug && location_slug !== 'all') {
      const club = CLUBS.find(c => c.slug === location_slug.toLowerCase())
      if (!club) return res.status(400).json({ error: `Unknown location: ${location_slug}` })
      targetClubs = [club]
    }

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
      acc.dayOnes.booked += c.dayOnes.booked
      acc.dayOnes.completed += c.dayOnes.completed
      acc.dayOnes.noShow += c.dayOnes.noShow
      acc.dayOnes.scheduled += c.dayOnes.scheduled
      acc.dayOnes.sale += c.dayOnes.sale
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
      dayOnes: { booked: 0, completed: 0, noShow: 0, scheduled: 0, sale: 0 },
      newPT: { count: 0, newClientCount: 0, resignCount: 0, revenue: 0 },
      deactivated: {
        count: 0, deactivatedRSCount: 0, burnedPIFCount: 0,
        value: 0, deactivatedRSValue: 0, burnedPIFValue: 0,
      },
    })
    totals.netClients = totals.newPT.count - totals.deactivated.count
    totals.netRevenue = totals.newPT.revenue - totals.deactivated.value

    res.json({
      period: { start: start_date, end: end_date },
      totals,
      byLocation: perClub,
    })
  } catch (err) {
    console.error('[PT Health] Error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
