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
