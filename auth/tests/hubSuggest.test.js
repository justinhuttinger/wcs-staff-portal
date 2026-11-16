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

// ---------- runSuggestions ----------
const { runSuggestions } = require('../src/services/hub/suggest')

const b64 = s => Buffer.from(s).toString('base64url')
function mail({ id, thread, at, from = 'Alex Kim <alex@example.com>', to = 'owner@example.com', cc = '', subject = 'Sauna', text = 'Can you fix the sauna?', extra = [] }) {
  const headers = [{ name: 'From', value: from }, { name: 'To', value: to }, { name: 'Subject', value: subject }, ...extra]
  if (cc) headers.push({ name: 'Cc', value: cc })
  return { id, threadId: thread, internalDate: String(at), snippet: text, payload: { mimeType: 'text/plain', headers, body: { data: b64(text) } } }
}

function harness({ cursor = '2026-11-16T10:00:00Z', inbox = [], seen = [], tracked = [], classify, threads = {} } = {}) {
  const state = { cursor, rows: [], seen: new Set(seen), classified: [] }
  let nextId = 1
  const db = {
    getCursor: async () => state.cursor,
    setCursor: async (_o, iso) => { state.cursor = iso },
    seenIds: async (_o, ids) => new Set(ids.filter(i => state.seen.has(i))),
    markSeen: async (_o, ids) => ids.forEach(i => state.seen.add(i)),
    trackedThreads: async () => new Set(tracked),
    muted: async () => new Set(),
    openForThread: async (_o, t) => state.rows.find(r => r.gmail_thread_id === t && r.status === 'open') || null,
    insertSuggestion: async row => { state.rows.push({ id: `s${nextId++}`, ...row }) },
    updateSuggestion: async (id, patch) => Object.assign(state.rows.find(r => r.id === id), patch),
    openEmailSuggestions: async () => state.rows.filter(r => r.status === 'open' && r.source === 'email'),
    context: async () => ({ clubSlugs: ['salem'], categories: [] }),
  }
  const gmail = {
    listInboxSince: async () => inbox.map(m => ({ id: m.id, threadId: m.threadId })),
    getMessageFull: async (_t, id) => inbox.find(m => m.id === id),
    getThread: async (_t, id) => threads[id] || [],
  }
  const cls = classify || (async items => {
    state.classified.push(...items.map(i => i.key))
    return new Map(items.map(i => [i.key, { request: !/fyi/i.test(i.text), summary: `ask: ${i.subject}`, title: i.subject, clubs: ['salem'] }]))
  })
  const run = () => runSuggestions({
    owner: { id: 'o1', email: 'owner@example.com' },
    getToken: async () => ({ accessToken: 't', email: 'owner@example.com' }),
    db, gmail, classify: cls, now: Date.parse('2026-11-16T12:00:00Z'),
  })
  return { state, run, db, gmail }
}

test('runSuggestions: first run only sets the cursor', async () => {
  const h = harness({ cursor: null, inbox: [mail({ id: 'm1', thread: 't1', at: 1 })] })
  const r = await h.run()
  assert.equal(h.state.cursor, '2026-11-16T12:00:00.000Z')
  assert.equal(h.state.rows.length, 0)
  assert.equal(r.scanned, 0)
})

test('runSuggestions: a request becomes one open suggestion with cc and guess', async () => {
  const h = harness({ inbox: [mail({ id: 'm1', thread: 't1', at: Date.parse('2026-11-16T11:00:00Z'), cc: 'b@example.com' })] })
  await h.run()
  assert.equal(h.state.rows.length, 1)
  const s = h.state.rows[0]
  assert.deepEqual([s.status, s.source, s.from_email, s.from_name, s.cc_emails, s.guess.title, s.message_ids, s.received_at],
    ['open', 'email', 'alex@example.com', 'Alex Kim', ['b@example.com'], 'Sauna', ['m1'], '2026-11-16T11:00:00.000Z'])
  assert.equal(h.state.seen.has('m1'), true)
  assert.equal(h.state.cursor, '2026-11-16T12:00:00.000Z')
})

