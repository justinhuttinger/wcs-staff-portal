const { test } = require('node:test')
const assert = require('node:assert')
const {
  toBytes, sumSeriesBytes, latestValue, indexByResource,
  serviceState, pctOf, buildServiceRow, sortRows, rollup, monthToDateWindow, GB,
} = require('./renderStatusHelpers')

// node:test + node:assert, CommonJS. Run with `node --test src/`.
//
// The screen these back exists to answer "is anything down" and "what is eating
// the bandwidth quota". Both answers are arithmetic over Render metrics series,
// so the arithmetic is what is worth pinning down.

// --- unit normalization -----------------------------------------------------

test('toBytes converts each unit Render reports', () => {
  assert.strictEqual(toBytes(1, 'b'), 1)
  assert.strictEqual(toBytes(1, 'kb'), 1024)
  assert.strictEqual(toBytes(1, 'mb'), 1024 ** 2)
  assert.strictEqual(toBytes(1, 'GB'), 1024 ** 3, 'unit match must be case-insensitive')
})

test('toBytes treats an unknown unit as bytes rather than guessing', () => {
  // Guessing a multiplier here would silently inflate the headline GB number.
  assert.strictEqual(toBytes(500, 'furlongs'), 500)
  assert.strictEqual(toBytes(500, undefined), 500)
})

test('toBytes returns 0 for non-numeric values', () => {
  assert.strictEqual(toBytes(null, 'mb'), 0)
  assert.strictEqual(toBytes('abc', 'mb'), 0)
})

// --- series math ------------------------------------------------------------

test('sumSeriesBytes totals every datapoint across every series', () => {
  const series = [
    { unit: 'mb', values: [{ value: 100 }, { value: 200 }] },
    { unit: 'mb', values: [{ value: 50 }] },
  ]
  assert.strictEqual(sumSeriesBytes(series), 350 * 1024 ** 2)
})

test('sumSeriesBytes prefers a per-datapoint unit over the series unit', () => {
  const series = [{ unit: 'mb', values: [{ value: 1, unit: 'gb' }] }]
  assert.strictEqual(sumSeriesBytes(series), 1024 ** 3)
})

test('sumSeriesBytes is 0 for missing or malformed input', () => {
  assert.strictEqual(sumSeriesBytes(undefined), 0)
  assert.strictEqual(sumSeriesBytes([]), 0)
  assert.strictEqual(sumSeriesBytes([{ values: null }]), 0)
})

test('latestValue picks the newest datapoint, not the last in array order', () => {
  const series = [{
    values: [
      { timestamp: '2026-09-07T10:00:00Z', value: 10 },
      { timestamp: '2026-09-07T12:00:00Z', value: 99 },
      { timestamp: '2026-09-07T11:00:00Z', value: 50 },
    ],
  }]
  assert.strictEqual(latestValue(series), 99)
})

test('latestValue ignores datapoints with unparseable timestamps', () => {
  const series = [{
    values: [
      { timestamp: 'nope', value: 999 },
      { timestamp: '2026-09-07T10:00:00Z', value: 7 },
    ],
  }]
  assert.strictEqual(latestValue(series), 7)
})

test('latestValue returns null when there is nothing usable', () => {
  assert.strictEqual(latestValue([]), null)
  assert.strictEqual(latestValue(undefined), null)
})

test('indexByResource fans a multi-service metrics response back out by id', () => {
  const series = [
    { labels: [{ field: 'resource', value: 'srv-a' }], values: [] },
    { labels: [{ field: 'service', value: 'srv-b' }], values: [] },
    { labels: [{ field: 'resource', value: 'srv-a' }], values: [] },
    { labels: [], values: [] },
  ]
  const idx = indexByResource(series)
  assert.strictEqual(idx.get('srv-a').length, 2)
  assert.strictEqual(idx.get('srv-b').length, 1)
  assert.strictEqual(idx.size, 2, 'series with no resource label must be dropped')
})

// --- health state -----------------------------------------------------------

test('serviceState reports suspended regardless of deploy status', () => {
  assert.strictEqual(serviceState({ suspended: 'suspended' }, { status: 'live' }), 'suspended')
})

test('serviceState flags every failure status', () => {
  const s = { suspended: 'not_suspended' }
  for (const status of ['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled']) {
    assert.strictEqual(serviceState(s, { status }), 'failed', status + ' must read as failed')
  }
})

test('serviceState reports in-progress deploys', () => {
  const s = { suspended: 'not_suspended' }
  for (const status of ['created', 'queued', 'build_in_progress', 'update_in_progress']) {
    assert.strictEqual(serviceState(s, { status }), 'deploying', status + ' must read as deploying')
  }
})

test('serviceState is unknown, not failed, when there is no deploy', () => {
  // Static sites and cron jobs can have no deploy in the window. Calling that a
  // failure would light the screen red for healthy services.
  assert.strictEqual(serviceState({ suspended: 'not_suspended' }, null), 'unknown')
})

// --- percentages ------------------------------------------------------------

test('pctOf computes a one-decimal percentage', () => {
  assert.strictEqual(pctOf(25, 100), 25)
  assert.strictEqual(pctOf(1, 3), 33.3)
})

