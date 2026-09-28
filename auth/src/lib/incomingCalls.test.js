const test = require('node:test')
const assert = require('node:assert')
const { last10, createCallQueue, summarizeMatches } = require('./incomingCalls')

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

test('NON-MEMBER records rank below real memberships, even inactive ones', () => {
  const members = [
    { member_id: '1', club_number: '30935', first_name: 'Bot', member_status: 'Active', membership_type: 'NON-MEMBER' },
    { member_id: '2', club_number: '30935', first_name: 'Real', member_status: 'Expired', membership_type: 'SINGLE' },
  ]
  const out = summarizeMatches(members, [], '30935')
  assert.deepStrictEqual(out.map(m => m.name), ['Real', 'Bot'])
  assert.strictEqual(out[1].nonMember, true)
})
