const test = require('node:test')
const assert = require('node:assert/strict')
const { hubFileName, storeFile } = require('../src/services/hub/drive')

test('hubFileName: task - club - deliverable - person.ext', () => {
  assert.equal(hubFileName({ taskTitle: 'Employee of the Month', clubName: 'Salem', deliverable: 'Photo of Employee', person: 'Sam Lee', ext: 'JPG', n: 1 }),
    'Employee of the Month - Salem - Photo of Employee - Sam Lee.jpg')
})

test('hubFileName: no club part, cleaned characters, repeat number', () => {
  assert.equal(hubFileName({ taskTitle: 'Q1: Plan/Draft', clubName: null, deliverable: 'Copy', person: 'Sam', ext: 'pdf', n: 2 }),
    'Q1 PlanDraft - Copy - Sam (2).pdf')
})

test('hubFileName: missing person and extension still give a sensible name', () => {
  assert.equal(hubFileName({ taskTitle: 'Promo', clubName: 'Keizer', deliverable: 'Flyer', person: '', ext: '', n: 1 }), 'Promo - Keizer - Flyer')
})

const file = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'IMG_1.JPG', size: 1 }

test('storeFile uses Drive when it works', async () => {
  const r = await storeFile({
    ownerId: 'o', name: 'n.jpg', file,
    getToken: async () => ({ accessToken: 't' }),
    drive: { ensureFolder: async () => 'F', upload: async (token, folder, name) => { assert.equal(folder, 'F'); assert.equal(name, 'n.jpg'); return { id: 'D', webViewLink: 'https://drive/D' } } },
    fallback: async () => { throw new Error('should not fall back') },
  })
  assert.deepEqual(r, { drive_file_id: 'D', drive_url: 'https://drive/D' })
})

test('storeFile falls back to portal storage when Drive fails', async () => {
  const r = await storeFile({
    ownerId: 'o', name: 'n.jpg', file,
    getToken: async () => { const e = new Error('revoked'); e.notConnected = true; throw e },
    drive: { ensureFolder: async () => 'F', upload: async () => ({}) },
    fallback: async () => ({ storage_path: 'p/n.jpg' }),
  })
  assert.deepEqual(r, { storage_path: 'p/n.jpg' })
})

const { serveAs, positionsBySlot, oncePerKey } = require('../src/services/hub/drive')

test('serveAs: only safe types open in the browser; everything else downloads', () => {
  assert.deepEqual(serveAs('image/jpeg'), { inline: true, type: 'image/jpeg' })
  assert.deepEqual(serveAs('application/pdf'), { inline: true, type: 'application/pdf' })
  assert.equal(serveAs('image/svg+xml').inline, false)
  assert.equal(serveAs('text/html').inline, false)
  assert.equal(serveAs('text/html').type, 'application/octet-stream')
  assert.equal(serveAs(null).inline, false)
})

test('positionsBySlot: 1-based order by time within each slot', () => {
  const pos = positionsBySlot([
    { id: 'b', slot_id: 's1', created_at: '2026-11-16T02:00:00Z' },
    { id: 'a', slot_id: 's1', created_at: '2026-11-16T01:00:00Z' },
    { id: 'c', slot_id: 's2', created_at: '2026-11-16T03:00:00Z' },
  ])
  assert.deepEqual([pos.get('a'), pos.get('b'), pos.get('c')], [1, 2, 1])
})

test('oncePerKey: overlapping calls for the same key share one run', async () => {
  let runs = 0
  const ensure = oncePerKey(async key => { runs++; await new Promise(r => setTimeout(r, 20)); return `folder-${key}` })
  const [x, y] = await Promise.all([ensure('owner'), ensure('owner')])
  assert.equal(runs, 1)
  assert.equal(x, 'folder-owner')
  assert.equal(y, 'folder-owner')
  await ensure('owner')
  assert.equal(runs, 2)
})
