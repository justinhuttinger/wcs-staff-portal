const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

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
router.use(requireRole('lead'))

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

// Pick "commission employee" from whichever ABC field the response carries.
// ABC has historically used `paymentEmployee*` and `salesPersonFirstName/LastName`
// interchangeably on sale entries; some tenants return both, some only one.
function commissionEmployee(s) {
  const tryNames = [
    [s.paymentEmployeeFirstName, s.paymentEmployeeLastName],
    [s.salesPersonFirstName, s.salesPersonLastName],
    [s.salesPersonNameFirst, s.salesPersonNameLast],
    [s.commissionEmployeeFirstName, s.commissionEmployeeLastName],
  ]
  for (const [first, last] of tryNames) {
    const f = (first || '').trim()
    const l = (last || '').trim()
    if (f || l) return `${f} ${l}`.trim()
  }
  return ''
}

function serviceEmployee(s) {
  const f = (s.serviceEmployeeFirstName || '').trim()
  const l = (s.serviceEmployeeLastName || '').trim()
  return `${f} ${l}`.trim()
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
// name with frequency or pack count ("PT 60MIN 3XWEEK", "PT 30MIN 10 PACK")
// lives on the recurringServicePlan entity, fetched separately.
const planCache = new Map()
const PLAN_CACHE_TTL = 60 * 60 * 1000 // 1h

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
    console.warn(`[PT New Clients] Plan fetch failed for ${planId}@${clubNumber}:`, e.message)
    return null
  }
}

function fallbackPackageName(s) {
  // No plan-detail name — synthesize something readable. For PIF entries the
  // recurring services payload sometimes encodes the pack count in totalPeriods.
  const base = s.serviceItem || 'Unknown'
  if (isPIF(s) && s.totalPeriods) {
    return `${base} · ${s.totalPeriods} Pack`
  }
  return base
}

async function buildClub(club, startDate, endDate) {
  // 90-day lookback before the window start
  const lookbackStart = new Date(startDate + 'T00:00:00')
  lookbackStart.setDate(lookbackStart.getDate() - 90)
  const lookbackStartISO = fmtDate(lookbackStart)

  const allSales = await fetchPTSales(club.clubNumber, lookbackStartISO, endDate)

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
  const planNames = new Map()
  const uniquePlans = [...windowPlanIds]
  for (let i = 0; i < uniquePlans.length; i += 5) {
    const batch = uniquePlans.slice(i, i + 5)
    const results = await Promise.all(batch.map(pid => fetchPlanName(club.clubNumber, pid)))
    results.forEach((name, idx) => {
      if (name) planNames.set(batch[idx], name)
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
      const pkg = (pid && planNames.get(String(pid))) || fallbackPackageName(raw)

      rows.push({
        memberId,
        memberName: memberName(raw),
        package: pkg,
        type: isPIF(raw) ? 'PIF' : 'RS',
        price: parsePrice(raw),
        commissionEmployee: commissionEmployee(raw),
        serviceEmployee: serviceEmployee(raw),
        saleDate,
        classification: hasPrior ? 'Resign' : 'New Client',
        clubName: club.name,
        locationSlug: club.slug,
      })
    }
  }

  return rows
}

// GET /reports/pt-new-clients?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&location_slug=salem|all
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
    if (start_date > end_date) {
      return res.status(400).json({ error: 'start_date must be on or before end_date' })
    }

    let targetClubs = CLUBS
    if (location_slug && location_slug !== 'all') {
      const club = CLUBS.find(c => c.slug === location_slug.toLowerCase())
      if (!club) return res.status(400).json({ error: `Unknown location: ${location_slug}` })
      targetClubs = [club]
    }

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

    res.json({
      rows,
      summary,
      errors: errors.length ? errors : undefined,
    })
  } catch (err) {
    console.error('[PT New Clients] Error:', err.message)
    res.status(500).json({ error: err.message })
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
