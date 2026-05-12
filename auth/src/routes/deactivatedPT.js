const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

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

// Pull whichever deactivation date ABC encodes on the row. Different tenants
// surface different field names; first non-empty wins.
function deactivationDate(s) {
  const dates = s.recurringServiceDates || {}
  const candidates = [
    dates.cancellationDate,
    dates.terminationDate,
    dates.endDate,
    dates.deactivationDate,
    dates.cancelDate,
    s.lastModifiedTimestamp,
  ]
  for (const c of candidates) {
    if (c) return String(c).slice(0, 10)
  }
  return ''
}

function parsePrice(s) {
  const raw = s.invoiceTotal ?? s.totalPrice ?? '0'
  const cleaned = String(raw).replace(/[$,]/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

function rsPackageName(s) {
  const name = s.recurringServicePlanName || s.serviceItem || 'Unknown'
  return name.replace(/\bSINGLE\b/gi, 'PT60')
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

  // Bucket each member's full footprint we saw in this window so we can
  // answer "do they have an active RS?" without a second roundtrip.
  const memberFootprint = new Map() // memberId -> { activeRS, anyPIF, latestPIF, latestRS }
  for (const s of allSvcs) {
    const f = memberFootprint.get(s.memberId) || {
      activeRS: false, anyPIF: false, latestPIF: null, latestRS: null,
    }
    if (isPIF(s)) {
      f.anyPIF = true
      const sd = s.recurringServiceDates?.saleDate
      if (!f.latestPIF || (sd && sd > (f.latestPIF.recurringServiceDates?.saleDate || ''))) {
        f.latestPIF = s
      }
    } else {
      if (String(s.recurringServiceStatus || '').toLowerCase() === 'active') f.activeRS = true
      const sd = s.recurringServiceDates?.saleDate
      if (!f.latestRS || (sd && sd > (f.latestRS.recurringServiceDates?.saleDate || ''))) {
        f.latestRS = s
      }
    }
    memberFootprint.set(s.memberId, f)
  }

  const rows = []

  // --- Deactivated RS rows ---------------------------------------------------
  for (const s of allSvcs) {
    if (isPIF(s)) continue
    const status = String(s.recurringServiceStatus || '').toLowerCase()
    if (status === 'active' || !status) continue
    rows.push({
      type: 'Deactivated RS',
      memberId: s.memberId,
      memberName: memberName(s),
      package: rsPackageName(s),
      status: s.recurringServiceStatus || 'Unknown',
      serviceEmployee: serviceEmployee(s),
      saleDate: s.recurringServiceDates?.saleDate?.slice(0, 10) || '',
      changedDate: deactivationDate(s),
      price: parsePrice(s),
      sessionsLeft: null,
      sessionsBought: null,
      clubName: club.name,
      locationSlug: club.slug,
    })
  }

  // --- PIF Burned rows -------------------------------------------------------
  // For each member who has any PIF activity in the window, fetch purchase
  // history (cached, batched 5-at-a-time, 200ms pause).
  const pifMembers = [...memberFootprint.entries()]
    .filter(([, f]) => f.anyPIF && !f.activeRS)
    .map(([memberId]) => memberId)

  for (let i = 0; i < pifMembers.length; i += 5) {
    const batch = pifMembers.slice(i, i + 5)
    await Promise.all(batch.map(async memberId => {
      const history = await fetchPTPurchaseHistory(club.clubNumber, memberId)
      if (!history.length) return
      const hasSessionsLeft = history.some(h => parseInt(h.available || '0', 10) > 0)
      if (hasSessionsLeft) return
      // Member is PIF-burned. Pick the freshest PIF for display context.
      const sorted = [...history].sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''))
      const latest = sorted[0]
      const footprint = memberFootprint.get(memberId)
      const latestPIFRow = footprint?.latestPIF
      const totalBought = parseInt(latest.purchased || '0', 10)
      rows.push({
        type: 'PIF Burned',
        memberId,
        memberName: latestPIFRow ? memberName(latestPIFRow) : (`${(latest.memberFirstName || '').trim()} ${(latest.memberLastName || '').trim()}`.trim() || 'Unknown'),
        package: totalBought > 0 ? `${totalBought} PACK` : 'PACK',
        status: 'Exhausted',
        serviceEmployee: latestPIFRow ? serviceEmployee(latestPIFRow) : '',
        saleDate: latest.purchaseDate?.slice(0, 10) || '',
        changedDate: latestPIFRow?.lastModifiedTimestamp?.slice(0, 10) || '',
        price: parseFloat(String(latest.totalPrice || '0').replace(/[$,]/g, '')) || 0,
        sessionsLeft: 0,
        sessionsBought: totalBought,
        clubName: club.name,
        locationSlug: club.slug,
      })
    }))
    if (i + 5 < pifMembers.length) await new Promise(r => setTimeout(r, 200))
  }

  return rows
}

// GET /reports/deactivated-pt?start_date=&end_date=&location_slug=
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

    rows.sort((a, b) =>
      (b.changedDate || '').localeCompare(a.changedDate || '') ||
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

    res.json({
      rows,
      summary,
      errors: errors.length ? errors : undefined,
    })
  } catch (err) {
    console.error('[Deactivated PT] Error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
