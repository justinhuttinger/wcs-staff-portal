// auth/src/services/kpiDigest/tiptap.test.js
const test = require('node:test')
const assert = require('node:assert')
const { buildDigestDoc, tidyName } = require('./tiptap')

const SAMPLE = {
  window: { start: '2026-07-13', end: '2026-07-19' },
  totals: { sales: 162, booked: 81, d1_sales: 13 },
  day_one_sales: [
    { club: 'Clackamas', trainer: 'Talya Davidoff', member: 'fae haffner', pkg: '5 Pack' },
    { club: 'Clackamas', trainer: null, member: 'brian francis', pkg: '10 Pack' },
    { club: 'Keizer', trainer: 'James Yount', member: 'dani byler', pkg: '1 x Week' },
  ],
  roster: [
    { club: 'Clackamas', person: 'Alexander Hilgerdt', sales: 9, day_ones: 4 },
    { club: 'Eugene', person: 'DANIEL JENSEN', sales: 5, day_ones: 0 },
    { club: 'Keizer', person: 'Hailey Reynolds', sales: 4, day_ones: 7 },
  ],
}

// Collect all text strings in a doc for easy assertions.
function allText(node, acc = []) {
  if (node.text) acc.push(node.text)
  for (const c of node.content || []) allText(c, acc)
  return acc
}

test('tidyName title-cases names but preserves short initials and hyphens', () => {
  assert.strictEqual(tidyName('DANIEL JENSEN'), 'Daniel Jensen')
  assert.strictEqual(tidyName('brian francis'), 'Brian Francis')
  assert.strictEqual(tidyName('JT Nelms'), 'JT Nelms')
  assert.strictEqual(tidyName('AJ Brown'), 'AJ Brown')
  assert.strictEqual(tidyName('Kirstyn Pagano-Jackson'), 'Kirstyn Pagano-Jackson')
})

test('builds a doc node with two H2 sections in order', () => {
  const doc = buildDigestDoc(SAMPLE, '2026-07-20')
  assert.strictEqual(doc.type, 'doc')
  const h2 = doc.content.filter((n) => n.type === 'heading' && n.attrs.level === 2)
    .map((n) => n.content[0].text)
  assert.deepStrictEqual(h2, ['Day One sales', 'Membership sales and Day One bookings'])
})

test('header carries the window, generated date, and company totals', () => {
  const text = allText(buildDigestDoc(SAMPLE, '2026-07-20')).join(' ')
  assert.match(text, /Week of Monday, July 13 to Sunday, July 19, 2026/)
  assert.match(text, /Generated Monday, July 20, 2026/)
  assert.match(text, /162 membership sales, 81 Day Ones booked, 13 Day One PT sales/)
})

test('missing trainer renders as "No trainer assigned" and member is title-cased', () => {
  const text = allText(buildDigestDoc(SAMPLE, '2026-07-20')).join(' ')
  assert.match(text, /No trainer assigned {2}with Brian Francis: 10 Pack/)
})

test('roster names are tidied and singular/plural labels correct', () => {
  const text = allText(buildDigestDoc(SAMPLE, '2026-07-20')).join(' ')
  assert.match(text, /Daniel Jensen/) // DANIEL JENSEN tidied
  assert.match(text, /5 sales, 0 Day Ones/)
  assert.match(text, /4 sales, 7 Day Ones/)
})

test('clubs appear as H3 groupings, no per-club aggregate stats', () => {
  const doc = buildDigestDoc(SAMPLE, '2026-07-20')
  const h3 = doc.content.filter((n) => n.type === 'heading' && n.attrs.level === 3)
    .map((n) => n.content[0].text)
  // Plain club names only, never "Clackamas (9 sales...)".
  assert.ok(h3.every((label) => !/\d/.test(label)))
  assert.ok(h3.includes('Clackamas'))
})
