const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

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

function normSvc(name) {
  const c = (name || '').trim().toUpperCase()
  if (['PT 60MIN', 'PT60 MIN', 'PT 60 MIN', 'PT60MIN', 'PT60'].includes(c)) return 'PT60'
  return name
}

// Parse the per-week frequency out of a plan name like "GROUP TRAINING 1XWEEK"
// or "PT 60MIN 3X/WEEK" → "1x/Week" / "3x/Week". Returns null if no match.
function parseFrequency(planName) {
  if (!planName) return null
  const m = String(planName).match(/(\d+)\s*X\s*\/?\s*(WEEK|WK)\b/i)
  if (!m) return null
  return `${m[1]}x/Week`
}

// Module-level cache of plan details, keyed by `${clubNumber}:${planId}`
const planCache = new Map()
const PLAN_CACHE_TTL = 60 * 60 * 1000 // 1 hour

function dateRanges() {
  const ranges = []
  let start = new Date('2020-01-01')
  const today = new Date()
  while (start < today) {
    const end = new Date(start)
    end.setDate(end.getDate() + 179)
    if (end > today) end.setTime(today.getTime())
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    ranges.push(`${fmt(start)},${fmt(end)}`)
    start.setDate(start.getDate() + 180)
  }
  return ranges
}

async function abcGet(path, params = {}) {
  // Build query string manually to avoid URLSearchParams encoding commas
  // ABC Financial expects literal commas in date ranges (e.g. 2020-01-01,2020-06-29)
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

async function fetchPlanDetail(clubNumber, planId) {
  if (!planId) return null
  const cacheKey = `${clubNumber}:${planId}`
  const hit = planCache.get(cacheKey)
  if (hit && (Date.now() - hit.ts) < PLAN_CACHE_TTL) return hit.data
  try {
    const data = await abcGet(`/${clubNumber}/clubs/recurringserviceplans/${planId}`)
    const detail = data?.recurringServicePlanDetail || {}
    const result = {
      planId,
      planName: detail.recurringServicePlanName || null,
      serviceQuantity: detail.billing?.serviceQuantity || null,
      billingFrequency: detail.billing?.billingFrequency || null,
      useFrequency: parseFrequency(detail.recurringServicePlanName),
    }
    planCache.set(cacheKey, { data: result, ts: Date.now() })
    return result
  } catch (e) {
    console.warn(`[PT Roster] Plan fetch failed for ${planId} at club ${clubNumber}:`, e.message)
    return null
  }
}

async function fetchAllRanges(clubNumber, paramName) {
  const seen = new Set()
  const all = []
  for (const range of dateRanges()) {
    let page = 1
    while (page <= 10) {
      const data = await abcGet(`/${clubNumber}/members/recurringservices`, {
        [paramName]: range, size: 200, page,
      })
      const svcs = data.recurringServices || []
      for (const s of svcs) {
        if (seen.has(s.recurringServiceId)) continue
        seen.add(s.recurringServiceId)
        if (!isPT(s.serviceItem)) continue
        all.push(s)
      }
      if (svcs.length < 200) break
      page++
    }
  }
  return all
}

async function fetchRecurring(clubNumber) {
  const seen = new Set()
  const all = []
  const [saleSvcs, modSvcs] = await Promise.all([
    fetchAllRanges(clubNumber, 'saleTimestampRange'),
    fetchAllRanges(clubNumber, 'lastModifiedTimestampRange'),
  ])
  for (const s of saleSvcs.concat(modSvcs)) {
    if (seen.has(s.recurringServiceId)) continue
    seen.add(s.recurringServiceId)
    all.push(s)
  }
  return all
}

async function fetchLatestPIF(clubNumber, memberId) {
  try {
    const data = await abcGet(`/${clubNumber}/members/${memberId}/services/purchasehistory`, {
      purchaseDateRange: '2020-01-01',
    })
    const packs = (data.serviceSummaries || []).filter(s =>
      isPT(s.serviceName) && parseInt(s.available || '0', 10) > 0
    )
    if (!packs.length) return null
    packs.sort((a, b) => new Date(b.purchaseDate || 0) - new Date(a.purchaseDate || 0))
    const p = packs[0]
    const price = parseFloat((p.totalPrice || '').replace(/[$,]/g, '')) || 0
    return {
      serviceItem: normSvc(p.serviceName),
      sessionsLeft: parseInt(p.available || '0', 10),
      totalBought: parseInt(p.purchased || '0', 10),
      purchasePrice: price,
    }
  } catch (e) {
    console.warn(`[PT Roster] PIF fetch failed for member ${memberId} at club ${clubNumber}:`, e.message)
    return null
  }
}

async function buildClients(clubNumber, clubName) {
  const allSvcs = await fetchRecurring(clubNumber)

  // Collect unique recurring service plan IDs from active services so we can
  // fetch their plan details (the "1XWEEK"/"3XWEEK" suffix lives on the plan,
  // not the recurring service entry).
  const planIds = new Set()
  for (const s of allSvcs) {
    if (s.recurringServiceStatus !== 'active') continue
    if ((s.recurringTypeDesc || '').includes('Paid in Full')) continue
    const pid = s.recurringServicePlanId || s.servicePlanId
    if (pid) planIds.add(pid)
  }

  const planMap = new Map()
  const uniquePlans = [...planIds]
  for (let i = 0; i < uniquePlans.length; i += 5) {
    const batch = uniquePlans.slice(i, i + 5)
    const results = await Promise.all(batch.map(pid => fetchPlanDetail(clubNumber, pid)))
    results.forEach((r, idx) => { if (r) planMap.set(batch[idx], r) })
    if (i + 5 < uniquePlans.length) await new Promise(r => setTimeout(r, 100))
  }

  // Build recurring clients
  const recMap = {}
  for (const s of allSvcs) {
    if (s.recurringServiceStatus !== 'active') continue
    if ((s.recurringTypeDesc || '').includes('Paid in Full')) continue
    if (!recMap[s.memberId]) {
      recMap[s.memberId] = {
        memberId: s.memberId,
        name: `${(s.memberFirstName || '').trim()} ${(s.memberLastName || '').trim()}`.trim() || 'Unknown',
        trainer: ((s.serviceEmployeeFirstName || '').trim() + ' ' + (s.serviceEmployeeLastName || '').trim()).trim() || 'Unassigned',
        clientType: 'recurring',
        clubName,
        services: [],
        latestDate: null,
        monthlyRevenue: 0,
      }
    }
    const e = recMap[s.memberId]
    const sd = s.recurringServiceDates?.saleDate
    const price = parseFloat(s.invoiceTotal || '0') || 0
    e.monthlyRevenue += price
    const pid = s.recurringServicePlanId || s.servicePlanId
    const plan = pid ? planMap.get(pid) : null
    e.services.push({
      serviceItem: normSvc(s.serviceItem),
      frequency: s.frequency,
      totalPeriods: s.totalPeriods,
      nextBillingDate: s.recurringServiceDates?.nextBillingDate,
      invoiceTotal: price,
      planName: plan?.planName || null,
      useFrequency: plan?.useFrequency || null,
    })
    if (sd && (!e.latestDate || sd > e.latestDate)) {
      e.latestDate = sd
      e.trainer = ((s.serviceEmployeeFirstName || '').trim() + ' ' + (s.serviceEmployeeLastName || '').trim()).trim() || 'Unassigned'
    }
  }
  const recClients = Object.values(recMap)
  const recIds = new Set(Object.keys(recMap))


  // Build PIF candidates
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 6)
  const pifMap = {}
  for (const s of allSvcs) {
    if (recIds.has(s.memberId)) continue
    if (!(s.recurringTypeDesc || '').includes('Paid in Full')) continue
    const sd = s.recurringServiceDates?.saleDate
    if (!sd || new Date(sd) < cutoff) continue
    if (!pifMap[s.memberId]) {
      pifMap[s.memberId] = {
        memberId: s.memberId,
        name: `${(s.memberFirstName || '').trim()} ${(s.memberLastName || '').trim()}`.trim() || 'Unknown',
        trainer: ((s.serviceEmployeeFirstName || '').trim() + ' ' + (s.serviceEmployeeLastName || '').trim()).trim() || 'Unassigned',
        latestDate: sd,
      }
    } else if (sd > pifMap[s.memberId].latestDate) {
      pifMap[s.memberId].latestDate = sd
      pifMap[s.memberId].trainer = ((s.serviceEmployeeFirstName || '').trim() + ' ' + (s.serviceEmployeeLastName || '').trim()).trim() || 'Unassigned'
    }
  }

  // Fetch PIF details in batches of 5 to avoid overwhelming ABC API
  const pifCandidates = Object.values(pifMap)
  const pifResults = []
  for (let i = 0; i < pifCandidates.length; i += 5) {
    const batch = pifCandidates.slice(i, i + 5)
    const batchResults = await Promise.all(
      batch.map(async c => {
        const pack = await fetchLatestPIF(clubNumber, c.memberId)
        if (!pack) return null
        return {
          memberId: c.memberId,
          name: c.name,
          trainer: c.trainer,
          clientType: 'pif',
          clubName,
          service: pack,
        }
      })
    )
    pifResults.push(...batchResults.filter(Boolean))
    if (i + 5 < pifCandidates.length) await new Promise(r => setTimeout(r, 200))
  }
  console.log(`[PT Roster] ${clubName}: ${recClients.length} recurring, ${pifCandidates.length} PIF candidates, ${pifResults.length} PIF with sessions`)

  return recClients.concat(pifResults)
}

