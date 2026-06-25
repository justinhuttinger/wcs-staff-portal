'use strict'

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

// Active, non-PIF, PT-only recurring services for one club.
async function fetchActiveRecurringPTServices(clubNumber) {
  const all = await fetchRecurring(clubNumber)
  return all.filter(
    s => s.recurringServiceStatus === 'active' &&
      !((s.recurringTypeDesc || '').includes('Paid in Full')) &&
      isPT(s.serviceItem)
  )
}

module.exports = {
  CLUBS, isPT, normSvc, dateRanges, abcGet, fetchAllRanges, fetchRecurring,
  fetchActiveRecurringPTServices,
}
