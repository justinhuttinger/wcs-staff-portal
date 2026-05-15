// Cache warmer for the slow report endpoints. Each cached route exports a
// `warmCache(query)` function that re-enters wrapSWR with the same key the
// route handler uses; this service iterates the (route × location) matrix
// and calls each warmCache on a schedule so cached entries never go fully
// cold during business hours.
//
// Scheduling: 30s startup grace, then every 90s. The 90s cadence matches
// the shortest fresh window minus a 30s buffer (2-min fresh - 30s), so the
// fastest-decaying entries get refreshed before they exit the stale window
// in steady state. Calls into fresh entries are essentially free (a single
// Map lookup); only stale or expired entries trigger upstream fetches.
//
// Business-hours gate: skip warmup outside 6am–10pm Pacific to avoid
// burning ABC API quota overnight when nobody is looking at reports anyway.

const STARTUP_GRACE_MS = 30 * 1000
const CYCLE_INTERVAL_MS = 90 * 1000

const LOCATIONS = ['all', 'salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']

function fmtDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// Return YYYY-MM-DD for "today" and the first of the current month — the
// date range that the report front-ends default to ("This month").
function thisMonthRange() {
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  return { start_date: fmtDate(start), end_date: fmtDate(today) }
}

function pacificHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
  }).formatToParts(now)
  return parseInt(parts.find(p => p.type === 'hour').value, 10)
}

// 6am inclusive through 10pm exclusive Pacific time. Outside this window,
// warmup is suspended so we don't hammer ABC overnight.
function isPacificBusinessHours(now = new Date()) {
  const h = pacificHour(now)
  return h >= 6 && h < 22
}

// Routes register themselves here. Each entry: { name, fn, params }.
//   name   - human-readable label, used in logs and /admin/cache/stats
//   fn     - the route's exported warmCache(query) function
//   params - function(loc, range) returning the query object to warm
const tasks = []

function registerWarmer(name, fn, paramBuilder) {
  if (typeof fn !== 'function') {
    console.warn(`[cacheWarmer] skipping ${name}: warmCache not a function (route may be unmigrated)`)
    return
  }
  tasks.push({ name, fn, paramBuilder })
}

async function runCycle({ force = false, log = console } = {}) {
  if (!force && !isPacificBusinessHours()) {
    return { skipped: 'outside-business-hours', warmed: 0, failed: 0 }
  }
  const range = thisMonthRange()
  let warmed = 0
  let failed = 0
  for (const task of tasks) {
    for (const loc of LOCATIONS) {
      try {
        const query = task.paramBuilder(loc, range)
        await task.fn(query)
        warmed++
      } catch (err) {
        failed++
        log.warn(`[cacheWarmer] ${task.name}/${loc}: ${err.message || err}`)
      }
    }
  }
  log.log(`[cacheWarmer] cycle complete: ${warmed} ok, ${failed} failed`)
  return { warmed, failed }
}

let intervalHandle = null
let startupTimer = null

function start({ log = console } = {}) {
  if (intervalHandle || startupTimer) return // idempotent
  if (tasks.length === 0) {
    log.warn('[cacheWarmer] no warmup tasks registered; warmer is a no-op')
  }
  startupTimer = setTimeout(async () => {
    startupTimer = null
    await runCycle({ log }).catch(err => log.error('[cacheWarmer] startup cycle failed:', err))
    intervalHandle = setInterval(() => {
      runCycle({ log }).catch(err => log.error('[cacheWarmer] cycle failed:', err))
    }, CYCLE_INTERVAL_MS)
    intervalHandle.unref?.() // don't keep the process alive just for this
  }, STARTUP_GRACE_MS)
  startupTimer.unref?.()
}

function stop() {
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null }
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null }
}

// Wire each cached route's warmCache into the registry. Each paramBuilder
// produces the query the route handler would have received from the front-end
// for the default "This month / All Locations (or this club)" combo.
function registerDefaultRoutes() {
  const deactivatedPT = require('../routes/deactivatedPT')
  const ptNewClients = require('../routes/ptNewClients')
  const ptHealth = require('../routes/ptHealth')
  const ptRoster = require('../routes/ptRoster')
  const ptSessions = require('../routes/ptSessions')
  const checkinsReport = require('../routes/checkinsReport')

  const dateRange = (loc, range) => ({ ...range, location_slug: loc })
  const locOnly = (loc) => ({ location_slug: loc })

  registerWarmer('deactivated-pt', deactivatedPT.warmCache, dateRange)
  registerWarmer('pt-new-clients', ptNewClients.warmCache, dateRange)
  registerWarmer('pt-health', ptHealth.warmCache, dateRange)
  registerWarmer('pt-roster', ptRoster.warmCache, locOnly)
  registerWarmer('pt-sessions', ptSessions.warmCache, dateRange)
  registerWarmer('checkins', checkinsReport.warmCache, dateRange)
}

module.exports = {
  start,
  stop,
  runCycle,
  registerWarmer,
  registerDefaultRoutes,
  isPacificBusinessHours,
  thisMonthRange,
  // Test hooks
  _tasks: tasks,
  _resetTasks: () => { tasks.length = 0 },
}
