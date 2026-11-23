const test = require('node:test')
const assert = require('node:assert/strict')
const { cleanLink, safeFileName } = require('../src/services/projects/files')

test('cleanLink: Google types get a default title; explicit title wins', () => {
  assert.equal(cleanLink({ url: 'https://docs.google.com/spreadsheets/d/abc/edit' }).title, 'Google Sheet')
  assert.equal(cleanLink({ url: 'https://drive.google.com/drive/folders/xyz' }).title, 'Drive folder')
  assert.equal(cleanLink({ url: 'https://drive.google.com/file/d/xyz/view' }).title, 'Drive file')
  assert.equal(cleanLink({ url: 'https://www.canva.com/design/1' }).title, 'canva.com')
  assert.equal(cleanLink({ url: 'https://docs.google.com/document/d/1', title: ' Plan ' }).title, 'Plan')
})

test('cleanLink: refuses empty, junk and non-http links', () => {
  assert.equal(cleanLink({ url: '' }).error, 'Paste a link')
  assert.equal(cleanLink({ url: 'not a link' }).error, 'That does not look like a link')
  assert.equal(cleanLink({ url: 'javascript:alert(1)' }).error, 'Links must start with http:// or https://')
})

test('safeFileName strips path and header characters', () => {
  assert.equal(safeFileName('../a\\b"c.pdf'), '..abc.pdf')
  assert.equal(safeFileName(''), 'file')
})
