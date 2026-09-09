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

const opts = (over = {}) => ({
  contactsById: new Map([contact('c1')]),
  tours: [],
  members: [],
  vipClubs: new Set([SALEM, KEIZER]),
  tourClubs: new Set([SALEM, KEIZER]),
  viewBy: 'club',
  ...over,
})

const row = (out, key) => out.rows.find(r => r.key === key)

// ---------------------------------------------------------------------------
// The funnel
// ---------------------------------------------------------------------------

test('a referral who toured and joined counts at all three steps', () => {
  const out = buildVipAnalysis([credit()], opts({
    tours: [{ ghl_contact_id: 'c1', completed_at: '2026-08-14T18:00:00Z' }],
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

test('a tour BEFORE the referral is not that referral arriving', () => {
  const out = buildVipAnalysis([credit()], opts({
    tours: [{ ghl_contact_id: 'c1', completed_at: '2026-08-02T18:00:00Z' }],
  }))
  assert.strictEqual(row(out, 'salem').cameIn, 0)
})

test('someone who joined BEFORE being referred was not converted by it', () => {
  const out = buildVipAnalysis([credit()], opts({
    members: [member({ since_date: '2026-07-01', sign_date: '2026-07-01' })],
  }))
  assert.strictEqual(row(out, 'salem').signedUp, 0)
})

test('the FIRST tour after the referral is the one that counts', () => {
  const out = buildVipAnalysis([credit()], opts({
    tours: [
      { ghl_contact_id: 'c1', completed_at: '2026-08-01T18:00:00Z' },
      { ghl_contact_id: 'c1', completed_at: '2026-08-12T18:00:00Z' },
    ],
  }))
  // One person who came in once, not two visits and not zero.
  assert.strictEqual(row(out, 'salem').cameIn, 1)
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

test('a club with no tour history withholds Came In but still reports the rest', () => {
  // Tours were not stored at all before the check-in module kept them. Zero
  // there would say nobody visited, which is a claim about our storage.
  const out = buildVipAnalysis([credit()], opts({
    tourClubs: new Set([KEIZER]),
    members: [member()],
  }))
  const r = row(out, 'salem')
  assert.strictEqual(r.cameIn, null)
  assert.strictEqual(r.cameInPct, null)
  assert.strictEqual(r.closedOfVisitsPct, null)
  assert.strictEqual(r.collected, 1)
  assert.strictEqual(r.signedUp, 1)
})

test('the headline come-in rate divides only by clubs that keep tours', () => {
  // Otherwise a club with no tour history drags the rate down for everyone.
  const out = buildVipAnalysis(
    [credit(), credit({ club_number: KEIZER, ghl_contact_id: 'c2' })],
    opts({
      contactsById: new Map([contact('c1'), contact('c2')]),
      tourClubs: new Set([KEIZER]),
      tours: [{ ghl_contact_id: 'c2', completed_at: '2026-08-14T18:00:00Z' }],
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
