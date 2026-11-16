const test = require('node:test')
const assert = require('node:assert/strict')
const { runCheck } = require('../src/services/hub/check')

const OWNER = { id: 'owner', email: 'staff-login@example.org' }
const GMAIL_ADDR = 'owner-gmail@example.org'

function fakeDb({ people = [], slots = [], pending = [] } = {}) {
  const writes = []
  const seen = new Set()
  return {
    writes, seen,
    listOpenPeople: async () => people,
    knownKeys: async () => new Set(seen),
    markSeen: async (personId, key) => { writes.push(['seen', key]); seen.add(key) },
    openSlots: async () => slots,
    pendingTray: async () => pending,
    updatePerson: async (id, patch) => { writes.push(['updatePerson', id, patch]) },
    fileAttachment: async (args) => { writes.push(['file', args.slotId, args.att.partId]) },
    trayAttachment: async (args) => { writes.push(['tray', args.att.partId, !!args.bytes, !!args.tooLarge]) },
    refreshDelivered: async () => { writes.push(['refresh']) },
  }
}

let fetchCount = 0
function msg(id, from, at, atts = []) {
  return {
    id, internalDate: String(at), snippet: `${id} text`,
    payload: {
      mimeType: 'multipart/mixed',
      headers: [{ name: 'From', value: from }],
      parts: atts.map(a => ({
        partId: a.part, mimeType: a.mime, filename: a.name,
        headers: [{ name: 'Content-Disposition', value: 'attachment' }],
        // Gmail hands out a different attachmentId on every fetch.
        body: { attachmentId: `${a.part}-fetch${fetchCount}`, size: a.size },
      })),
    },
  }
}

function fakeGmail(build, { failDownloadAfter = Infinity } = {}) {
  const { latestReply, listAttachments, emailFrom, headerValue } = require('../src/services/followUps/gmail')
  let downloads = 0
  return {
    latestReply, listAttachments, emailFrom, headerValue,
    getThreadFull: async () => { fetchCount++; return build() },
    getAttachment: async () => {
      downloads++
      if (downloads > failDownloadAfter) { const e = new Error('revoked'); e.notConnected = true; throw e }
      return Buffer.from('bytes')
    },
  }
}

const person = { id: 'p1', task_id: 't1', gmail_thread_id: 'th1', last_reply_at: null, state: 'waiting' }
const task = { id: 't1', status: 'waiting' }
const token = async () => ({ accessToken: 'x', email: GMAIL_ADDR })
const sam = 'Sam <sam@x.co>'

test('runCheck stops cleanly when Gmail is disconnected', async () => {
  const db = fakeDb({ people: [{ person, task }] })
  const r = await runCheck({ owner: OWNER, db, gmail: fakeGmail(() => []),
    getToken: async () => { const e = new Error('x'); e.notConnected = true; throw e } })
  assert.deepEqual(r.errors, ['gmail_not_connected'])
  assert.equal(db.writes.length, 0)
})

test('runCheck flags the reply and auto-files the one photo into the one open slot', async () => {
  const db = fakeDb({ people: [{ person, task }], slots: [{ id: 's1', kind: 'image', label: 'Eugene Photo' }] })
  const g = fakeGmail(() => [msg('m0', `Owner <${GMAIL_ADDR}>`, 1000), msg('m1', sam, 2000, [{ part: '1', name: 'eugene.jpg', mime: 'image/jpeg', size: 900000 }])])
  const r = await runCheck({ owner: OWNER, db, gmail: g, getToken: token })
  assert.equal(r.replies, 1)
  assert.equal(r.filed, 1)
  assert.deepEqual(db.writes.find(w => w[0] === 'file'), ['file', 's1', '1'])
})

test('runCheck does not duplicate an attachment whose Gmail id changes between runs', async () => {
  const db = fakeDb({ people: [{ person, task }], slots: [{ id: 's1', kind: 'image' }, { id: 's2', kind: 'image' }] })
  const g = fakeGmail(() => [msg('m1', sam, 2000, [{ part: '1', name: 'a.jpg', mime: 'image/jpeg', size: 900000 }])])
  const args = { owner: OWNER, db, gmail: g, getToken: token }
  await runCheck(args)
  await runCheck(args)
  assert.equal(db.writes.filter(w => w[0] === 'tray' || w[0] === 'file').length, 1)
})

test('a discarded or deleted item stays gone: seen keys outlive the rows', async () => {
  const db = fakeDb({ people: [{ person, task }], slots: [{ id: 's1', kind: 'image' }] })
  const g = fakeGmail(() => [msg('m1', sam, 2000, [{ part: '1', name: 'a.jpg', mime: 'image/jpeg', size: 900000 }])])
  await runCheck({ owner: OWNER, db, gmail: g, getToken: token })
  assert.ok(db.seen.has('m1:1'))
  await runCheck({ owner: OWNER, db, gmail: g, getToken: token })
  assert.equal(db.writes.filter(w => w[0] === 'file' || w[0] === 'tray').length, 1)
})

test('the connected Gmail address is the owner: his mail is neither a reply nor an attachment', async () => {
  const db = fakeDb({ people: [{ person, task }], slots: [{ id: 's1', kind: 'image' }] })
  const g = fakeGmail(() => [msg('m1', `Owner <${GMAIL_ADDR}>`, 2000, [{ part: '1', name: 'a.jpg', mime: 'image/jpeg', size: 900000 }])])
  const r = await runCheck({ owner: OWNER, db, gmail: g, getToken: token })
  assert.equal(r.replies, 0)
  assert.equal(r.filed + r.trayed, 0)
})

test('an attachment over 25 MB is not downloaded; it goes to the tray as too large, once', async () => {
  const db = fakeDb({ people: [{ person, task }], slots: [{ id: 's1', kind: 'file' }] })
  const g = fakeGmail(() => [msg('m1', sam, 2000, [{ part: '1', name: 'video.mov', mime: 'video/quicktime', size: 40 * 1024 * 1024 }])], { failDownloadAfter: 0 })
  await runCheck({ owner: OWNER, db, gmail: g, getToken: token })
  await runCheck({ owner: OWNER, db, gmail: g, getToken: token })
  const trays = db.writes.filter(w => w[0] === 'tray')
  assert.deepEqual(trays, [['tray', '1', false, true]])
  assert.equal(db.writes.some(w => w[0] === 'file'), false)
})

test('delivered is refreshed right after auto-filing, even if Gmail drops during the tray downloads', async () => {
  // b.png can only go in s3 (auto); a.pdf fits no open slot (tray). The second download fails.
  const db = fakeDb({ people: [{ person, task }], slots: [{ id: 's3', kind: 'image' }] })
  const g = fakeGmail(() => [msg('m1', sam, 2000, [
    { part: '1', name: 'a.pdf', mime: 'application/pdf', size: 1000 },
    { part: '2', name: 'b.png', mime: 'image/png', size: 900000 },
  ])], { failDownloadAfter: 1 })
  const r = await runCheck({ owner: OWNER, db, gmail: g, getToken: token })
  assert.deepEqual(r.errors, ['gmail_not_connected'])
  assert.ok(db.writes.some(w => w[0] === 'refresh'))
})
