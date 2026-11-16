const test = require('node:test')
const assert = require('node:assert/strict')
const { runCheck } = require('../src/services/hub/check')

const OWNER = { id: 'owner', email: 'owner@example.org' }

function fakeDb({ people = [], slots = [], known = [] } = {}) {
  const writes = []
  const knownKeys = new Set(known)
  return {
    writes,
    listOpenPeople: async () => people,
    knownKeys: async () => new Set(knownKeys),
    openSlots: async () => slots,
    updatePerson: async (id, patch) => { writes.push(['updatePerson', id, patch]) },
    fileAttachment: async (args) => { writes.push(['file', args.slotId, args.att.attachmentId]); knownKeys.add(`${args.messageId}:${args.att.attachmentId}`) },
    trayAttachment: async (args) => { writes.push(['tray', args.att.attachmentId]); knownKeys.add(`${args.messageId}:${args.att.attachmentId}`) },
    refreshDelivered: async () => {},
  }
}

function msg(id, from, at, atts = []) {
  return {
    id, internalDate: String(at), snippet: `${id} text`,
    payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: from }], parts: atts.map(a => ({
      mimeType: a.mime, filename: a.name, headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { attachmentId: a.id, size: a.size },
    })) },
  }
}

function fakeGmail(messages) {
  const { latestReply, listAttachments } = require('../src/services/followUps/gmail')
  return {
    latestReply, listAttachments,
    getThreadFull: async () => messages,
    getAttachment: async () => Buffer.from('bytes'),
  }
}

const person = { id: 'p1', task_id: 't1', gmail_thread_id: 'th1', last_reply_at: null, state: 'waiting' }
const task = { id: 't1', status: 'waiting' }

test('runCheck stops cleanly when Gmail is disconnected', async () => {
  const db = fakeDb({ people: [{ person, task }] })
  const r = await runCheck({
    owner: OWNER, db, gmail: fakeGmail([]),
    getToken: async () => { const e = new Error('x'); e.notConnected = true; throw e },
  })
  assert.deepEqual(r.errors, ['gmail_not_connected'])
  assert.equal(db.writes.length, 0)
})

test('runCheck flags the reply and auto-files the one photo into the one open slot', async () => {
  const db = fakeDb({ people: [{ person, task }], slots: [{ id: 's1', kind: 'image', label: 'Eugene Photo' }] })
  const messages = [
    msg('m0', `Owner <${OWNER.email}>`, 1000),
    msg('m1', 'Sam <sam@x.co>', 2000, [{ id: 'A1', name: 'eugene.jpg', mime: 'image/jpeg', size: 900000 }]),
  ]
  const r = await runCheck({ owner: OWNER, db, gmail: fakeGmail(messages), getToken: async () => ({ accessToken: 'x' }) })
  assert.equal(r.replies, 1)
  assert.equal(r.filed, 1)
  assert.deepEqual(db.writes.find(w => w[0] === 'file'), ['file', 's1', 'A1'])
})

test('runCheck does not duplicate an attachment seen twice', async () => {
  const db = fakeDb({ people: [{ person, task }], slots: [{ id: 's1', kind: 'image' }, { id: 's2', kind: 'image' }] })
  const messages = [msg('m1', 'Sam <sam@x.co>', 2000, [{ id: 'A1', name: 'a.jpg', mime: 'image/jpeg', size: 900000 }])]
  const args = { owner: OWNER, db, gmail: fakeGmail(messages), getToken: async () => ({ accessToken: 'x' }) }
  await runCheck(args)
  await runCheck(args)
  assert.equal(db.writes.filter(w => w[0] === 'tray' || w[0] === 'file').length, 1)
})

test("runCheck ignores the owner's own attachments", async () => {
  const db = fakeDb({ people: [{ person, task }], slots: [{ id: 's1', kind: 'image' }] })
  const messages = [msg('m1', `Owner <${OWNER.email}>`, 2000, [{ id: 'A1', name: 'a.jpg', mime: 'image/jpeg', size: 900000 }])]
  const r = await runCheck({ owner: OWNER, db, gmail: fakeGmail(messages), getToken: async () => ({ accessToken: 'x' }) })
  assert.equal(r.filed + r.trayed, 0)
})
