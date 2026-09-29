const test = require('node:test')
const assert = require('node:assert')
const { memberMessageAlerts, cleanAck } = require('./memberMessageAlerts')

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

test('cleanAck validates initials and shapes the log row', () => {
  const ok = cleanAck({
    memberId: 'AE2270F06F9749D1A9414BE65ABA7F58', club: '30935', initials: ' j.h ', message: 'TEST', note: 'full text',
    memberName: 'Justin H.', staffName: 'Justin N Huttinger', alertId: 'a1', shownAt: '2026-09-29T17:00:00Z',
  })
  assert.strictEqual(ok.value.initials, 'JH')
  assert.strictEqual(ok.value.member_id, 'ae2270f06f9749d1a9414be65aba7f58')
  assert.strictEqual(ok.value.shown_at, '2026-09-29T17:00:00.000Z')
  assert.ok(cleanAck({ memberId: 'x', club: '1', initials: 'JH', message: 'm' }).error)
  assert.ok(cleanAck({ memberId: 'ae2270f06f9749d1a9414be65aba7f58', club: '30935', initials: 'J', message: 'm' }).error)
  assert.ok(cleanAck({ memberId: 'ae2270f06f9749d1a9414be65aba7f58', club: '30935', initials: 'JH', message: '' }).error)
})
