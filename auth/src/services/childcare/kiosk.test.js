const { test } = require('node:test')
const assert = require('node:assert')
const { aggregate, local } = require('./kiosk')

// 2026-10-26 is a Monday. 17:00Z = 10:00 Pacific (PDT, UTC-7).
let n = 0
function visit(over = {}) {
  n++
  return {
    id: `v${n}`,
    club_number: '31600',
    child_first_name: 'Ava', child_last_name: 'Rivera', child_age_months: 48,
    parent_first_name: 'Sam', parent_last_name: 'Rivera', parent_phone: '(503) 555-1234',
    membership_kind: 'drop_in',
    checked_in_at: '2026-10-26T17:00:00Z',
    checked_out_at: '2026-10-26T18:30:00Z',
    checked_out_by: 'same_parent', checked_out_by_first_name: 'Sam', checked_out_by_last_name: 'Rivera',
    auto_closed: false,
    ...over,
  }
}

test('local() reads Pacific date, weekday and hour', () => {
  assert.deepStrictEqual(local('2026-10-26T17:30:00Z'), { date: '2026-10-26', dow: 'Monday', hour: 10.5 })
  // 03:00Z is still the previous evening in Oregon.
  assert.strictEqual(local('2026-10-27T03:00:00Z').date, '2026-10-26')
})

test('totals split monthly / drop-in, under-1 and pickups', () => {
  const r = aggregate([
    visit(),
    visit({ membership_kind: 'monthly', child_age_months: 8, checked_out_by: 'approved_alternate' }),
    visit({ checked_out_by: 'other' }),
  ])
  assert.strictEqual(r.totals.visits, 3)
  assert.strictEqual(r.totals.monthly, 1)
  assert.strictEqual(r.totals.drop_in, 2)
  assert.strictEqual(r.totals.under1, 1)
  assert.deepStrictEqual(r.totals.pickup, { same_parent: 1, approved_alternate: 1, other: 1 })
  assert.strictEqual(r.totals.avg_stay_min, 90)
  assert.strictEqual(r.totals.days, 1)
})

test('a visit nobody checked out has no stay and no hours, but is counted', () => {
  const r = aggregate([
    visit(),
    visit({ checked_out_at: null, checked_out_by: null, checked_out_by_first_name: null, auto_closed: true }),
  ])
  assert.strictEqual(r.totals.not_checked_out, 1)
  assert.strictEqual(r.totals.avg_stay_min, 90)
  const mon = r.hourly.find(d => d.day_of_week === 'Monday')
  // Only the checked-out visit fills 10:00 and 11:00.
  assert.deepStrictEqual(mon.hours.map(h => [h.hour, h.avg]), [[10, 1], [11, 1]])
  assert.strictEqual(r.log.find(l => l.auto_closed).stay_min, null)
})

test('hourly averages over the days the kiosk was used on that weekday', () => {
  const r = aggregate([
    // Monday 10/26: two children overlap at 10:00
    visit(),
    visit({ checked_in_at: '2026-10-26T17:15:00Z', checked_out_at: '2026-10-26T17:45:00Z' }),
    // Monday 11/2 (PST, UTC-8): one child 10:00-10:30
    visit({ checked_in_at: '2026-11-02T18:00:00Z', checked_out_at: '2026-11-02T18:30:00Z' }),
  ])
  const mon = r.hourly.find(d => d.day_of_week === 'Monday')
  assert.strictEqual(mon.days, 2)
  const at10 = mon.hours.find(h => h.hour === 10)
  assert.strictEqual(at10.avg, 1.5)
  assert.strictEqual(at10.peak, 2)
  assert.strictEqual(r.hourly.length, 1)
})

test('a child still in the room counts up to now', () => {
  const r = aggregate(
    [visit({ checked_out_at: null, checked_out_by: null, checked_out_by_first_name: null })],
    { now: new Date('2026-10-26T19:10:00Z') }
  )
  assert.strictEqual(r.totals.still_in_room, 1)
  assert.deepStrictEqual(r.hourly[0].hours.map(h => h.hour), [10, 11, 12])
  assert.strictEqual(r.totals.avg_stay_min, null)
})

test('drop-in families group by typed parent name + phone, most days first', () => {
  const r = aggregate([
    visit(),
    visit({ child_first_name: 'Leo', checked_in_at: '2026-10-27T17:00:00Z', checked_out_at: '2026-10-27T18:00:00Z' }),
    visit({ parent_first_name: 'SAM', checked_in_at: '2026-10-28T17:00:00Z', checked_out_at: '2026-10-28T18:00:00Z' }),
    visit({ parent_first_name: 'Dana', parent_last_name: 'Chen', parent_phone: '(971) 555-0000' }),
    visit({ membership_kind: 'monthly', parent_first_name: 'Monthly', parent_last_name: 'Only' }),
  ])
  assert.strictEqual(r.drop_in_families.length, 2)
  const sam = r.drop_in_families[0]
  assert.strictEqual(sam.parent, 'Sam Rivera')
  assert.strictEqual(sam.days, 3)
  assert.strictEqual(sam.visits, 3)
  assert.deepStrictEqual(sam.children, ['Ava Rivera', 'Leo Rivera'])
})

test('the hour grid keeps empty hours between busy ones', () => {
  const r = aggregate([
    visit(),
    visit({ checked_in_at: '2026-10-26T23:00:00Z', checked_out_at: '2026-10-26T23:30:00Z' }),
  ])
  assert.deepStrictEqual(r.hourly[0].hours.map(h => [h.hour, h.avg]),
    [[10, 1], [11, 1], [12, 0], [13, 0], [14, 0], [15, 0], [16, 1]])
})

test('by-club rows carry per-day averages and sort by visits', () => {
  const r = aggregate([visit(), visit(), visit({ club_number: '30935' })])
  assert.deepStrictEqual(r.by_club.map(c => [c.club_number, c.visits, c.avg_per_day]), [['31600', 2, 2], ['30935', 1, 1]])
})

test('empty input is an empty report, not an error', () => {
  const r = aggregate([])
  assert.strictEqual(r.totals.visits, 0)
  assert.deepStrictEqual(r.hourly, [])
  assert.deepStrictEqual(r.by_club, [])
})
