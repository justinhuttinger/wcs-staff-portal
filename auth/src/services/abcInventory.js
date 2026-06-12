// ABC Financial fetchers for the Inventory tool:
//   GET /{club}/clubs/items            — the club's sale-item catalog
//   GET /{club}/clubs/transactions/pos — POS sale transactions
//
// All ABC values come back as strings — numeric casting happens here so the
// sync layer works with real numbers.

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const ABC_APP_ID = process.env.ABC_APP_ID
const ABC_APP_KEY = process.env.ABC_APP_KEY
const MAX_PAGES = 100

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function abcHeaders() {
  if (!ABC_APP_ID || !ABC_APP_KEY) throw new Error('ABC_APP_ID and ABC_APP_KEY must be set')
  return { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' }
}

// === Pacific-disguised UTC convention ======================================
// ABC reads timestamp range params as Pacific local time, not UTC (see
// ghl-sync/src/abc/checkins.js for the long-form explanation). We format
// range boundaries as Pacific wall-clock strings.

function pacificNowAsUtc(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (t) => parts.find((p) => p.type === t)?.value
  let hour = get('hour')
  if (hour === '24') hour = '00'
  return new Date(`${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}.000Z`)
}

// d is Pacific-disguised (its UTC digits are the Pacific wall clock).
function fmtAbcTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
    ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds())
  )
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

async function abcGet(url, params) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const res = await fetch(url + (qs.toString() ? '?' + qs.toString() : ''), {
    headers: abcHeaders(),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ABC ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

// Walk status.nextPage like the members sync does — ABC echoes the page back
// and returns '' when there is no next page.
function nextPageOf(data, currentPage) {
  const nextPage = data?.status?.nextPage
  if (!nextPage || nextPage === '' || nextPage === String(currentPage)) return null
  const parsed = parseInt(nextPage)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Fetch the full sale-item catalog for a club.
 * @returns {Promise<Array>} raw ABC items (saleItemId, itemName, itemUpc, ...)
 */
async function fetchCatalogItems(clubNumber) {
  const all = []
  let page = 1
  while (page && page <= MAX_PAGES) {
    const data = await abcGet(`${ABC_BASE_URL}/${clubNumber}/clubs/items`, { page, size: 500 })
    const items = data.items || []
    if (!Array.isArray(items) || items.length === 0) break
    all.push(...items)
    page = nextPageOf(data, page)
    if (page) await sleep(400)
  }
  return all
}

/**
 * Fetch POS transactions for a club in a real-UTC window. The window is
 * converted to Pacific wall-clock for ABC's transactionTimestampRange.
 * Returns flat transactions: { transactionId, transactionTimestamp, memberId,
 * employeeId, receiptNumber, stationName, isReturn, items: [...] }.
 */
async function fetchPosTransactions(clubNumber, fromUtc, toUtc = new Date()) {
  const range = `${fmtAbcTimestamp(pacificNowAsUtc(fromUtc))},${fmtAbcTimestamp(pacificNowAsUtc(toUtc))}`
  const all = []
  let page = 1
  while (page && page <= MAX_PAGES) {
    const data = await abcGet(`${ABC_BASE_URL}/${clubNumber}/clubs/transactions/pos`, {
      transactionTimestampRange: range, page, size: 200,
    })
    // Response nests transactions under clubs[].transactions[]
    const clubs = data.clubs || []
    let count = 0
    for (const club of clubs) {
      for (const t of club.transactions || []) {
        count++
        const rawItems = t.items?.item || []
        all.push({
          transactionId: t.transactionId,
          transactionTimestamp: t.transactionTimestamp,
          memberId: t.memberId || null,
          employeeId: t.employeeId || null,
          receiptNumber: t.receiptNumber || null,
          stationName: t.stationName || null,
          isReturn: t.return === 'true' || t.return === true,
          items: (Array.isArray(rawItems) ? rawItems : [rawItems]).filter(Boolean).map(it => ({
            itemId: it.itemId || null,
            name: it.name || null,
            upc: it.upc || null,
            inventoryType: it.inventoryType || null,
            profitCenter: it.profitCenter || null,
            catalog: it.catalog || null,
            quantity: num(it.quantity) ?? 1,
            unitPrice: num(it.unitPrice),
            subtotal: num(it.subtotal),
            tax: num(it.tax),
          })),
          raw: t,
        })
      }
    }
    if (count === 0) break
    page = nextPageOf(data, page)
    if (page) await sleep(400)
  }
  return all
}

module.exports = { fetchCatalogItems, fetchPosTransactions, num }
