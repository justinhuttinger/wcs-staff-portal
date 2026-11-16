const test = require('node:test')
const assert = require('node:assert/strict')
const {
  planSlots, kindAccepts, newUploadToken, validateUploadTarget, slotLabel, allFilled,
} = require('../src/services/hub/slots')

test('planSlots: no clubs = one null slot; never removes filled', () => {
  assert.deepEqual(planSlots([], []), { add: [null], remove: [] })
  assert.deepEqual(planSlots(['salem'], [{ club: null, filled: true }, { club: 'keizer', filled: false }]),
    { add: ['salem'], remove: ['keizer'] })
})

test('planSlots: clubs removed from a task drop the empty club-less slot too, keep existing ones', () => {
  assert.deepEqual(planSlots(['salem', 'keizer'], [{ club: null, filled: false }, { club: 'salem', filled: true }]),
    { add: ['keizer'], remove: [null] })
  assert.deepEqual(planSlots(['salem'], [{ club: 'salem', filled: false }]), { add: [], remove: [] })
})

test('kindAccepts', () => {
  assert.equal(kindAccepts('image', 'image/jpeg'), true)
  assert.equal(kindAccepts('image', 'application/pdf'), false)
  assert.equal(kindAccepts('file', 'application/pdf'), true)
  assert.equal(kindAccepts('text', 'text/plain'), false)
})

test('newUploadToken is long, url-safe and unique', () => {
  const a = newUploadToken(), b = newUploadToken()
  assert.match(a, /^[A-Za-z0-9_-]{32}$/)
  assert.notEqual(a, b)
})

function stubDb({ taskStatus = 'waiting', slotPerson = 'p1', slotTask = 't1' } = {}) {
  return {
    getToken: async t => (t === 'good' ? { person_id: 'p1' } : null),
    getPerson: async id => (id === 'p1' ? { id: 'p1', task_id: 't1', name: 'Sam' } : null),
    getTask: async id => (id === 't1' ? { id: 't1', status: taskStatus } : null),
    getSlot: async id => (id === 's1' ? { id: 's1', club: 'salem', person_id: slotPerson, deliverable: { id: 'd1', person_id: 'someone-else', task_id: slotTask, kind: 'image', name: 'Photo' } } : null),
  }
}

async function status(promise) {
  try { await promise; return 200 } catch (e) { return e.status }
}

test('validateUploadTarget: unknown token 404, closed task 410, foreign slot 403, good slot ok', async () => {
  assert.equal(await status(validateUploadTarget({ db: stubDb(), token: 'nope', slotId: 's1' })), 404)
  assert.equal(await status(validateUploadTarget({ db: stubDb({ taskStatus: 'done' }), token: 'good', slotId: 's1' })), 410)
  assert.equal(await status(validateUploadTarget({ db: stubDb({ taskStatus: 'dropped' }), token: 'good', slotId: 's1' })), 410)
  assert.equal(await status(validateUploadTarget({ db: stubDb({ slotPerson: 'p2' }), token: 'good', slotId: 's1' })), 403)
  assert.equal(await status(validateUploadTarget({ db: stubDb({ slotTask: 't9' }), token: 'good', slotId: 's1' })), 403)
  assert.equal(await status(validateUploadTarget({ db: stubDb(), token: 'good', slotId: 'zzz' })), 404)
  const ok = await validateUploadTarget({ db: stubDb(), token: 'good', slotId: 's1' })
  assert.equal(ok.person.id, 'p1')
  assert.equal(ok.slot.id, 's1')
})

test('validateUploadTarget without a slot only checks the token and task', async () => {
  const ok = await validateUploadTarget({ db: stubDb(), token: 'good' })
  assert.equal(ok.task.id, 't1')
  assert.equal(await status(validateUploadTarget({ db: stubDb({ taskStatus: 'done' }), token: 'good' })), 410)
})

test('slotLabel names the club when there is one', () => {
  assert.equal(slotLabel({ name: 'Photo' }, 'eugene', { eugene: 'Eugene' }), 'Eugene Photo')
  assert.equal(slotLabel({ name: 'Copy' }, null, {}), 'Copy')
  assert.equal(slotLabel({ name: 'Copy' }, 'gone', {}), 'gone Copy')
})