test('pctOf refuses to divide by zero or a missing limit', () => {
  assert.strictEqual(pctOf(10, 0), null)
  assert.strictEqual(pctOf(10, null), null)
  assert.strictEqual(pctOf(10, undefined), null)
})

// --- row building -----------------------------------------------------------

function svc(over) {
  return Object.assign({
    id: 'srv-1',
    name: 'ghl-sync',
    type: 'web_service',
    suspended: 'not_suspended',
    dashboardUrl: 'https://dashboard.render.com/web/srv-1',
    serviceDetails: { plan: 'standard', url: 'https://ghl-sync.onrender.com' },
  }, over || {})
}

test('buildServiceRow converts bandwidth to GB', () => {
  const row = buildServiceRow({
    service: svc(),
    deploy: { status: 'live', finishedAt: '2026-09-07T00:00:00Z' },
    bandwidthSeries: [{ unit: 'mb', values: [{ value: 1024 }, { value: 1024 }] }],
  })
  assert.strictEqual(row.bandwidthGb, 2)
  assert.strictEqual(row.state, 'live')
  assert.strictEqual(row.plan, 'standard')
})

test('buildServiceRow leaves cpu pct null when the limit is unavailable', () => {
  // limitsSafe returns null when the limit endpoint fails; usage must still show.
  const row = buildServiceRow({
    service: svc(),
    deploy: null,
    cpuSeries: [{ values: [{ timestamp: '2026-09-07T00:00:00Z', value: 0.4 }] }],
    cpuLimitSeries: null,
  })
  assert.strictEqual(row.cpu.used, 0.4)
  assert.strictEqual(row.cpu.pct, null)
})

test('buildServiceRow takes only the first line of a commit message', () => {
  const row = buildServiceRow({
    service: svc(),
    deploy: { status: 'live', commit: { message: 'fix: thing\n\nlong body here' } },
  })
  assert.strictEqual(row.deploy.commitMessage, 'fix: thing')
})

// --- sorting ----------------------------------------------------------------

test('sortRows puts failures first, then heaviest bandwidth', () => {
  const rows = [
    { name: 'quiet', state: 'live', bandwidthBytes: 1 },
    { name: 'hog', state: 'live', bandwidthBytes: 500 },
    { name: 'broken', state: 'failed', bandwidthBytes: 0 },
    { name: 'off', state: 'suspended', bandwidthBytes: 0 },
  ]
  assert.deepStrictEqual(sortRows(rows).map(r => r.name), ['broken', 'hog', 'quiet', 'off'])
})

test('sortRows does not mutate its input', () => {
  const rows = [
    { name: 'a', state: 'live', bandwidthBytes: 1 },
    { name: 'b', state: 'failed', bandwidthBytes: 0 },
  ]
  sortRows(rows)
  assert.strictEqual(rows[0].name, 'a')
})

// --- account rollup ---------------------------------------------------------

test('rollup totals bandwidth across services and computes percent of cap', () => {
  const r = rollup([
    { bandwidthBytes: 10 * GB, state: 'live' },
    { bandwidthBytes: 5 * GB, state: 'live' },
  ], 25)
  assert.strictEqual(r.totalGb, 15)
  assert.strictEqual(r.capGb, 25)
  assert.strictEqual(r.pct, 60)
  assert.strictEqual(r.level, 'ok')
  assert.strictEqual(r.overageGb, 0)
})

test('rollup warns at 80 percent and flags over at 100', () => {
  assert.strictEqual(rollup([{ bandwidthBytes: 20 * GB }], 25).level, 'warn')
  assert.strictEqual(rollup([{ bandwidthBytes: 26 * GB }], 25).level, 'over')
})

test('rollup reports overage in GB once past the cap', () => {
  // The real incident: 25 GB cap, blown through in the first week of the month.
  const r = rollup([{ bandwidthBytes: 55 * GB }, { bandwidthBytes: 5 * GB }], 25)
  assert.strictEqual(r.totalGb, 60)
  assert.strictEqual(r.overageGb, 35)
  assert.strictEqual(r.level, 'over')
})

test('rollup counts failed services', () => {
  const r = rollup([
    { bandwidthBytes: 0, state: 'failed' },
    { bandwidthBytes: 0, state: 'live' },
  ], 25)
  assert.strictEqual(r.unhealthy, 1)
})

test('rollup handles a missing or zero cap without dividing by zero', () => {
  const r = rollup([{ bandwidthBytes: GB }], 0)
  assert.strictEqual(r.pct, null)
  assert.strictEqual(r.capGb, null)
  assert.strictEqual(r.level, 'ok')
})

// --- window -----------------------------------------------------------------

test('monthToDateWindow starts at the first instant of the calendar month', () => {
  // Render resets the bandwidth quota at the start of the calendar month, so
  // any other window would report a number that does not match the bill.
  const { startTime, endTime } = monthToDateWindow(new Date('2026-09-07T14:30:00Z'))
  assert.strictEqual(startTime, '2026-09-01T00:00:00.000Z')
  assert.strictEqual(endTime, '2026-09-07T14:30:00.000Z')
})

test('monthToDateWindow handles January without rolling back a year', () => {
  const { startTime } = monthToDateWindow(new Date('2026-01-15T00:00:00Z'))
  assert.strictEqual(startTime, '2026-01-01T00:00:00.000Z')
})
