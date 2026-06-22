const test = require('node:test')
const assert = require('node:assert/strict')
const { deriveLocation, joinFolderPath } = require('../src/media/locationPath')

test('deriveLocation returns the top-level folder under the Media root', () => {
  assert.equal(deriveLocation(['Salem', '2025', '6-5-26']), 'Salem')
  assert.equal(deriveLocation(['Etc.', 'AD MEDIA']), 'Etc.')
  assert.equal(deriveLocation([]), null)
})

test('joinFolderPath joins segments with forward slashes', () => {
  assert.equal(joinFolderPath(['Salem', '2025']), 'Salem/2025')
  assert.equal(joinFolderPath([]), '')
})
