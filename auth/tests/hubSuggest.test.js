const test = require('node:test')
const assert = require('node:assert/strict')
const { isAutomated, prefilter, cleanGuess, mergeAction, ownerRepliedAfter, recipientsToCc } = require('../src/services/hub/suggest')

test('isAutomated: bulk/list/no-reply mail', () => {
  assert.equal(isAutomated([{ name: 'List-Unsubscribe', value: '<mailto:x>' }]), true)
  assert.equal(isAutomated([{ name: 'Precedence', value: 'bulk' }]), true)
  assert.equal(isAutomated([{ name: 'Auto-Submitted', value: 'auto-generated' }]), true)
  assert.equal(isAutomated([{ name: 'From', value: 'Shop <no-reply@shop.example>' }]), true)
  assert.equal(isAutomated([{ name: 'From', value: 'Alex <alex@example.com>' }]), false)
  assert.equal(isAutomated([{ name: 'Auto-Submitted', value: 'no' }, { name: 'From', value: 'alex@example.com' }]), false)
})

test('prefilter: own, tracked thread, muted, automated, else null', () => {
  const base = { id: 'm1', threadId: 't1', headers: [{ name: 'From', value: 'Alex <alex@example.com>' }] }
  const ctx = { ownerEmail: 'owner@example.com', trackedThreads: new Set(), muted: new Set() }
  assert.equal(prefilter(base, ctx), null)
  assert.equal(prefilter({ ...base, headers: [{ name: 'From', value: 'owner@example.com' }] }, ctx), 'own')
  assert.equal(prefilter(base, { ...ctx, trackedThreads: new Set(['t1']) }), 'tracked')
  assert.equal(prefilter(base, { ...ctx, muted: new Set(['alex@example.com']) }), 'muted')
  assert.equal(prefilter({ ...base, headers: [...base.headers, { name: 'List-Id', value: 'x' }] }, ctx), 'automated')
})

test('cleanGuess drops unknown clubs/category, bad dates, trims text', () => {
  const g = cleanGuess({ request: true, summary: 'x'.repeat(500), title: ' Fix sauna ', description: 'd', due_date: '2026-13-40', clubs: ['salem', 'nope'], category: 'Facilities' },
    { clubSlugs: ['salem'], categories: [{ id: 'c1', name: 'facilities' }] })
  assert.deepEqual([g.request, g.title, g.due_date, g.clubs, g.category_id, g.summary.length], [true, 'Fix sauna', null, ['salem'], 'c1', 300])
  assert.equal(cleanGuess({ request: true, due_date: '2026-11-20' }, { clubSlugs: [], categories: [] }).due_date, '2026-11-20')
  assert.equal(cleanGuess(null, { clubSlugs: [], categories: [] }).request, false)
})

test('mergeAction: one open suggestion per thread', () => {
  assert.equal(mergeAction({ id: 's1' }, false), 'update')
  assert.equal(mergeAction({ id: 's1' }, true), 'update')
  assert.equal(mergeAction(null, true), 'create')
  assert.equal(mergeAction(null, false), 'skip')
})

test('ownerRepliedAfter', () => {
  const msgs = [{ internalDate: '1000', payload: { headers: [{ name: 'From', value: 'owner@example.com' }] } }]
  assert.equal(ownerRepliedAfter(msgs, 'owner@example.com', 500), true)
  assert.equal(ownerRepliedAfter(msgs, 'owner@example.com', 1500), false)
})

test('recipientsToCc: To+Cc minus owner and sender', () => {
  const h = [{ name: 'To', value: 'owner@example.com, "B, Person" <b@example.com>' }, { name: 'Cc', value: 'c@example.com, alex@example.com, C@example.com' }]
  assert.deepEqual(recipientsToCc(h, { ownerEmail: 'owner@example.com', senderEmail: 'alex@example.com' }), ['b@example.com', 'c@example.com'])
})
