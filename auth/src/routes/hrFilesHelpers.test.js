const { test } = require('node:test')
const assert = require('node:assert')
const {
  extOf, isAllowedFile, contentTypeFor, cleanFileName, storagePath, contentDisposition,
} = require('./hrFilesHelpers')

test('extOf lowercases and handles missing extensions', () => {
  assert.strictEqual(extOf('Signed Form.PDF'), 'pdf')
  assert.strictEqual(extOf('archive.tar.gz'), 'gz')
  assert.strictEqual(extOf('noextension'), '')
  assert.strictEqual(extOf(undefined), '')
})

test('isAllowedFile accepts documents and photos, rejects the rest', () => {
  for (const ok of ['a.pdf', 'a.JPG', 'a.heic', 'a.docx', 'a.xlsx', 'a.txt']) {
    assert.ok(isAllowedFile(ok), ok)
  }
  for (const bad of ['a.exe', 'a.html', 'a.svg', 'a.js', 'a', 'constructor', 'a.pdf.exe']) {
    assert.ok(!isAllowedFile(bad), bad)
  }
})

test('contentTypeFor comes from the extension, not the client', () => {
  assert.strictEqual(contentTypeFor('scan.pdf'), 'application/pdf')
  assert.strictEqual(contentTypeFor('IMG_1.HEIC'), 'image/heic')
  assert.strictEqual(contentTypeFor('weird.bin'), 'application/octet-stream')
})

test('cleanFileName strips paths and header-breaking characters', () => {
  assert.strictEqual(cleanFileName('C:\\Users\\me\\Doctor Note.pdf'), 'Doctor Note.pdf')
  assert.strictEqual(cleanFileName('../../etc/passwd.txt'), 'passwd.txt')
  assert.strictEqual(cleanFileName('bad"name\r\n.pdf'), 'badname.pdf')
  assert.strictEqual(cleanFileName(''), 'file')
})

test('storagePath never carries the original file name', () => {
  const p = storagePath({ locationSlug: 'salem', workerId: '00A/..B', id: 'abc-123', fileName: 'My Secret.PDF' })
  assert.strictEqual(p, 'salem/00A_B/abc-123.pdf')
})

test('contentDisposition is always an attachment with an encoded name', () => {
  const h = contentDisposition('Reseña médica.pdf')
  assert.ok(h.startsWith('attachment; filename="'))
  assert.ok(h.includes("filename*=UTF-8''Rese%C3%B1a%20m%C3%A9dica.pdf"))
  assert.ok(!/[^\x20-\x7e]/.test(h))
})