test('runSuggestions: later mail on the thread updates the open suggestion', async () => {
  const h = harness({ inbox: [mail({ id: 'm1', thread: 't1', at: 1000 }), mail({ id: 'm2', thread: 't1', at: 2000, text: 'fyi still broken' })] })
  await h.run()
  assert.equal(h.state.rows.length, 1)
  assert.deepEqual(h.state.rows[0].message_ids, ['m1', 'm2'])
  assert.equal(h.state.rows[0].snippet, 'fyi still broken')
})

test('runSuggestions: a non-request is kept as skipped', async () => {
  const h = harness({ inbox: [mail({ id: 'm1', thread: 't1', at: 1, text: 'FYI only' })] })
  await h.run()
  assert.equal(h.state.rows[0].status, 'skipped')
})

test('runSuggestions: already-seen messages and tracked threads never reach Claude', async () => {
  const h = harness({ seen: ['m1'], tracked: ['t2'], inbox: [mail({ id: 'm1', thread: 't1', at: 1 }), mail({ id: 'm2', thread: 't2', at: 2 })] })
  await h.run()
  assert.deepEqual(h.state.classified, [])
  assert.equal(h.state.rows.length, 0)
  assert.equal(h.state.seen.has('m2'), true)
})

test('runSuggestions: a Claude failure leaves messages unseen and holds the cursor', async () => {
  const at = Date.parse('2026-11-16T11:30:00Z')
  const h = harness({ inbox: [mail({ id: 'm1', thread: 't1', at })], classify: async () => { throw new Error('down') } })
  const r = await h.run()
  assert.equal(h.state.seen.has('m1'), false)
  assert.ok(Date.parse(h.state.cursor) < at)
  assert.equal(r.errors.length, 1)
})

test('runSuggestions: flags "you replied" when the owner answered after the ask', async () => {
  const h = harness({ threads: { t1: [{ internalDate: String(Date.parse('2026-11-16T11:50:00Z')), payload: { headers: [{ name: 'From', value: 'owner@example.com' }] } }] } })
  h.state.rows.push({ id: 's9', status: 'open', source: 'email', gmail_thread_id: 't1', received_at: '2026-11-16T11:00:00Z', you_replied: false })
  await h.run()
  assert.equal(h.state.rows[0].you_replied, true)
})

// ---------- Add: the asker on the thread ----------
const { askerPersonFields } = require('../src/services/hub/suggest')
const { applyReply } = require('../src/services/hub/personState')
const { latestReply } = require('../src/services/followUps/gmail')

test('askerPersonFields: the ask is not a new reply; replies thread under the latest message', () => {
  const msgs = [
    { id: 'm1', internalDate: '1000', payload: { headers: [{ name: 'From', value: 'Alex <alex@example.com>' }, { name: 'Subject', value: 'Sauna' }, { name: 'Message-ID', value: '<a@x>' }] }, snippet: 'heater out' },
    { id: 'm2', internalDate: '2000', payload: { headers: [{ name: 'From', value: 'owner@example.com' }, { name: 'Subject', value: 'Re: Sauna' }, { name: 'Message-ID', value: '<b@x>' }] }, snippet: 'on it' },
  ]
  const s = { from_name: 'Alex', from_email: 'alex@example.com', cc_emails: ['b@example.com'], gmail_thread_id: 't1', subject: 'Sauna' }
  const f = askerPersonFields(s, msgs, 'owner@example.com')
  assert.deepEqual([f.name, f.email, f.cc_emails, f.gmail_thread_id, f.subject, f.first_message_id_header, f.state, f.reply_seen, f.last_reply_at],
    ['Alex', 'alex@example.com', ['b@example.com'], 't1', 'Sauna', '<b@x>', 'replied', true, new Date(1000).toISOString()])
  assert.equal(applyReply(f, latestReply(msgs, 'owner@example.com')), null)
})

