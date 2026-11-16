const test = require('node:test')
const assert = require('node:assert/strict')
const { planWeek, orderItems, laIso, workdays } = require('../src/services/hub/plan')

const H = h => h * 60 // minutes from midnight
const day = (dateKey, busy = []) => ({ date: dateKey, busy })

test('packs blocks back to back from 8:00', () => {
  const r = planWeek({
    days: [day('2026-11-17')],
    items: [{ key: 'a', title: 'A', minutes: 60, blocks: 1 }, { key: 'b', title: 'B', minutes: 30, blocks: 1 }],
  })
  assert.deepEqual(r.blocks.map(b => [b.key, b.start, b.end]), [['a', H(8), H(9)], ['b', H(9), H(9) + 30]])
  assert.deepEqual(r.unfit, [])
})

test('works around meetings and fills a short gap with a shorter item', () => {
  const r = planWeek({
    days: [day('2026-11-17', [[H(8) + 30, H(10)]])], // meeting 8:30-10
    items: [{ key: 'big', title: 'Big', minutes: 60, blocks: 1 }, { key: 'quick', title: 'Quick', minutes: 30, blocks: 1 }],
  })
  // 8:00-8:30 only fits the 30-min item; the hour goes after the meeting.
  assert.deepEqual(r.blocks.map(b => [b.key, b.start]), [['quick', H(8)], ['big', H(10)]])
})

test('at most 3 hours a day; the rest rolls to the next day', () => {
  const items = [1, 2, 3, 4].map(n => ({ key: `t${n}`, title: `T${n}`, minutes: 60, blocks: 1 }))
  const r = planWeek({ days: [day('2026-11-17'), day('2026-11-18')], items })
  assert.deepEqual(r.blocks.map(b => [b.key, b.date]), [['t1', '2026-11-17'], ['t2', '2026-11-17'], ['t3', '2026-11-17'], ['t4', '2026-11-18']])
})

test('split work goes one block a day on consecutive days, labelled 1 of N', () => {
  const r = planWeek({ days: [day('2026-11-17'), day('2026-11-18')], items: [{ key: 'x', title: 'X', minutes: 90, blocks: 2 }] })
  assert.deepEqual(r.blocks.map(b => [b.date, b.part, b.of]), [['2026-11-17', 1, 2], ['2026-11-18', 2, 2]])
})

test("today starts from the given minute; what doesn't fit is reported", () => {
  const r = planWeek({
    days: [day('2026-11-17')], startToday: H(16) + 30,
    items: [{ key: 'a', title: 'A', minutes: 60, blocks: 1 }, { key: 'b', title: 'B', minutes: 30, blocks: 1 }],
  })
  assert.deepEqual(r.blocks.map(b => [b.key, b.start]), [['b', H(16) + 30]])
  assert.deepEqual(r.unfit, ['a'])
})

test('order: overdue / due this week, then nearest due, then priority, then oldest', () => {
  const items = [
    { key: 'old-low', due: null, priority: 'low', created_at: '2026-10-01' },
    { key: 'due-later', due: '2026-12-15', priority: 'low', created_at: '2026-11-10' },
    { key: 'high', due: null, priority: 'high', created_at: '2026-11-10' },
    { key: 'overdue', due: '2026-11-10', priority: 'low', created_at: '2026-11-10' },
    { key: 'this-week', due: '2026-11-19', priority: 'medium', created_at: '2026-11-10' },
  ]
  assert.deepEqual(orderItems(items, '2026-11-16').map(i => i.key), ['overdue', 'this-week', 'due-later', 'high', 'old-low'])
})

test('laIso gives Pacific time with the right offset across DST', () => {
  assert.equal(laIso('2026-11-17', H(9)), '2026-11-17T09:00:00-08:00')
  assert.equal(laIso('2026-07-14', H(13) + 30), '2026-07-14T13:30:00-07:00')
})

test('workdays: the next 5 weekdays from a date (today included)', () => {
  assert.deepEqual(workdays('2026-11-20', 5), ['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'])
})

const { laParts, busyByDay, cleanEstimate } = require('../src/services/hub/plan')

test('laParts: an instant as Pacific date and minute of day', () => {
  assert.deepEqual(laParts('2026-11-17T17:30:00Z'), { date: '2026-11-17', minute: 9 * 60 + 30 })
})

test('busyByDay: ignores Daily Planning, all-day and free events; clips to the day', () => {
  const events = [
    { summary: 'Daily Planning', start: { dateTime: '2026-11-17T16:00:00Z' }, end: { dateTime: '2026-11-17T16:30:00Z' } },
    { summary: 'Holiday', start: { date: '2026-11-17' }, end: { date: '2026-11-18' } },
    { summary: 'FYI', transparency: 'transparent', start: { dateTime: '2026-11-17T18:00:00Z' }, end: { dateTime: '2026-11-17T19:00:00Z' } },
    { summary: 'L10', start: { dateTime: '2026-11-17T17:00:00Z' }, end: { dateTime: '2026-11-17T18:30:00Z' } },
  ]
  assert.deepEqual(busyByDay(events, new Set()).get('2026-11-17'), [[9 * 60, 10 * 60 + 30]])
})

test('busyByDay: skips events being replaced (our own old blocks)', () => {
  const events = [{ id: 'old', summary: 'Focus: X', start: { dateTime: '2026-11-17T17:00:00Z' }, end: { dateTime: '2026-11-17T18:00:00Z' } }]
  assert.equal(busyByDay(events, new Set(['old'])).get('2026-11-17'), undefined)
})

test('cleanEstimate keeps sizes to 30/60/90 and 1-3 blocks', () => {
  assert.deepEqual(cleanEstimate({ minutes: 45, blocks: 9 }), { minutes: 60, blocks: 3 })
  assert.deepEqual(cleanEstimate({ minutes: 10 }), { minutes: 30, blocks: 1 })
  assert.deepEqual(cleanEstimate(null), { minutes: 60, blocks: 1 })
  assert.deepEqual(cleanEstimate({ minutes: 180 }), { minutes: 90, blocks: 2 })
})
