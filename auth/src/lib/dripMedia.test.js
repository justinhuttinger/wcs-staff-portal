// auth/src/lib/dripMedia.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const {
  mediaKeyFor, mediaNameFor, isMediaKey, validateMedia, formatBytes,
  mediaStoragePath, MAX_MEDIA_BYTES,
} = require('./dripMedia')

test('media key is derived from the message key', () => {
  assert.equal(mediaKeyFor('custom_values.vip_sms_1'), 'custom_values.vip_sms_1_media')
  assert.equal(mediaKeyFor('custom_values.missed_tour_sms'), 'custom_values.missed_tour_sms_media')
})

test('media key tolerates the braces GHL returns', () => {
  assert.equal(mediaKeyFor('{{ custom_values.vip_sms_1 }}'), 'custom_values.vip_sms_1_media')
})

test('media key is idempotent, so a companion never gets a second suffix', () => {
  assert.equal(mediaKeyFor('custom_values.vip_sms_1_media'), 'custom_values.vip_sms_1_media')
})

test('media key rejects nothing to work with', () => {
  assert.equal(mediaKeyFor(''), null)
  assert.equal(mediaKeyFor(null), null)
})

test('media NAME must produce the media KEY, or the workflow token breaks', () => {
  // GHL derives the fieldKey from the name, so these two have to stay in step.
  const name = mediaNameFor('VIP SMS 1')
  assert.equal(name, 'VIP SMS 1 Media')
  const derived = 'custom_values.' + name.toLowerCase().replace(/\s+/g, '_')
  assert.equal(derived, mediaKeyFor('custom_values.vip_sms_1'))
})

test('media name is idempotent and case-insensitive about it', () => {
  assert.equal(mediaNameFor('VIP SMS 1 Media'), 'VIP SMS 1 Media')
  assert.equal(mediaNameFor('VIP SMS 1 media'), 'VIP SMS 1 media')
})

test('isMediaKey separates companions from messages', () => {
  assert.equal(isMediaKey('custom_values.vip_sms_1_media'), true)
  assert.equal(isMediaKey('{{ custom_values.vip_sms_1_media }}'), true)
  assert.equal(isMediaKey('custom_values.vip_sms_1'), false)
})

test('validateMedia accepts the three formats MMS carries', () => {
  assert.deepEqual(validateMedia({ mimetype: 'image/jpeg', size: 1000 }), { ok: true, ext: 'jpg' })
  assert.deepEqual(validateMedia({ mimetype: 'image/png', size: 1000 }), { ok: true, ext: 'png' })
  assert.deepEqual(validateMedia({ mimetype: 'image/gif', size: 1000 }), { ok: true, ext: 'gif' })
})

test('validateMedia tolerates a charset on the mime type', () => {
  assert.equal(validateMedia({ mimetype: 'image/png; charset=binary', size: 10 }).ok, true)
})

test('validateMedia rejects formats MMS cannot carry', () => {
  const r = validateMedia({ mimetype: 'image/webp', size: 1000 })
  assert.equal(r.ok, false)
  assert.match(r.error, /JPEG, PNG and GIF/)
  assert.equal(validateMedia({ mimetype: 'application/pdf', size: 10 }).ok, false)
  assert.equal(validateMedia({ mimetype: '', size: 10 }).ok, false)
})

test('validateMedia rejects an empty file', () => {
  assert.equal(validateMedia({ mimetype: 'image/png', size: 0 }).ok, false)
  assert.equal(validateMedia({ mimetype: 'image/png' }).ok, false)
})

test('validateMedia rejects anything carriers would silently drop', () => {
  const r = validateMedia({ mimetype: 'image/jpeg', size: MAX_MEDIA_BYTES + 1 })
  assert.equal(r.ok, false)
  assert.match(r.error, /carriers drop mms/i)
  assert.equal(validateMedia({ mimetype: 'image/jpeg', size: MAX_MEDIA_BYTES }).ok, true)
})

test('formatBytes reads the way a person would say it', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(1024 * 1024 * 1.5), '1.5 MB')
})

test('storage path is scoped per club and unique per upload', () => {
  const a = mediaStoragePath({ clubSlug: 'salem', mediaKey: 'custom_values.vip_sms_1_media', ext: 'jpg' })
  const b = mediaStoragePath({ clubSlug: 'salem', mediaKey: 'custom_values.vip_sms_1_media', ext: 'jpg' })
  assert.match(a, /^salem\/vip_sms_1_media-\d+-[a-z0-9]+\.jpg$/)
  // A replacement must not reuse the URL, or a CDN serves the old bytes.
  assert.notEqual(a, b)
})

test('storage path strips anything that could escape the club folder', () => {
  const p = mediaStoragePath({ clubSlug: '../etc', mediaKey: 'custom_values.a/../b', ext: 'png' })
  assert.ok(!p.includes('..'))
  assert.equal(p.split('/').length, 2)
})
