/**
 * Paychex Flex API client with OAuth2 token management.
 * Single API key/secret, per-location company IDs.
 */

let cachedToken = null
let tokenExpiresAt = 0

const TOKEN_URL = 'https://api.paychex.com/auth/oauth/v2/token'
const API_BASE = 'https://api.paychex.com'

/**
 * Get a valid bearer token, refreshing if expired.
 * Tokens last 3600s; we refresh 60s early to avoid edge-case failures.
 */
async function getAccessToken() {
  const now = Date.now()
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken
  }

  const clientId = process.env.PAYCHEX_API_KEY
  const clientSecret = process.env.PAYCHEX_API_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('PAYCHEX_API_KEY and PAYCHEX_API_SECRET must be set')
  }

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Paychex token error ${resp.status}: ${text}`)
  }

  const data = await resp.json()
  cachedToken = data.access_token
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000

  return cachedToken
}

/**
 * Make an authenticated GET request to Paychex API.
 */
async function paychexGet(path, params = {}) {
  const token = await getAccessToken()
  const qs = new URLSearchParams(params).toString()
  const url = API_BASE + path + (qs ? '?' + qs : '')

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Paychex API error ${resp.status}: ${text}`)
  }

  return resp.json()
}

/**
 * Make an authenticated POST request to Paychex API (for document uploads).
 */
async function paychexPost(path, body, contentType = 'application/json') {
  const token = await getAccessToken()

  const headers = {
    Authorization: `Bearer ${token}`,
  }

  if (contentType === 'application/pdf') {
    headers['Content-Type'] = 'application/pdf'
  } else {
    headers['Content-Type'] = 'application/json'
  }

  const resp = await fetch(API_BASE + path, {
    method: 'POST',
    headers,
    body,
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Paychex API error ${resp.status}: ${text}`)
  }

  return resp.json()
}

/**
 * List all companies the API key has access to.
 */
async function getCompanies() {
  const companies = []
  let offset = 0
  const limit = 100

  while (true) {
    const data = await paychexGet('/companies', { offset, limit })
    const items = data.content || []
    companies.push(...items)

    const pagination = data.metadata?.pagination
    if (!pagination || companies.length >= pagination.itemCount) break
    offset += limit
  }

  return companies
}

/**
 * Get all workers for a company, handling pagination.
 *
 * Paychex's /companies/{id}/workers endpoint does not support a status
 * filter as a query param — callers should filter the returned list by
 * `currentStatus.statusType` instead.
 */
async function getWorkers(companyId) {
  const workers = []
  let offset = 0
  const limit = 100

  while (true) {
    const data = await paychexGet(`/companies/${companyId}/workers`, { offset, limit })
    const items = data.content || []
    workers.push(...items)

    const pagination = data.metadata?.pagination
    if (!pagination || workers.length >= pagination.itemCount) break
    offset += limit
  }

  return workers
}

/**
 * Get documents for a specific worker.
 */
async function getWorkerDocuments(workerId) {
  const data = await paychexGet(`/workers/${workerId}/documents`)
  return data.content || data || []
}

/**
 * Get a specific document for a worker.
 */
async function getWorkerDocument(workerId, documentId) {
  return paychexGet(`/workers/${workerId}/documents/${documentId}`)
}

// Paychex document category ids are the same at every club
// (GET /companies/{id}/documentcategories). HR documents file under Performance.
const DOC_CATEGORY_PERFORMANCE = '15'

/**
 * Upload a document to a worker's profile.
 *
 * Paychex only accepts multipart/form-data here: a `file` part and a JSON
 * `metadata` part. A raw-bytes POST is refused with 415 (API-18), which is
 * what this function sent until October 2026, so nothing reached Paychex.
 *
 * Documents are filed hidden from the worker (workerVisible: false): these are
 * write-ups and manager uploads, not forms the employee should see in Flex.
 *
 * Returns { docId } — Paychex's id for the new document.
 */
async function uploadWorkerDocument(workerId, buffer, fileName, contentType = 'application/pdf') {
  const token = await getAccessToken()

  const form = new FormData()
  form.append('file', new Blob([buffer], { type: contentType }), fileName)
  form.append('metadata', new Blob(
    [JSON.stringify({ category: DOC_CATEGORY_PERFORMANCE, workerVisible: false })],
    { type: 'application/json' },
  ))

  // No Content-Type header: fetch sets the multipart boundary itself.
  const resp = await fetch(`${API_BASE}/workers/${workerId}/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: form,
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Paychex upload error ${resp.status}: ${text}`)
  }

  const data = await resp.json()
  return { docId: data?.content?.[0]?.docId || null }
}

module.exports = {
  getAccessToken,
  getCompanies,
  getWorkers,
  getWorkerDocuments,
  getWorkerDocument,
  uploadWorkerDocument,
}
