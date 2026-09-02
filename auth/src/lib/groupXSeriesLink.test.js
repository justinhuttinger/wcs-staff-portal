const test = require('node:test')
const assert = require('node:assert')
const { linkRows, resolveLinkedSeriesId } = require('./groupXSeriesLink')

test('linkRows maps successful creates to link rows', () => {
  assert.deepStrictEqual(
    linkRows('7655', 's1', [{ date: '2026-08-04', ok: true, event_id: 'e1' }]),
    [{ club_number: '7655', abc_event_id: 'e1', series_id: 's1', event_date: '2026-08-04' }],
  )
})

test('linkRows skips failed creates', () => {
  const rows = linkRows('7655', 's1', [
    { date: '2026-08-04', ok: true, event_id: 'e1' },
    { date: '2026-08-11', ok: false, error: 'ABC said no' },
  ])
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].abc_event_id, 'e1')
})

test('linkRows skips a create that succeeded without returning an id', () => {
  // ABC has returned success with no id before. A row keyed on undefined would
  // collide with every other such row on the primary key.
  assert.deepStrictEqual(linkRows('7655', 's1', [{ date: '2026-08-04', ok: true }]), [])
})

test('linkRows coerces the club number to text to match the column', () => {
  assert.strictEqual(linkRows(7655, 's1', [{ date: '2026-08-04', ok: true, event_id: 'e1' }])[0].club_number, '7655')
})

test('linkRows tolerates an empty result list', () => {
  assert.deepStrictEqual(linkRows('7655', 's1', []), [])
})

test('resolveLinkedSeriesId returns the id when its series is live', () => {
  assert.strictEqual(resolveLinkedSeriesId('s1', new Set(['s1', 's2'])), 's1')
})

test('resolveLinkedSeriesId drops a link to a series that is no longer live', () => {
  // DELETE /series/:id cancels the series but never deletes the link row it
  // left behind, so a stale link must not be trusted as-is.
  assert.strictEqual(resolveLinkedSeriesId('s1', new Set(['s2'])), null)
})

test('resolveLinkedSeriesId tolerates no link', () => {
  assert.strictEqual(resolveLinkedSeriesId(null, new Set(['s1'])), null)
})
