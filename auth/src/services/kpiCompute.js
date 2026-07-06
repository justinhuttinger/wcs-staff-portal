// Headless KPI compute for the nightly snapshot job.
//
// The KPI report's numbers are produced by the /reports/* and /operandio/*
// endpoints and combined in the frontend (KpiReport.jsx KPI_DEFS). To freeze
// them server-side without duplicating (and drifting from) that query logic, we
// invoke the very same route handlers in-process with a synthetic admin request
// and apply the same derive formulas here. No HTTP, no auth round-trip — this is
// a trusted internal caller.
//
// Extraction: each route's Express layer stores its handler(s) in
// `layer.route.stack`; the actual handler is always the LAST entry (any
// per-route middleware precedes it). reports.js uses router-level auth, so its
// route stacks are just the handler; operandio.js mounts auth per-route, so the
// handler is last there too — the same "take the last handle" rule covers both.

const reportsRouter = require('../routes/reports')
const operandioRouter = require('../routes/operandio')

function extractHandler(router, path) {
  const layer = (router.stack || []).find(l => l.route && l.route.path === path)
  if (!layer) throw new Error(`[kpiCompute] no route handler for ${path}`)
  const stack = layer.route.stack
  return stack[stack.length - 1].handle
}

// Invoke a route handler with a synthetic admin request and capture its JSON.
// role:'admin' means resolveScopedSlugs returns exactly the requested club (no
// narrowing), so we get that one club's numbers.
function callHandler(handler, query) {
  return new Promise((resolve, reject) => {
    const req = { query, staff: { role: 'admin' }, headers: {} }
    let settled = false
    const done = (fn, v) => { if (!settled) { settled = true; fn(v) } }
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(body) {
        if (this.statusCode >= 400) done(reject, new Error(body && body.error ? body.error : `handler ${this.statusCode}`))
        else done(resolve, body)
      },
    }
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(err => done(reject, err))
  })
}

const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : 0)
const mean = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null)

// The seven KPI keys, matching KPI_DEFS in the frontend.
const KPI_KEYS = ['trial', 'dayone', 'vip', 'speed', 'ops', 'c2s', 'qa']

// Compute all KPIs for one club over [startDate, endDate] (inclusive, YYYY-MM-DD).
// Returns { [kpiKey]: { value, numerator?, denominator?, sample_size? } }.
// value is null when the metric has no data (n/a) — same semantics as the report.
// A single failed source degrades only its own KPI(s) to null, never the batch.
async function computeKpisForClub(slug, startDate, endDate) {
  const membershipH = extractHandler(reportsRouter, '/membership')
  const cancelsH = extractHandler(reportsRouter, '/cancels')
  const speedH = extractHandler(reportsRouter, '/speed-to-lead')
  const rangeH = extractHandler(operandioRouter, '/range')
  const qaH = extractHandler(operandioRouter, '/qa-reports')

  const dateQ = { start_date: startDate, end_date: endDate, location_slug: slug }
  const [mem, can, spd, ops, qa] = await Promise.all([
    callHandler(membershipH, dateQ).catch(() => null),
    callHandler(cancelsH, dateQ).catch(() => null),
    callHandler(speedH, dateQ).catch(() => null),
    callHandler(rangeH, dateQ).catch(() => null),
    // QA is "timeless": latest audit ON OR BEFORE the snapshot day, no start bound.
    callHandler(qaH, { location_slug: slug, department: 'QA-Cleaning', end_date: endDate }).catch(() => null),
  ])

  const out = {}

  out.trial = mem && mem.trial_conversion && mem.trial_conversion.trial_started
    ? { value: mem.trial_conversion.rate, numerator: mem.trial_conversion.won, denominator: mem.trial_conversion.trial_started }
    : { value: null }

  out.dayone = mem
    ? { value: pct(mem.total_day_one_booked || 0, mem.total_memberships || 0), numerator: mem.total_day_one_booked || 0, denominator: mem.total_memberships || 0 }
    : { value: null }

  out.vip = mem
    ? { value: pct(mem.total_vips || 0, mem.total_memberships || 0), numerator: mem.total_vips || 0, denominator: mem.total_memberships || 0 }
    : { value: null }

  // Speed to Lead: business-hours median minutes (staffed-window clock, lower
  // is better) — matches the KPI report's headline number. sample_size =
  // contacted leads.
  out.speed = spd && spd.contacted_count
    ? { value: spd.business_median_minutes, sample_size: spd.contacted_count }
    : { value: null }

  // Operational Compliance: mean of the daily overall scores in range (weekly
  // rows, where period_start !== period_end, are skipped so they don't double-count).
  out.ops = ops
    ? { value: mean((ops.rows || []).filter(r => r.period_start === r.period_end).map(r => r.overall_pct)) }
    : { value: null }

  out.c2s = can && can.c2s_utilization
    ? { value: pct(can.c2s_utilization.via_c2s, can.c2s_utilization.cancelled_members), numerator: can.c2s_utilization.via_c2s, denominator: can.c2s_utilization.cancelled_members }
    : { value: null }

  // Cleanliness QA: most recent audit score for this club on or before the day
  // (rows arrive newest-first from /qa-reports).
  const qaRow = (qa && qa.rows || []).find(r => r.location_slug === slug) || (qa && qa.rows || [])[0]
  out.qa = qaRow ? { value: qaRow.score_pct } : { value: null }

  return out
}

module.exports = { computeKpisForClub, KPI_KEYS }
