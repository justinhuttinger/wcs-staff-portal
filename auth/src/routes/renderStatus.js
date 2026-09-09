// Admin-only Render infrastructure status, for the mobile "Render" tile.
//
// Read-only. Answers two questions from a phone: is anything down, and is
// anything eating the workspace bandwidth quota. Prompted by a month where one
// service silently burned the entire 25 GB Pro allowance in about three days
// with no signal until Render emailed the overage notice.
//
// Not a replacement for the Render dashboard: no restart, redeploy, or suspend.

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const cache = require('../services/memoryCache')
const render = require('../services/renderApi')
const {
  indexByResource, buildServiceRow, sortRows, rollup, monthToDateWindow,
} = require('./renderStatusHelpers')

const router = Router()
router.use(authenticate)
// Top of ROLE_HIERARCHY. Deliberately requireRole, not requireReportAccess:
// this exposes infrastructure and log lines, so there is no per-report grant
// that should let a custom role in.
router.use(requireRole('admin'))

// The plan's included bandwidth. Render's API does not expose the cap, so it is
// configuration. Update if the workspace plan changes.
const CAP_GB = Number(process.env.RENDER_BANDWIDTH_CAP_GB || 25)

// A cold miss fans out to roughly 1 + N deploy calls + 5 metrics calls. Serve
// fresh for 5 minutes, then stale-while-revalidate for 10 more so a tap during
// a refresh still paints instantly. wrapSWR also singleflights, so a double-tap
// does not double the upstream fan-out.
const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 10 * 60 * 1000

async function buildOverview() {
  const all = await render.listServices()
  // Cron jobs have no always-on process and report no metrics; keep them in the
  // list for deploy health but they will simply show no usage.
  const services = all.filter(s => s && s.id)
  const active = services.filter(s => s.suspended !== 'suspended')
  const resourceIds = active.map(s => s.id)

  const window = monthToDateWindow()
  // Hourly resolution over a month is ~744 points per series, which the API
  // returns comfortably and keeps the payload small.
  const metricOpts = { resourceIds, ...window, resolutionSeconds: 3600 }

  const [deploys, bandwidthSeries, cpuSeries, memorySeries, limits] = await Promise.all([
    // Deploys are per-service; fan out but tolerate individual failures so one
    // bad service cannot blank the whole screen.
    Promise.all(services.map(async s => {
      try { return [s.id, await render.latestDeploy(s.id)] } catch { return [s.id, null] }
    })),
    resourceIds.length ? render.bandwidth(metricOpts).catch(() => null) : null,
    resourceIds.length ? render.cpu(metricOpts).catch(() => null) : null,
    resourceIds.length ? render.memory(metricOpts).catch(() => null) : null,
    resourceIds.length ? render.limitsSafe(metricOpts) : { cpuLimit: null, memoryLimit: null },
  ])

  const deployById = new Map(deploys)
  const bwById = indexByResource(bandwidthSeries)
  const cpuById = indexByResource(cpuSeries)
  const memById = indexByResource(memorySeries)
  const cpuLimById = indexByResource(limits.cpuLimit)
  const memLimById = indexByResource(limits.memoryLimit)

  const rows = services.map(service => buildServiceRow({
    service,
    deploy: deployById.get(service.id) || null,
    bandwidthSeries: bwById.get(service.id),
    cpuSeries: cpuById.get(service.id),
    memorySeries: memById.get(service.id),
    cpuLimitSeries: cpuLimById.get(service.id),
    memoryLimitSeries: memLimById.get(service.id),
  }))

  const activeRows = rows.filter(r => !r.suspended)
  return {
    // Rollup covers active services only; a suspended service bills nothing.
    rollup: rollup(activeRows, CAP_GB),
    services: sortRows(activeRows),
    suspended: sortRows(rows.filter(r => r.suspended)),
    window,
    fetchedAt: new Date().toISOString(),
  }
}

// GET /render-status — everything the overview screen needs, in one payload.
router.get('/', async (req, res) => {
  if (!render.isConfigured()) {
    return res.status(503).json({
      error: 'Render API not configured',
      detail: 'Set RENDER_API_KEY and RENDER_OWNER_ID on the auth service.',
    })
  }
  try {
    const data = await cache.wrapSWR('render-status:overview', FRESH_MS, STALE_MS, buildOverview)
    res.json(data)
  } catch (err) {
    console.error('[RenderStatus] overview failed:', err.message)
    const status = err.status === 401 || err.status === 403 ? 502 : 500
    res.status(status).json({ error: 'Failed to load Render status', detail: err.message })
  }
})

// GET /render-status/:id/logs — recent error lines for one service, fetched on
// demand when a card is expanded so the overview stays fast.
router.get('/:id/logs', async (req, res) => {
  if (!render.isConfigured()) {
    return res.status(503).json({ error: 'Render API not configured' })
  }
  const { id } = req.params
  if (!/^(srv|crn|dpg|key)-[a-z0-9]+$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid service id' })
  }
  try {
    const data = await cache.wrapSWR(
      `render-status:logs:${id}`,
      60 * 1000,
      4 * 60 * 1000,
      // Last 24h of error lines. Longer windows mostly return old noise.
      () => render.errorLogs(id, {
        limit: 50,
        startTime: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      }),
    )
    res.json({
      logs: (data?.logs || []).map(l => ({
        id: l.id,
        message: l.message,
        timestamp: l.timestamp,
      })),
      hasMore: Boolean(data?.hasMore),
    })
  } catch (err) {
    console.error('[RenderStatus] logs failed:', err.message)
    res.status(500).json({ error: 'Failed to load logs', detail: err.message })
  }
})

module.exports = router
