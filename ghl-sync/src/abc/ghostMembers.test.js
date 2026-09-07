const test = require('node:test')
const assert = require('node:assert')
const { planGhosts } = require('./ghostMembers')

// A cycle that started at 10:00. Rows stamped at or after that were refreshed
// by this run; rows stamped before it were not returned by ABC.
const CYCLE = '2026-09-07T10:00:00.000Z'
const FRESH = '2026-09-07T10:00:05.000Z'
const STALE = '2026-06-01T00:00:00.000Z'

function rows(...specs) {
  return specs.map(([member_id, last_sync_at]) => ({ member_id, last_sync_at }))
}

test('a held-active row ABC did not return this cycle is a ghost', () => {
  const plan = planGhosts({
    heldActive: rows(['keep', FRESH], ['ghost', STALE]),
    abcIds: new Set(['keep']),
    cycleStartedAt: CYCLE,
  })
  assert.deepStrictEqual(plan.ghostIds, ['ghost'])
  assert.strictEqual(plan.skipped, false)
})

test('a row refreshed this cycle is never a ghost', () => {
  const plan = planGhosts({
    heldActive: rows(['keep', FRESH]),
    abcIds: new Set(['keep']),
    cycleStartedAt: CYCLE,
  })
  assert.deepStrictEqual(plan.ghostIds, [])
})

// The member who cancelled mid-cycle. They drop off the ACTIVE pull, but the
// incremental inactive pull picks them up in the same run, so their row is
// refreshed and must not be mistaken for a member ABC has dropped.
test('a member who cancelled this cycle is not a ghost', () => {
  const plan = planGhosts({
    heldActive: rows(['cancelled', FRESH]),
    abcIds: new Set(['cancelled']),
    cycleStartedAt: CYCLE,
  })
  assert.deepStrictEqual(plan.ghostIds, [])
})

// Belt and braces: a stale timestamp alone is not enough. If ABC returned the
// member, something else failed to stamp the row and deleting it would be wrong.
test('a stale row ABC still returns is not a ghost', () => {
  const plan = planGhosts({
    heldActive: rows(['stale-but-real', STALE]),
    abcIds: new Set(['stale-but-real']),
    cycleStartedAt: CYCLE,
  })
  assert.deepStrictEqual(plan.ghostIds, [])
})

// The whole point of the guard: one bad ABC response must not be able to
// archive a club. Half the members missing is not a reconciliation, it is an
// outage.
test('skips entirely when ABC returned implausibly few members', () => {
  const plan = planGhosts({
    heldActive: rows(['a', STALE], ['b', STALE], ['c', STALE], ['d', STALE]),
    abcIds: new Set(['a']),
    cycleStartedAt: CYCLE,
  })
  assert.strictEqual(plan.skipped, true)
  assert.strictEqual(plan.reason, 'coverage')
  assert.deepStrictEqual(plan.ghostIds, [])
})

test('an empty ABC response is a skip, not a mass archive', () => {
  const plan = planGhosts({
    heldActive: rows(['a', STALE], ['b', STALE]),
    abcIds: new Set(),
    cycleStartedAt: CYCLE,
  })
  assert.strictEqual(plan.skipped, true)
  assert.deepStrictEqual(plan.ghostIds, [])
})

test('holding no active rows is not a divide-by-zero skip', () => {
  const plan = planGhosts({ heldActive: [], abcIds: new Set(), cycleStartedAt: CYCLE })
  assert.strictEqual(plan.skipped, false)
  assert.deepStrictEqual(plan.ghostIds, [])
})

// A row that has never been synced has a null stamp. It cannot be newer than
// the cycle start, so it must be eligible rather than silently retained.
test('a null last_sync_at counts as not refreshed', () => {
  const plan = planGhosts({
    heldActive: rows(['never', null], ['keep', FRESH], ['k2', FRESH], ['k3', FRESH]),
    abcIds: new Set(['keep', 'k2', 'k3']),
    cycleStartedAt: CYCLE,
  })
  assert.deepStrictEqual(plan.ghostIds, ['never'])
})

test('coverage floor is configurable', () => {
  const args = {
    heldActive: rows(['a', FRESH], ['b', STALE], ['c', STALE], ['d', STALE]),
    abcIds: new Set(['a']),
    cycleStartedAt: CYCLE,
  }
  assert.strictEqual(planGhosts({ ...args, coverageFloor: 0.9 }).skipped, true)
  assert.strictEqual(planGhosts({ ...args, coverageFloor: 0.1 }).skipped, false)
})

test('reports the coverage it measured, so a skip is diagnosable', () => {
  const plan = planGhosts({
    heldActive: rows(['a', STALE], ['b', STALE], ['c', STALE], ['d', STALE]),
    abcIds: new Set(['a']),
    cycleStartedAt: CYCLE,
  })
  assert.strictEqual(plan.coverage, 0.25)
  assert.strictEqual(plan.heldActiveCount, 4)
  assert.strictEqual(plan.abcCount, 1)
})
