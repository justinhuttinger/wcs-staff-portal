const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { parseQaItems } = require('./operandioEmailAudit')

const fx = name => fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8')

test('captures every item, including ones that carry an auditor note', () => {
  const items = parseQaItems(fx('qa-cleaning-email-rows.html'))
  // Regression: noted items used to be dropped entirely (regex didn't allow the
  // extra note <div>), so a 4-item table parsed as 2. All four must survive now.
  assert.equal(items.length, 4)
  assert.deepEqual(items.map(i => i.n), [1, 2, 3, 4])
  assert.deepEqual(items.map(i => i.name), [
    'Lobby-Windows',
    'Lobby-Floors',
    'Locker Rooms-Sinks & Counters',
    'Gym-Floors',
  ])
  assert.deepEqual(items.map(i => i.score), [7, 9, 5, 9])
})

test('transcribes the note text for noted items', () => {
  const items = parseQaItems(fx('qa-cleaning-email-rows.html'))
  assert.equal(items[0].note, 'Glass with smudges by pool')
})

test('decodes HTML entities and strips the curly quotes from notes', () => {
  const items = parseQaItems(fx('qa-cleaning-email-rows.html'))
  assert.equal(items[2].note, "Soap scum & member's towels left out")
})

test('leaves note null when the auditor did not add one', () => {
  const items = parseQaItems(fx('qa-cleaning-email-rows.html'))
  assert.equal(items[1].note, null)
  assert.equal(items[3].note, null)
})

test('still parses scorer and timestamp', () => {
  const items = parseQaItems(fx('qa-cleaning-email-rows.html'))
  assert.equal(items[0].by, 'JC Engdahl')
  assert.equal(items[0].at, 'Jun 17, 2026 10:20AM PDT')
})

test('returns null for empty / non-matching input', () => {
  assert.equal(parseQaItems(''), null)
  assert.equal(parseQaItems('<p>nothing here</p>'), null)
})

test('handles verbatim real email rows, incl. consecutive noted rows', () => {
  // Rows 16-20 copied byte-for-byte from a real Springfield QA-Cleaning email.
  const items = parseQaItems(fx('qa-cleaning-email-real-rows.html'))
  assert.equal(items.length, 5)
  assert.deepEqual(items.map(i => i.n), [16, 17, 18, 19, 20])
  assert.deepEqual(items.map(i => i.score), [7, 8, 8, 9, 9])
  assert.deepEqual(items.map(i => i.note), [
    'Dusty high and dust bunnies inside towers',
    'Not Dusty but could use spray and deep cleaning',
    'Small tape repair',
    null,
    null,
  ])
})