// ---------- review fixes ----------
test('runSuggestions: a failed fetch holds the cursor so the mail is listed again', async () => {
  const h = harness({ inbox: [mail({ id: 'm1', thread: 't1', at: Date.parse('2026-11-16T11:00:00Z') })] })
  const orig = h.state.cursor
  // Swap in a failing fetch.
  const run = () => runSuggestions({
    owner: { id: 'o1', email: 'owner@example.com' },
    getToken: async () => ({ accessToken: 't', email: 'owner@example.com' }),
    db: h.db, gmail: { ...h.gmail, getMessageFull: async () => { throw new Error('503') } },
    classify: async () => new Map(), now: Date.parse('2026-11-16T12:00:00Z'),
  })
  const r = await run()
  assert.equal(h.state.cursor, orig)
  assert.equal(h.state.seen.has('m1'), false)
  assert.equal(r.errors.length, 1)
})

test('runSuggestions: a big backlog is worked oldest first, a slice per run, cursor held', async () => {
  const inbox = Array.from({ length: 200 }, (_, i) => mail({ id: `m${i}`, thread: `t${i}`, at: 1000 + i }))
  // Gmail lists newest first.
  const h = harness({ inbox: [...inbox].reverse() })
  const orig = h.state.cursor
  await h.run()
  assert.equal(h.state.rows.length, 150)
  assert.equal(h.state.seen.has('m0'), true)
  assert.equal(h.state.seen.has('m199'), false)
  assert.equal(h.state.cursor, orig)
  await h.run()
  assert.equal(h.state.rows.length, 200)
  assert.equal(h.state.cursor, '2026-11-16T12:00:00.000Z')
})

test('runSuggestions: a database error mid-run still records what was handled', async () => {
  const h = harness({ inbox: [mail({ id: 'm1', thread: 't1', at: 1000, text: 'FYI only' }), mail({ id: 'm2', thread: 't2', at: 2000 })] })
  let n = 0
  const insert = h.db.insertSuggestion
  h.db.insertSuggestion = async row => { if (++n === 2) throw new Error('db down'); return insert(row) }
  await assert.rejects(h.run())
  assert.equal(h.state.seen.has('m1'), true)
  assert.equal(h.state.seen.has('m2'), false)
})

// ---------- texts ----------
const { cleanTextInput, textMergeTarget, hashKey } = require('../src/services/hub/suggest')

test('cleanTextInput: needs text; trims name/text; phone keeps digits and +', () => {
  assert.equal(cleanTextInput({ name: 'Alex', phone: '1', text: '   ' }).error, 'Text is required')
  const c = cleanTextInput({ name: ' Alex ', phone: '+1 (503) 555-0100', text: 'x'.repeat(3000) })
  assert.deepEqual([c.name, c.phone, c.text.length], ['Alex', '+15035550100', 2000])
  assert.equal(cleanTextInput({ text: 'hi' }).name, 'Someone')
})

test('textMergeTarget: same phone within 30 minutes', () => {
  const now = Date.parse('2026-11-16T12:00:00Z')
  const rows = [{ id: 'a', guess: { phone: '+15035550100' }, last_message_at: '2026-11-16T11:31:00Z' }]
  assert.equal(textMergeTarget(rows, '+15035550100', now)?.id, 'a')
  assert.equal(textMergeTarget(rows, '+15035550199', now), null)
  assert.equal(textMergeTarget([{ ...rows[0], last_message_at: '2026-11-16T11:29:00Z' }], '+15035550100', now), null)
  assert.equal(textMergeTarget(rows, '', now), null)
})

test('hashKey: stable sha256 hex', () => {
  assert.equal(hashKey('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('cleanTextInput: names with s keep their letters, line breaks become spaces', () => {
  assert.equal(cleanTextInput({ name: 'Jess\nSmith', text: 'hi' }).name, 'Jess Smith')
})
