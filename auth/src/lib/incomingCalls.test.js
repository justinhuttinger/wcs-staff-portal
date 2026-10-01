const test = require('node:test')
const assert = require('node:assert')
const { last10, callerNumber, createCallQueue, summarizeMatches, cleanEnquiry } = require('./incomingCalls')

test('last10 normalizes GHL and ABC phone formats', () => {
  assert.strictEqual(last10('(425) 954-9854'), '4259549854')
  assert.strictEqual(last10('+14259549854'), '4259549854')
  assert.strictEqual(last10('425-954'), null)
  assert.strictEqual(last10(null), null)
})

test('queue hands each club only its own calls, newer than the cursor', () => {
  const q = createCallQueue()
  const a = q.push('30935', { name: 'A' })
  q.push('31599', { name: 'B' })
  const c = q.push('30935', { name: 'C' })
  assert.deepStrictEqual(q.since('30935').map(x => x.name), ['A', 'C'])
  assert.deepStrictEqual(q.since('30935', a.id).map(x => x.name), ['C'])
  assert.deepStrictEqual(q.since('30935', c.id), [])
  assert.deepStrictEqual(q.since('7655'), [])
})

test('queue drops calls older than the TTL', () => {
  let t = 1000
  const q = createCallQueue({ ttlMs: 100, now: () => t })
  q.push('30935', { name: 'old' })
  t += 150
  q.push('30935', { name: 'new' })
  assert.deepStrictEqual(q.since('30935').map(x => x.name), ['new'])
})

test('summarizeMatches puts active, home-club members first and flags PT', () => {
  const members = [
    { member_id: '1', club_number: '31599', first_name: 'Old', last_name: 'Keizer', member_status: 'Cancelled' },
    { member_id: '2', club_number: '31599', first_name: 'Act', last_name: 'Keizer', member_status: 'Active' },
    { member_id: '3', club_number: '30935', first_name: 'Act', last_name: 'Salem', member_status: 'Active', is_past_due: true },
  ]
  const pt = [{ club_number: '31599', member_id: '2', trainer_name: 'Kirstyn' }]
  const out = summarizeMatches(members, pt, '30935')
  assert.deepStrictEqual(out.map(m => m.name), ['Act Salem', 'Act Keizer', 'Old Keizer'])
  assert.strictEqual(out[0].pastDue, true)
  assert.strictEqual(out[1].ptClient, true)
  assert.strictEqual(out[1].ptTrainer, 'Kirstyn')
  assert.strictEqual(out[2].active, false)
})

test('active accounts always come first; among active, real memberships beat NON-MEMBER', () => {
  const members = [
    { member_id: '1', club_number: '30935', first_name: 'Old', member_status: 'Expired', membership_type: 'SINGLE' },
    { member_id: '2', club_number: '30935', first_name: 'Bot', member_status: 'Active', membership_type: 'NON-MEMBER' },
    { member_id: '3', club_number: '31599', first_name: 'Real', member_status: 'Active', membership_type: 'SINGLE' },
  ]
  const out = summarizeMatches(members, [], '30935')
  assert.deepStrictEqual(out.map(m => m.name), ['Real', 'Bot', 'Old'])
  assert.strictEqual(out[1].nonMember, true)

  // No active membership: the active NON-MEMBER record outranks an expired one.
  const out2 = summarizeMatches(members.slice(0, 2), [], '30935')
  assert.deepStrictEqual(out2.map(m => m.name), ['Bot', 'Old'])
})

test('recentCall only returns a call this club got within the enquiry window', () => {
  let t = 0
  const q = createCallQueue({ now: () => t })
  const c = q.push('30935', { ghlContactId: 'abc' })
  assert.strictEqual(q.recentCall('30935', c.id).ghlContactId, 'abc')
  assert.strictEqual(q.recentCall('31599', c.id), null)
  assert.strictEqual(q.recentCall('30935', 999), null)
  t += 30 * 60 * 1000
  assert.ok(q.recentCall('30935', c.id), 'still inside the hour, though gone from the poll queue')
  assert.deepStrictEqual(q.since('30935'), [])
  t += 31 * 60 * 1000
  assert.strictEqual(q.recentCall('30935', c.id), null)
})

test('cleanEnquiry trims, lowercases email, and rejects bad input', () => {
  assert.deepStrictEqual(cleanEnquiry({ firstName: ' Ann ', lastName: 'Lee', email: 'A@B.com ' }).value,
    { firstName: 'Ann', lastName: 'Lee', email: 'a@b.com' })
  assert.ok(cleanEnquiry({ firstName: '', email: '' }).error)
  assert.ok(cleanEnquiry({ firstName: 'Ann', email: 'nope' }).error)
  assert.ok(cleanEnquiry({ firstName: 'Ann', email: '' }).value)
})

test('callerNumber reads the number out of whatever a desk phone sends', () => {
  assert.strictEqual(callerNumber('5035551212'), '5035551212')
  assert.strictEqual(callerNumber('+15035551212'), '5035551212')
  assert.strictEqual(callerNumber('sip:5035551212@10.0.0.5'), '5035551212')
  assert.strictEqual(callerNumber('"Jane" <sip:+15035551212@pbx.example.com:5060>'), '5035551212')
  assert.strictEqual(callerNumber('5035551212@192.168.10.200'), '5035551212')
  assert.strictEqual(callerNumber('sip:204@192.168.10.200'), null)
  assert.strictEqual(callerNumber('anonymous'), null)
  assert.strictEqual(callerNumber(undefined), null)
})

test('findByPhone finds the same caller at the same club only inside the window', () => {
  let t = 1000
  const q = createCallQueue({ now: () => t })
  const a = q.push('30935', { phone: '+15035551212' })
  q.push('30935', { phone: '+15035550000' })
  assert.strictEqual(q.findByPhone('30935', '5035551212', 500).id, a.id)
  assert.strictEqual(q.findByPhone('31599', '5035551212', 500), null)
  assert.strictEqual(q.findByPhone('30935', null, 500), null)
  t += 600
  assert.strictEqual(q.findByPhone('30935', '5035551212', 500), null)
})
