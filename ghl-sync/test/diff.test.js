const test = require('node:test')
const assert = require('node:assert/strict')
const { diffDriveVsDb } = require('../src/media/diff')

test('diff flags new, changed, and deleted files', () => {
  const drive = [
    { id: 'a', md5: 'h1', modifiedTime: '2026-01-01T00:00:00Z' }, // unchanged
    { id: 'b', md5: 'h2new', modifiedTime: '2026-02-01T00:00:00Z' }, // changed md5
    { id: 'c', md5: 'h3', modifiedTime: '2026-03-01T00:00:00Z' }, // new
  ]
  const db = [
    { drive_file_id: 'a', md5: 'h1', drive_modified_time: '2026-01-01T00:00:00Z' },
    { drive_file_id: 'b', md5: 'h2old', drive_modified_time: '2026-01-15T00:00:00Z' },
    { drive_file_id: 'd', md5: 'h4', drive_modified_time: '2026-01-01T00:00:00Z' }, // gone from drive
  ]
  const { toEmbed, toDelete } = diffDriveVsDb(drive, db)
  assert.deepEqual(toEmbed.map((f) => f.id).sort(), ['b', 'c'])
  assert.deepEqual(toDelete.map((r) => r.drive_file_id), ['d'])
})

test('diff re-embeds files whose prior attempt errored', () => {
  const drive = [{ id: 'a', md5: 'h1', modifiedTime: '2026-01-01T00:00:00Z' }]
  const db = [{ drive_file_id: 'a', md5: 'h1', drive_modified_time: '2026-01-01T00:00:00Z', status: 'error' }]
  const { toEmbed } = diffDriveVsDb(drive, db)
  assert.deepEqual(toEmbed.map((f) => f.id), ['a'])
})
