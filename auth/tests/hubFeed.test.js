const test = require('node:test')
const assert = require('node:assert/strict')
const { buildFeed } = require('../src/services/hub/feed')

const since = '2026-11-16T12:00:00Z'

test('new tickets: open or in progress, created after launch, not yet opened in the Hub', () => {
  const feed = buildFeed({
    since,
    seenTicketIds: new Set(['t-seen']),
    tickets: [
      { id: 't-new', title: 'Locker repair', status: 'open', created_at: '2026-11-16T13:00:00Z', type_name: 'Facility' },
      { id: 't-old', title: 'Old', status: 'open', created_at: '2026-11-16T11:00:00Z' },
      { id: 't-seen', title: 'Seen', status: 'open', created_at: '2026-11-16T14:00:00Z' },
      { id: 't-done', title: 'Done', status: 'complete', created_at: '2026-11-16T15:00:00Z' },
      { id: 't-wip', title: 'Being worked', status: 'in_progress', created_at: '2026-11-16T12:30:00Z' },
    ],
  })
  assert.deepEqual(feed.map(f => f.ticketId), ['t-new', 't-wip'])
  assert.equal(feed[0].kind, 'ticket')
  assert.match(feed[0].text, /Locker repair/)
})

test('all kinds merge newest first, each pointing at what it opens', () => {
  const feed = buildFeed({
    since, seenTicketIds: new Set(),
    tickets: [{ id: 't1', title: 'iPad broken', status: 'open', created_at: '2026-11-16T13:00:00Z' }],
    items: [{ id: 'i1', at: '2026-11-16T15:00:00Z', person: 'Sam Lee', label: 'Salem Photo', taskId: 'k1', taskTitle: 'Employee of the Month' }],
    replies: [{ personId: 'p1', name: 'Pat Doe', at: '2026-11-16T14:00:00Z', taskId: 'k1', taskTitle: 'Employee of the Month' }],
    tray: [{ personId: 'p2', name: 'Mo Ray', count: 2, at: '2026-11-16T12:30:00Z', taskId: 'k2', taskTitle: 'Holiday promo' }],
  })
  assert.deepEqual(feed.map(f => f.kind), ['deliverable', 'reply', 'ticket', 'tray'])
  assert.equal(feed[0].taskId, 'k1')
  assert.match(feed[0].text, /Sam sent Salem Photo/)
  assert.match(feed[3].text, /2 files from Mo need a slot/)
  assert.equal(new Set(feed.map(f => f.key)).size, 4)
})

test('nothing new gives an empty list', () => {
  assert.deepEqual(buildFeed({ since, seenTicketIds: new Set() }), [])
})

test('an entry with no time sorts last, not first', () => {
  const feed = buildFeed({
    since, seenTicketIds: new Set(),
    replies: [{ personId: 'p1', name: 'Pat Doe', at: null, taskId: 'k1', taskTitle: 'T' }],
    items: [{ id: 'i1', at: '2026-11-16T15:00:00Z', person: 'Sam Lee', label: 'Salem Photo', taskId: 'k1', taskTitle: 'T' }],
  })
  assert.deepEqual(feed.map(f => f.kind), ['deliverable', 'reply'])
})

test('buildFeed: open, unseen suggestions show as "<first name> asked"', () => {
  const out = buildFeed({ suggestions: [
    { id: 's1', from_name: 'Alex Kim', summary: 'Needs approval', received_at: '2026-11-16T10:00:00Z', seen: false },
    { id: 's2', from_name: 'Sam', summary: 'x', received_at: '2026-11-16T09:00:00Z', seen: true },
  ] })
  assert.equal(out.length, 1)
  assert.deepEqual([out[0].key, out[0].kind, out[0].text, out[0].suggestionId], ['suggestion:s1', 'suggestion', 'Alex asked · Needs approval', 's1'])
})