test('allFilled: true only when there are slots and every one has an item', () => {
  assert.equal(allFilled([]), false)
  assert.equal(allFilled([{ filled: true }, { filled: false }]), false)
  assert.equal(allFilled([{ filled: true }, { filled: true }]), true)
})

test('withUploadLink keeps a draft that has the link, appends it otherwise', () => {
  const { withUploadLink } = require('../src/services/hub/slots')
  const url = 'https://portal.example/upload.html?t=abc'
  assert.equal(withUploadLink(`Hi Sam,\n\nDrop them here: ${url}\n\nJustin`, url), `Hi Sam,\n\nDrop them here: ${url}\n\nJustin`)
  assert.equal(withUploadLink('Hi Sam,\n\nThanks!', url), `Hi Sam,\n\nThanks!\n\nUpload here: ${url}`)
  assert.equal(withUploadLink('Hi', null), 'Hi')
})

test('preValidate rejects before the body is read, and passes the target on', async () => {
  const { preValidate } = require('../src/services/hub/slots')
  const run = async (validate) => {
    const out = {}
    const res = { status(c) { out.status = c; return this }, json(b) { out.body = b; return this } }
    const req = { params: { token: 't', slotId: 's' } }
    await preValidate(validate)(req, res, () => { out.next = true })
    return { ...out, req }
  }
  const bad = await run(async () => { const e = new Error('This link is not valid'); e.status = 404; throw e })
  assert.equal(bad.status, 404)
  assert.equal(bad.next, undefined)
  const good = await run(async () => ({ person: { id: 'p' }, task: { id: 't' }, slot: { id: 's' } }))
  assert.equal(good.next, true)
  assert.equal(good.req.uploadTarget.slot.id, 's')
})

test('chunk splits long id lists so query strings stay short', () => {
  const { chunk } = require('../src/services/hub/slots')
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunk([], 2), [])
})

test('ownerForClub: first-added coverer wins; null club has no auto owner', () => {
  const { ownerForClub } = require('../src/services/hub/slots')
  const people = [{ id: 'b', clubs: ['salem'], created_at: '2026-11-02' }, { id: 'a', clubs: ['salem', 'keizer'], created_at: '2026-11-01' }]
  assert.equal(ownerForClub('salem', people), 'a')
  assert.equal(ownerForClub('eugene', people), null)
  assert.equal(ownerForClub(null, people), null)
})

test('planOwners: automatic slots follow the clubs people cover; hand-set slots never change', () => {
  const { planOwners } = require('../src/services/hub/slots')
  const people = [{ id: 'p-a', clubs: ['salem', 'keizer'], created_at: '1' }, { id: 'p-b', clubs: ['eugene'], created_at: '2' }]
  assert.deepEqual(planOwners([
    { id: 's1', club: 'salem', person_id: null, owner_manual: false },      // unowned -> coverer
    { id: 's2', club: 'keizer', person_id: 'p-b', owner_manual: false },    // auto, wrong person -> moves to p-a
    { id: 's3', club: 'eugene', person_id: 'p-b', owner_manual: false },    // already right -> no update
    { id: 's4', club: 'medford', person_id: 'p-a', owner_manual: false },   // nobody covers -> unassigned
    { id: 's5', club: 'salem', person_id: null, owner_manual: true },       // hand-set unassigned -> stays
    { id: 's6', club: 'keizer', person_id: 'p-b', owner_manual: true },     // hand-set -> stays
    { id: 's7', club: null, person_id: 'p-b', owner_manual: false },        // club-less -> left alone
  ], people), [{ id: 's1', person_id: 'p-a' }, { id: 's2', person_id: 'p-a' }, { id: 's4', person_id: null }])
})

test("personClubsFor: a saved person's clubs narrowed to the task's clubs", () => {
  const { personClubsFor } = require('../src/services/hub/slots')
  assert.deepEqual(personClubsFor(['salem', 'keizer'], ['salem', 'eugene', 'keizer']), ['salem', 'keizer'])
  assert.deepEqual(personClubsFor(['salem', 'keizer'], ['eugene']), [])
  assert.deepEqual(personClubsFor(['salem'], []), ['salem'])
  assert.deepEqual(personClubsFor(null, ['salem']), [])
})
