const test = require('node:test')
const assert = require('node:assert')
const { buildVipAnalysis } = require('./vipAnalysis')

// Salem 30935, Keizer 31599, Milwaukie 31601 (the club with no VIP setup).
const SALEM = '30935'
const KEIZER = '31599'
const MILWAUKIE = '31601'

const credit = (over = {}) => ({
  ghl_contact_id: 'c1',
  club_number: SALEM,
  employee_name: 'Sam Seller',
  credited_at: '2026-08-10T17:00:00Z',
  ...over,
})

const contact = (id, over = {}) => [id, {
  id, email: `${id}@x.com`, phone: '5551234567',
  first_name: 'Pat', last_name: 'Prospect', ...over,
}]

const member = (over = {}) => ({
  id: 'm1', club_number: SALEM, since_date: '2026-08-20', sign_date: '2026-08-20',
  email: 'c1@x.com', primary_phone: null, mobile_phone: null,
  first_name: 'Pat', last_name: 'Prospect', ...over,
})

// `reached` is contact id -> the day each pipeline stage was reached.
const reach = (pairs) => new Map(pairs)

const opts = (over = {}) => ({
  contactsById: new Map([contact('c1')]),
  reached: new Map(),
  members: [],
  vipClubs: new Set([SALEM, KEIZER]),
  trialClubs: new Set([SALEM, KEIZER]),
  passClubs: new Set([SALEM, KEIZER]),
  viewBy: 'club',
  ...over,
})

const row = (out, key) => out.rows.find(r => r.key === key)

// ---------------------------------------------------------------------------
// The funnel
// ---------------------------------------------------------------------------

test('a referral who started a trial and joined counts at all three steps', () => {
  const out = buildVipAnalysis([credit()], opts({
    reached: reach([['c1', { trial: '2026-08-14', pass: null }]]),
    members: [member()],
  }))
  const r = row(out, 'salem')
  assert.strictEqual(r.collected, 1)
  assert.strictEqual(r.cameIn, 1)
  assert.strictEqual(r.signedUp, 1)
  assert.strictEqual(r.cameInPct, 100)
  assert.strictEqual(r.closedOfVisitsPct, 100)
})

test('a referral who never came in is collected only', () => {
  const out = buildVipAnalysis([credit()], opts())
  const r = row(out, 'salem')
  assert.strictEqual(r.collected, 1)
  assert.strictEqual(r.cameIn, 0)
  assert.strictEqual(r.signedUp, 0)
})

// ---------------------------------------------------------------------------
// Ordering. Without it, an existing member referred by a friend scores a
// conversion on the day they were referred, which is exactly backwards.
// ---------------------------------------------------------------------------

test('a stage reached BEFORE the referral is not that referral arriving', () => {
  const out = buildVipAnalysis([credit()], opts({
    reached: reach([['c1', { trial: '2026-08-02', pass: null }]]),
  }))
  assert.strictEqual(row(out, 'salem').cameIn, 0)
})

test('Pass Redeemed is counted in its own column, not folded into Came In', () => {
  // The two disagree by club — Medford records trial starts and no redemptions,
  // Eugene the reverse — so neither is allowed to stand in for the other.
  const out = buildVipAnalysis([credit()], opts({
    reached: reach([['c1', { trial: null, pass: '2026-08-14' }]]),
  }))
  const r = row(out, 'salem')
  assert.strictEqual(r.cameIn, 0)
  assert.strictEqual(r.passRedeemed, 1)
})

test('someone who joined BEFORE being referred was not converted by it', () => {
  const out = buildVipAnalysis([credit()], opts({
    members: [member({ since_date: '2026-07-01', sign_date: '2026-07-01' })],
  }))
  assert.strictEqual(row(out, 'salem').signedUp, 0)
})

// ---------------------------------------------------------------------------
// Not configured is not zero
// ---------------------------------------------------------------------------

test('a club that has never credited a VIP is withheld, not zeroed', () => {
  const out = buildVipAnalysis([credit({ club_number: MILWAUKIE, ghl_contact_id: 'c9' })], opts({
    contactsById: new Map([contact('c9')]),
  }))
  const r = row(out, 'milwaukie')
  assert.strictEqual(r.collected, null)
  assert.strictEqual(r.signedUp, null)
  assert.strictEqual(r.signedUpPct, null)
})

test('a club whose GHL has no Trial Started stage withholds Came In', () => {
  // Zero there would say nobody came in, which is a claim about the staff when
  // the truth is a claim about that club's pipelines.
  const out = buildVipAnalysis([credit()], opts({
    trialClubs: new Set([KEIZER]),
    members: [member()],
  }))
  const r = row(out, 'salem')
  assert.strictEqual(r.cameIn, null)
  assert.strictEqual(r.cameInPct, null)
  assert.strictEqual(r.closedOfVisitsPct, null)
  assert.strictEqual(r.collected, 1)
  assert.strictEqual(r.signedUp, 1)
})

test('the headline came-in rate divides only by clubs that have the stage', () => {
  // Otherwise a club whose GHL lacks it drags the rate down for everyone.
  const out = buildVipAnalysis(
    [credit(), credit({ club_number: KEIZER, ghl_contact_id: 'c2' })],
    opts({
      contactsById: new Map([contact('c1'), contact('c2')]),
      trialClubs: new Set([KEIZER]),
      reached: reach([['c2', { trial: '2026-08-14', pass: null }]]),
    }),
  )
  assert.strictEqual(out.summary.collected, 2)
  assert.strictEqual(out.summary.cameIn, 1)
  // 1 of the 1 collected at a tour-keeping club, not 1 of 2.
  assert.strictEqual(out.summary.cameInPct, 100)
})

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

test('by collector, one person spanning two clubs is one row', () => {
  const out = buildVipAnalysis(
    [credit(), credit({ club_number: KEIZER, ghl_contact_id: 'c2' })],
    opts({ contactsById: new Map([contact('c1'), contact('c2')]), viewBy: 'collector' }),
  )
  assert.strictEqual(out.rows.length, 1)
  assert.strictEqual(out.rows[0].label, 'Sam Seller')
  assert.strictEqual(out.rows[0].collected, 2)
})

test('a credit with no employee on it is Not Assigned, not a person called Unknown', () => {
  const out = buildVipAnalysis([credit({ employee_name: '' })], opts({ viewBy: 'collector' }))
  assert.strictEqual(out.rows[0].label, 'Not Assigned')
})

test('a credit against a club outside the report is not folded into another row', () => {
  const out = buildVipAnalysis([credit({ club_number: '99999' })], opts())
  assert.strictEqual(out.rows.length, 0)
  assert.strictEqual(out.hasActivity, false)
})