// GET /reports/pt-roster/debug-sample?location_slug=salem
// Admin-only. Returns the first 3 raw recurring service objects from ABC for one club,
// so we can inspect which fields encode the per-week service frequency.
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

    const all = await fetchRecurring(club.clubNumber)
    const samples = all.filter(s => s.recurringServiceStatus === 'active').slice(0, 3)
    res.json({ club: club.name, count: all.length, samples })
  } catch (err) {
    console.error('[PT Roster Debug] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /reports/pt-roster?location_slug=salem (or "all")
router.get('/', async (req, res) => {
  try {
    if (!ABC_APP_ID || !ABC_APP_KEY) {
      return res.status(500).json({ error: 'ABC API credentials not configured' })
    }

    const { location_slug } = req.query
    let targetClubs = CLUBS

    if (location_slug && location_slug !== 'all') {
      const club = CLUBS.find(c => c.slug === location_slug.toLowerCase())
      if (!club) return res.status(400).json({ error: `Unknown location: ${location_slug}` })
      targetClubs = [club]
    }

    // Fetch all locations in parallel
    const results = await Promise.allSettled(
      targetClubs.map(club => buildClients(club.clubNumber, club.name))
    )

    const allClients = []
    const errors = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        allClients.push(...r.value)
      } else {
        errors.push({ club: targetClubs[i].name, error: r.reason?.message || 'Unknown error' })
      }
    })

    // Summary stats
    const recurring = allClients.filter(c => c.clientType === 'recurring')
    const pif = allClients.filter(c => c.clientType === 'pif')
    const monthlyRevenue = recurring.reduce((s, c) => s + (c.monthlyRevenue || 0), 0)
    const pifRevenue = pif.reduce((s, c) => s + (c.service?.purchasePrice || 0), 0)

    res.json({
      clients: allClients,
      summary: {
        totalClients: allClients.length,
        recurring: recurring.length,
        pif: pif.length,
        monthlyRevenue,
        pifRevenue,
      },
      errors: errors.length ? errors : undefined,
    })
  } catch (err) {
    console.error('[PT Roster] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
