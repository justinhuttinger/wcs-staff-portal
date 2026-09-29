const test = require('node:test')
const assert = require('node:assert')
const { memberMessageAlerts } = require('./memberMessageAlerts')

test('keeps only staff-typed Member Message Alerts, with the full note', () => {
  // Shape from the live ABC API (barcode "huttinger", 2026-09-29).
  const member = {
    alerts: [
      { message: 'CLUB ACCOUNT OVERDUE 257 DAYS', abcCode: 'Club Account Overdue Alert', priority: '10' },
      { alertId: 'abc', message: 'TEST', text: 'TEST', note: 'Talk to Justin before check-in', color: 'Purple',
        sound: 'Has Message', abcCode: 'Member Message Alert', priority: '99' },
      { message: 'NEED PHOTO', abcCode: 'Need Photo' },
    ],
  }
  assert.deepStrictEqual(memberMessageAlerts(member), [
    { alertId: 'abc', message: 'TEST', note: 'Talk to Justin before check-in', color: 'Purple' },
  ])
})

test('no alerts, or empty messages, give an empty list', () => {
  assert.deepStrictEqual(memberMessageAlerts({}), [])
  assert.deepStrictEqual(memberMessageAlerts(null), [])
  assert.deepStrictEqual(memberMessageAlerts({ alerts: [{ abcCode: 'Member Message Alert', message: ' ', note: '' }] }), [])
})
