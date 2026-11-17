const test = require('node:test')
const assert = require('node:assert')
const { buildL10, isDues } = require('./l10Report')

const clubs = [
  { slug: 'salem', name: 'Salem', clubNumber: '1' },
  { slug: 'eugene', name: 'Eugene', clubNumber: '7655' },
]
const slugForClubNumber = n => ({ 1: 'salem', 7655: 'eugene', '07655': 'eugene' })[n] || null

function win(i, { newM = 10, lost = 5, dues = 1000, training = 300, snacks = 20, refunds = 0 } = {}) {
  return {
    start: `2026-0${7 - i}-01`, end: `2026-0${7 - i}-10`,
    membership: [{ segment: '1', new_members: newM, lost_members: lost }],
    revenue: [
      { slug: 'salem', category: 'Dues', revenue: dues },
      { slug: 'salem', category: 'A2 Exec Dues', revenue: 100 },
      { slug: 'salem', category: 'Training', revenue: training },
      { slug: 'salem', category: 'Snacks', revenue: snacks },
      { slug: 'salem', category: 'Drinks', revenue: 5 },
      { slug: 'salem', category: 'Guest Fee', revenue: 50 },
      { slug: 'salem', category: 'Refunds', revenue: refunds },
    ],
  }
}

test('isDues catches every dues product and nothing else', () => {
  for (const c of ['Dues', 'A2 Exec Dues', 'Paid In Full Dues', 'MBO Dues']) assert.ok(isDues(c), c)
  for (const c of ['Training', 'Annual Fee', 'Snacks']) assert.ok(!isDues(c), c)
})

test('lines are split the way the notes say', () => {
  const windows = Array.from({ length: 7 }, (_, i) => win(i, { refunds: -40 }))
  const out = buildL10(windows, { clubs, slugForClubNumber })
  const salem = out.rows.find(r => r.key === 'salem').current
  assert.equal(salem.dues, 1100)
  assert.equal(salem.pt, 300)
  assert.equal(salem.pos, 25)
  assert.equal(salem['pos:Snacks'], 20)
  // Total is every center, refunds netted: 1000+100+300+20+5+50-40
  assert.equal(salem.total, 1435)
  assert.equal(salem.net, 5)
})

test('last month is window 1; the average is windows 1..6 and excludes the current one', () => {
  const windows = [
    win(0, { newM: 100, dues: 9999 }),
    win(1, { newM: 20 }), win(2, { newM: 10 }), win(3, { newM: 10 }),
    win(4, { newM: 10 }), win(5, { newM: 10 }), win(6, { newM: 0 }),
  ]
  const out = buildL10(windows, { clubs, slugForClubNumber })
  assert.equal(out.totals.lastMonth.newMembers.base, 20)
  assert.equal(out.totals.lastMonth.newMembers.delta, 80)
  assert.equal(out.totals.avg6.newMembers.base, 10)
  assert.equal(out.totals.avg6.newMembers.pct, 900)
  assert.equal(out.totals.avg6.dues.base, 1100)
  assert.equal(out.totals.history.length, 6)
})

test('a club with no activity is a row of zeros, not a missing row', () => {
  const windows = Array.from({ length: 7 }, (_, i) => win(i))
  const out = buildL10(windows, { clubs, slugForClubNumber })
  const eugene = out.rows.find(r => r.key === 'eugene')
  assert.equal(eugene.current.total, 0)
  assert.equal(eugene.lastMonth.total.pct, null)
})

test('net members across zero has a delta but no percentage', () => {
  const windows = [win(0, { newM: 5, lost: 10 }), ...Array.from({ length: 6 }, (_, i) => win(i + 1, { newM: 10, lost: 5 }))]
  const out = buildL10(windows, { clubs, slugForClubNumber })
  assert.equal(out.totals.lastMonth.net.delta, -10)
  assert.equal(out.totals.lastMonth.net.pct, null)
})
