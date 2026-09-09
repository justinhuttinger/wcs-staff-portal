// Pure shaping/rollup logic for the admin Render status screen.
//
// Split out from renderStatus.js so the arithmetic (unit conversion, month-to-
// date rollup, health state) is testable with node:test without standing up
// express or touching the Render API. Same split as trainerAvailabilityHelpers.

// Render reports each metric series with its own unit string. Bandwidth has
// been observed as "mb"; the API reference gives "GB" as an example. Normalize
// explicitly rather than assuming, so a unit change upstream cannot silently
// inflate or deflate the number by 1000x.
const BYTES_PER = {
  b: 1,
  bytes: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
}

function toBytes(value, unit) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const mult = BYTES_PER[String(unit || '').toLowerCase()]
  // Unknown unit: treat as bytes rather than guessing a multiplier. Better to
  // under-report than to invent a number that looks alarming.
  return n * (mult === undefined ? 1 : mult)
}

const GB = 1024 ** 3

// Total bytes across every datapoint of every series returned for one resource.
// Bandwidth datapoints are per-interval totals, so summing the window is right.
function sumSeriesBytes(series) {
  if (!Array.isArray(series)) return 0
  let total = 0
  for (const s of series) {
    const unit = s?.unit
    for (const v of (s?.values || [])) total += toBytes(v?.value, v?.unit || unit)
  }
  return total
}

// Most recent datapoint value across a metrics series (for gauges like CPU and
// memory, where the latest reading is what matters, not the sum).
function latestValue(series) {
  if (!Array.isArray(series)) return null
  let best = null
  for (const s of series) {
    for (const v of (s?.values || [])) {
      const t = Date.parse(v?.timestamp)
      if (!Number.isFinite(t)) continue
      const n = Number(v?.value)
      if (!Number.isFinite(n)) continue
      if (!best || t > best.t) best = { t, n }
    }
  }
  return best ? best.n : null
}

// Index a metrics response by service id, using the `resource`/`service` label
// Render attaches to each series. Lets one multi-resource metrics call fan back
// out to per-service numbers instead of N calls.
function indexByResource(series) {
  const out = new Map()
  if (!Array.isArray(series)) return out
  for (const s of series) {
    const label = (s?.labels || []).find(l => l?.field === 'resource' || l?.field === 'service')
    const id = label?.value
    if (!id) continue
    if (!out.has(id)) out.set(id, [])
    out.get(id).push(s)
  }
  return out
}

// Deploy statuses that mean "the last deploy did not make it live".
const FAILED_DEPLOY = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled'])
const IN_PROGRESS_DEPLOY = new Set([
  'created', 'queued', 'build_in_progress', 'update_in_progress', 'pre_deploy_in_progress',
])

// One word for how a service is doing, in worst-first order. The mobile screen
// colors the dot from this and sorts unhealthy services to the top.
function serviceState(service, deploy) {
  if (service?.suspended === 'suspended') return 'suspended'
  const status = deploy?.status
  if (FAILED_DEPLOY.has(status)) return 'failed'
  if (IN_PROGRESS_DEPLOY.has(status)) return 'deploying'
  if (status === 'live') return 'live'
  // Static sites and cron jobs may have no deploy in the window; not an error.
  return 'unknown'
}

const STATE_RANK = { failed: 0, deploying: 1, unknown: 2, live: 3, suspended: 4 }

// Percentage helper that refuses to divide by zero or a missing limit.
function pctOf(used, limit) {
  const u = Number(used)
  const l = Number(limit)
  if (!Number.isFinite(u) || !Number.isFinite(l) || l <= 0) return null
  return Math.round((u / l) * 1000) / 10
}

// Build one service row for the mobile list.
function buildServiceRow({ service, deploy, bandwidthSeries, cpuSeries, memorySeries, cpuLimitSeries, memoryLimitSeries }) {
  const bytes = sumSeriesBytes(bandwidthSeries)
  const cpuUsed = latestValue(cpuSeries)
  const memUsed = latestValue(memorySeries)
  const cpuLimit = latestValue(cpuLimitSeries)
  const memLimit = latestValue(memoryLimitSeries)

  return {
    id: service.id,
    name: service.name,
    type: service.type,
    plan: service.serviceDetails?.plan || service.serviceDetails?.buildPlan || null,
    dashboardUrl: service.dashboardUrl,
    url: service.serviceDetails?.url || null,
    suspended: service.suspended === 'suspended',
    state: serviceState(service, deploy),
    deploy: deploy
      ? {
          status: deploy.status,
          finishedAt: deploy.finishedAt || deploy.updatedAt || null,
          createdAt: deploy.createdAt || null,
          commitMessage: deploy.commit?.message?.split('\n')[0] || null,
        }
      : null,
    bandwidthBytes: bytes,
    bandwidthGb: Math.round((bytes / GB) * 100) / 100,
    cpu: { used: cpuUsed, limit: cpuLimit, pct: pctOf(cpuUsed, cpuLimit) },
    memoryBytes: { used: memUsed, limit: memLimit, pct: pctOf(memUsed, memLimit) },
  }
}

// Sort unhealthy first, then by bandwidth desc so the biggest consumer is
// visible without scrolling. That ordering is the whole point of the screen.
function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const r = (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9)
    if (r !== 0) return r
    return (b.bandwidthBytes || 0) - (a.bandwidthBytes || 0)
  })
}

// Account-level bandwidth rollup. Render exposes no owner-level bandwidth
// endpoint, so the total is summed from the per-service series. The plan cap is
// not exposed by the API either and comes from config.
function rollup(rows, capGb) {
  const totalBytes = rows.reduce((sum, r) => sum + (r.bandwidthBytes || 0), 0)
  const totalGb = Math.round((totalBytes / GB) * 100) / 100
  const cap = Number(capGb)
  const pct = Number.isFinite(cap) && cap > 0
    ? Math.round((totalGb / cap) * 1000) / 10
    : null
  let level = 'ok'
  if (pct !== null) {
    if (pct >= 100) level = 'over'
    else if (pct >= 80) level = 'warn'
  }
  return {
    totalGb,
    capGb: Number.isFinite(cap) && cap > 0 ? cap : null,
    pct,
    level,
    overageGb: pct !== null && totalGb > cap ? Math.round((totalGb - cap) * 100) / 100 : 0,
    unhealthy: rows.filter(r => r.state === 'failed').length,
  }
}

// First and last instant of the current calendar month, which is the window
// Render's bandwidth quota resets on.
function monthToDateWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return { startTime: start.toISOString(), endTime: now.toISOString() }
}

module.exports = {
  toBytes,
  sumSeriesBytes,
  latestValue,
  indexByResource,
  serviceState,
  pctOf,
  buildServiceRow,
  sortRows,
  rollup,
  monthToDateWindow,
  GB,
}
