const test = require('node:test')
const assert = require('node:assert/strict')
const { CHECK_META, COVERAGE_KEY, formatReport, formatSms, failures } = require('./dayOneIntegrity')

const clean = Object.keys(CHECK_META).map(key => ({ key, count: 0 }))
  .concat([{ key: COVERAGE_KEY, count: 0 }])

test('says nothing when every check is clean', () => {
  // A job that reports "all fine" every week is one people stop opening, and
  // then it is silent at the moment it matters.
  assert.equal(formatReport(clean), null)
  assert.deepEqual(failures(clean), [])
})

test('a data-entry gap alone is not a failure', () => {
  // Day Ones that passed unrecorded mean a human did not fill the form in. The
  // data is correct, so this must never trip the alert on its own.
  const rows = clean.map(r => r.key === COVERAGE_KEY ? { ...r, count: 12 } : r)
  assert.equal(formatReport(rows), null)
  assert.deepEqual(failures(rows), [])
})

test('a real failure names the count and a likely cause', () => {
  const rows = clean.map(r => r.key === 'phantom_calendars' ? { ...r, count: 3 } : r)
  const text = formatReport(rows)
  assert.match(text, /not a Day One calendar/)
  assert.match(text, /3/)
  assert.match(text, /likely cause/)
  assert.match(text, /scoped to the Day One calendar/)
})

test('the data-entry gap rides along once something else has failed', () => {
  const rows = clean.map(r =>
    r.key === 'orphan_rows' ? { ...r, count: 2 } :
    r.key === COVERAGE_KEY ? { ...r, count: 5 } : r)
  const text = formatReport(rows)
  assert.match(text, /no GHL appointment id/)
  assert.match(text, /5 Day Ones in the last 14 days/)
  assert.match(text, /not a fault/)
})

test('several failures are all reported, not just the first', () => {
  const rows = clean.map(r =>
    ['orphan_rows', 'duplicate_appointment_id', 'missing_scheduled_date'].includes(r.key)
      ? { ...r, count: 1 } : r)
  assert.equal(failures(rows).length, 3)
})

test('an unknown key from the database is ignored rather than crashing', () => {
  const rows = clean.concat([{ key: 'something_new', count: 99 }])
  assert.equal(formatReport(rows), null)
  assert.deepEqual(failures(rows), [])
})

test('string counts from the driver are handled', () => {
  const rows = clean.map(r => r.key === 'orphan_rows' ? { ...r, count: '4' } : r)
  assert.equal(failures(rows)[0].count, 4)
})

test('no rows at all does not throw', () => {
  assert.equal(formatReport([]), null)
  assert.equal(formatReport(null), null)
  assert.deepEqual(failures(null), [])
})

test('every check has a label and a cause', () => {
  for (const [key, meta] of Object.entries(CHECK_META)) {
    assert.ok(meta.label, key + ' needs a label')
    assert.ok(meta.why, key + ' needs a likely cause, or an alert is just a number')
  }
})

// --- the SMS form ----------------------------------------------------------

test('says nothing by SMS when clean', () => {
  assert.equal(formatSms(clean), null)
})

test('a data-entry gap alone never sends a text', () => {
  const rows = clean.map(r => r.key === COVERAGE_KEY ? { ...r, count: 40 } : r)
  assert.equal(formatSms(rows), null)
})

test('the SMS is short enough to read on a lock screen', () => {
  // Every check failing at once is the worst case; it still has to be readable.
  const rows = Object.keys(CHECK_META).map(key => ({ key, count: 9 }))
  const sms = formatSms(rows)
  assert.ok(sms.length < 320, `SMS was ${sms.length} chars: ${sms}`)
  assert.match(sms, /^Day One data check FAILED/)
  assert.match(sms, /dayOneIntegrity/)
})

test('the SMS names each failing check and its count', () => {
  const rows = clean.map(r =>
    r.key === 'orphan_rows' ? { ...r, count: 2 } :
    r.key === 'phantom_calendars' ? { ...r, count: 3 } : r)
  const sms = formatSms(rows)
  assert.match(sms, /2 orphan rows/)
  assert.match(sms, /3 wrong calendar/)
})

test('every check has a short label, or the SMS falls back to a raw key', () => {
  for (const [key, meta] of Object.entries(CHECK_META)) {
    assert.ok(meta.short, key + ' needs a short label for the SMS')
    assert.ok(meta.short.length <= 20, key + ' short label is too long for a text')
  }
})
