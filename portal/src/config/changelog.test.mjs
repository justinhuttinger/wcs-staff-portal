import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHANGELOG, canSeeChangelogEntry, visibleChangelog } from './changelog.js'

// The bell is the one place the portal tells staff something they did not go
// looking for, so an entry shown to the wrong person is worse than one nobody
// sees: it advertises a tile they do not have and cannot get to.

const user = (over = {}) => ({ role: 'team_member', visibleTools: [], customReports: [], ...over })

test('a tool-gated entry needs that exact tool', () => {
  const entry = { id: 1, audience: { tool: 'groupX' } }
  assert.equal(canSeeChangelogEntry(entry, user({ visibleTools: ['groupX'] })), true)
  assert.equal(canSeeChangelogEntry(entry, user({ visibleTools: ['facility'] })), false)
  assert.equal(canSeeChangelogEntry(entry, user()), false)
  // Holding the EDIT permission without the tile itself is not enough -- the
  // tile key is what puts it on the board.
  assert.equal(canSeeChangelogEntry(entry, user({ visibleTools: ['groupX:schedule-edit'] })), false)
})

test('Group X and Courts & Pool gate independently', () => {
  const gx = { id: 1, audience: { tool: 'groupX' } }
  const fx = { id: 2, audience: { tool: 'facility' } }
  const onlyFacility = user({ visibleTools: ['facility'] })
  assert.equal(canSeeChangelogEntry(gx, onlyFacility), false)
  assert.equal(canSeeChangelogEntry(fx, onlyFacility), true)
})

// Looked up by title, not id. Ids shift whenever another changelog PR lands
// first -- this file was renumbered 11-13 to 13-15 by exactly that -- and a test
// pinned to an id then asserts against whatever entry inherited the number.
const byTitle = fragment => {
  const found = CHANGELOG.filter(e => e.title.includes(fragment))
  assert.equal(found.length, 1, `expected exactly one entry matching "${fragment}"`)
  return found[0]
}

test('the admin entry is admin only, whatever tiles you hold', () => {
  const entry = byTitle('set up per club')
  assert.equal(canSeeChangelogEntry(entry, user({ role: 'manager', visibleTools: ['groupX', 'facility'] })), false)
  assert.equal(canSeeChangelogEntry(entry, user({ role: 'admin' })), true)
})

test("today's entries reach a front desk member who has the tiles", () => {
  // The whole point of the Group X and Courts & Pool work was that base roles
  // get these screens. If the bell hides the announcement from them, they find
  // out by accident or not at all.
  const frontDesk = user({ role: 'front_desk', visibleTools: ['groupX', 'facility'] })
  const ids = visibleChangelog(frontDesk).map(e => e.id)
  assert.ok(ids.includes(byTitle('Group X is on your home screen').id), 'front desk should see the Group X entry')
  assert.ok(ids.includes(byTitle('Courts & Pool schedules').id), 'front desk should see the Courts & Pool entry')
  assert.ok(!ids.includes(byTitle('set up per club').id), 'front desk should not see the admin entry')
})

test('entries are newest first and ids are unique', () => {
  const ids = CHANGELOG.map(e => e.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate changelog id')
  // The bell reads position, and read state is "everything above this id", so a
  // list out of order marks entries seen that were never shown.
  const shown = visibleChangelog(user({ role: 'admin', visibleTools: ['groupX', 'facility'] }))
  const shownIds = shown.map(e => e.id)
  assert.deepEqual(shownIds, [...shownIds].sort((a, b) => b - a))
})

test('every entry has the fields the bell renders', () => {
  for (const e of CHANGELOG) {
    assert.equal(typeof e.id, 'number', `entry ${e.id}: id must be a number`)
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `entry ${e.id}: bad date`)
    assert.ok(e.title && e.body, `entry ${e.id}: needs a title and a body`)
  }
})
