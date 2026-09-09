// Thin read-only client for the Render REST API (https://api.render.com/v1).
//
// Used by routes/renderStatus.js to power the admin-only mobile "Render" screen.
// Read-only by design: this module deliberately exposes no way to restart,
// redeploy, suspend, or otherwise mutate a service. Adding one would put a prod
// control surface on a phone, which is explicitly out of scope.
//
// Auth is a workspace API key (RENDER_API_KEY). RENDER_OWNER_ID is the workspace
// id (tea-…) and is required by the /logs endpoint.

const BASE_URL = process.env.RENDER_BASE_URL || 'https://api.render.com/v1'
const TIMEOUT_MS = 15000

function apiKey() {
  const key = process.env.RENDER_API_KEY
  if (!key) throw new Error('RENDER_API_KEY is not set')
  return key
}

function ownerId() {
  const id = process.env.RENDER_OWNER_ID
  if (!id) throw new Error('RENDER_OWNER_ID is not set')
  return id
}

function isConfigured() {
  return Boolean(process.env.RENDER_API_KEY && process.env.RENDER_OWNER_ID)
}

// One GET against the Render API. Throws on non-2xx with the status attached so
// callers can distinguish "not configured / bad key" (401) from a transient 5xx.
async function get(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    // Render takes repeated keys for multi-valued params (resource, level).
    if (Array.isArray(v)) v.forEach(item => url.searchParams.append(k, item))
    else url.searchParams.set(k, String(v))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey()}`, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = new Error(`Render API ${res.status} on ${path}: ${body.slice(0, 200)}`)
      err.status = res.status
      throw err
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// GET /services — paged. Render wraps each element as { service, cursor }, so
// unwrap to plain service objects. includePreviews defaults to true upstream;
// we force it off because preview instances are noise on a status screen.
async function listServices() {
  const out = []
  let cursor
  // Bounded loop: the workspace has ~20 services. The cap stops a malformed
  // cursor from spinning forever.
  for (let page = 0; page < 10; page++) {
    const rows = await get('/services', { limit: 100, cursor, includePreviews: false })
    if (!Array.isArray(rows) || rows.length === 0) break
    for (const row of rows) if (row?.service) out.push(row.service)
    cursor = rows[rows.length - 1]?.cursor
    if (!cursor || rows.length < 100) break
  }
  return out
}

// GET /services/:id/deploys?limit=1 — the most recent deploy, or null.
async function latestDeploy(serviceId) {
  const rows = await get(`/services/${serviceId}/deploys`, { limit: 1 })
  return Array.isArray(rows) && rows[0]?.deploy ? rows[0].deploy : null
}

// Metrics endpoints all share a shape: an array of time series, each
// { labels: [{field, value}], values: [{timestamp, value}], unit }.
function metrics(path, { resourceIds, startTime, endTime, resolutionSeconds }) {
  return get(path, {
    resource: resourceIds,
    startTime,
    endTime,
    resolutionSeconds,
  })
}

const bandwidth = opts => metrics('/metrics/bandwidth', opts)
const cpu = opts => metrics('/metrics/cpu', opts)
const memory = opts => metrics('/metrics/memory', opts)

// Plan limits live on separate endpoints that are not covered by the public API
// reference. They are best-effort: if a limit call fails we still render usage,
// just without a "% of plan" figure. Never let a missing limit fail the screen.
async function limitsSafe(opts) {
  const settle = async fn => { try { return await fn() } catch { return null } }
  const [cpuLimit, memoryLimit] = await Promise.all([
    settle(() => metrics('/metrics/cpu-limit', opts)),
    settle(() => metrics('/metrics/memory-limit', opts)),
  ])
  return { cpuLimit, memoryLimit }
}

// GET /logs — error-level lines for one service. ownerId is required upstream.
async function errorLogs(serviceId, { limit = 50, startTime } = {}) {
  return get('/logs', {
    ownerId: ownerId(),
    resource: [serviceId],
    level: ['error'],
    limit,
    startTime,
    direction: 'backward',
  })
}

module.exports = {
  isConfigured,
  listServices,
  latestDeploy,
  bandwidth,
  cpu,
  memory,
  limitsSafe,
  errorLogs,
}
