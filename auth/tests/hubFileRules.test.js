const test = require('node:test')
const assert = require('node:assert/strict')
const { isFilableAttachment, decideFiling } = require('../src/services/hub/fileRules')
const { listAttachments } = require('../src/services/followUps/gmail')

test('decideFiling autos one image into the only open image slot', () => {
  const r = decideFiling([{ id: 'a', mime: 'image/jpeg', inline: false, size: 9e5 }], [{ id: 's1', kind: 'image' }])
  assert.deepEqual(r.auto.map(x => x.slotId), ['s1'])
  assert.equal(r.tray.length, 0)
})

test('decideFiling trays when two slots could fit', () => {
  const r = decideFiling([{ id: 'a', mime: 'image/png', size: 5e5 }], [{ id: 's1', kind: 'image' }, { id: 's2', kind: 'image' }])
  assert.equal(r.auto.length, 0)
  assert.equal(r.tray.length, 1)
})

test('decideFiling trays when two attachments compete for one slot', () => {
  const r = decideFiling([{ id: 'a', mime: 'image/png', size: 5e5 }, { id: 'b', mime: 'image/jpeg', size: 5e5 }], [{ id: 's1', kind: 'image' }])
  assert.equal(r.auto.length, 0)
  assert.equal(r.tray.length, 2)
})

test('decideFiling: a PDF never auto-fills an image slot; any-file slot takes it', () => {
  assert.equal(decideFiling([{ id: 'a', mime: 'application/pdf', size: 1e5 }], [{ id: 's1', kind: 'image' }]).auto.length, 0)
  assert.deepEqual(decideFiling([{ id: 'a', mime: 'application/pdf', size: 1e5 }], [{ id: 's1', kind: 'image' }, { id: 's2', kind: 'file' }]).auto.map(x => x.slotId), ['s2'])
})

test('decideFiling: no open slots puts everything in the tray', () => {
  assert.equal(decideFiling([{ id: 'a', mime: 'image/png', size: 5e5 }], []).tray.length, 1)
})

test('isFilableAttachment drops small inline signature images and empty files', () => {
  assert.equal(isFilableAttachment({ inline: true, mime: 'image/png', size: 8000 }), false)
  assert.equal(isFilableAttachment({ inline: false, mime: 'image/png', size: 0 }), false)
  assert.equal(isFilableAttachment({ inline: true, mime: 'image/jpeg', size: 400000 }), true)
  assert.equal(isFilableAttachment({ inline: false, mime: 'image/png', size: 8000 }), true)
})

test('listAttachments finds attachment parts and flags inline ones', () => {
  const msg = { id: 'm1', payload: { mimeType: 'multipart/mixed', parts: [
    { mimeType: 'text/plain', body: { data: 'aGk' } },
    { mimeType: 'image/jpeg', filename: 'eugene.jpg', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="eugene.jpg"' }], body: { attachmentId: 'A1', size: 900000 } },
    { mimeType: 'multipart/related', parts: [
      { mimeType: 'image/png', filename: 'logo.png', headers: [{ name: 'Content-ID', value: '<logo>' }, { name: 'Content-Disposition', value: 'inline' }], body: { attachmentId: 'A2', size: 6000 } },
    ] },
  ] } }
  assert.deepEqual(listAttachments(msg), [
    { attachmentId: 'A1', partId: null, filename: 'eugene.jpg', mimeType: 'image/jpeg', size: 900000, inline: false },
    { attachmentId: 'A2', partId: null, filename: 'logo.png', mimeType: 'image/png', size: 6000, inline: true },
  ])
})

test('listAttachments keys on the stable part id and skips nameless body parts', () => {
  const msg = { id: 'm1', payload: { mimeType: 'multipart/mixed', partId: '', parts: [
    { partId: '0', mimeType: 'text/html', filename: '', body: { attachmentId: 'BIGHTML', size: 90000 } },
    { partId: '1', mimeType: 'image/jpeg', filename: 'a.jpg', headers: [], body: { attachmentId: 'VOLATILE', size: 900000 } },
  ] } }
  const atts = listAttachments(msg)
  assert.equal(atts.length, 1)
  assert.equal(atts[0].partId, '1')
  assert.equal(atts[0].attachmentId, 'VOLATILE')
})

test('decideFiling: an image still waiting in the tray is a rival for the same slot', () => {
  const r = decideFiling([{ id: 'c', mime: 'image/jpeg', size: 5e5 }], [{ id: 's1', kind: 'image' }], [{ mime: 'image/png' }])
  assert.equal(r.auto.length, 0)
  assert.equal(r.tray.length, 1)
})
