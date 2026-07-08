const test = require('node:test')
const assert = require('node:assert')
const { canAccessForm } = require('./formsPermissions')

const FORM = {
  id: 'F1', owner_id: 'OWNER', location_id: 'LOC-A',
  visibility: 'private', location_can_edit: false,
}
const staff = (over = {}) => ({ id: 'ME', role: 'manager', location_ids: ['LOC-A'], ...over })

test('corporate and admin short-circuit to full access on any form', () => {
  for (const role of ['corporate', 'director', 'admin']) {
    const r = canAccessForm(staff({ role, location_ids: [] }), { ...FORM, visibility: 'private' }, [])
    assert.deepStrictEqual(r, { view: true, edit: true }, role)
  }
})

test('owner gets full access regardless of visibility', () => {
  const r = canAccessForm(staff({ id: 'OWNER' }), FORM, [])
  assert.deepStrictEqual(r, { view: true, edit: true })
})

test('private form: same-location peer gets nothing', () => {
  assert.deepStrictEqual(canAccessForm(staff(), FORM, []), { view: false, edit: false })
})

test('location visibility: peer views, edit follows location_can_edit', () => {
  const loc = { ...FORM, visibility: 'location' }
  assert.deepStrictEqual(canAccessForm(staff(), loc, []), { view: true, edit: false })
  assert.deepStrictEqual(canAccessForm(staff(), { ...loc, location_can_edit: true }, []), { view: true, edit: true })
})

test('location visibility: staff at another location gets nothing', () => {
  const loc = { ...FORM, visibility: 'location', location_can_edit: true }
  assert.deepStrictEqual(canAccessForm(staff({ location_ids: ['LOC-B'] }), loc, []), { view: false, edit: false })
})

test('multi-location staff match any assigned location', () => {
  const loc = { ...FORM, visibility: 'location' }
  assert.strictEqual(canAccessForm(staff({ location_ids: ['LOC-B', 'LOC-A'] }), loc, []).view, true)
})

test('explicit share: viewer views, editor edits, non-share gets nothing', () => {
  const shared = { ...FORM, visibility: 'shared' }
  const shares = [{ staff_id: 'ME', permission: 'viewer' }]
  assert.deepStrictEqual(canAccessForm(staff(), shared, shares), { view: true, edit: false })
  shares[0].permission = 'editor'
  assert.deepStrictEqual(canAccessForm(staff(), shared, shares), { view: true, edit: true })
  assert.deepStrictEqual(canAccessForm(staff({ id: 'OTHER' }), shared, shares), { view: false, edit: false })
})

test('share row is honored even when visibility is location (spec order, branch 4)', () => {
  const loc = { ...FORM, visibility: 'location' }
  const r = canAccessForm(staff({ location_ids: ['LOC-B'] }), loc, [{ staff_id: 'ME', permission: 'editor' }])
  assert.deepStrictEqual(r, { view: true, edit: true })
})

test('lead below manager tier still resolves via location/share branches only', () => {
  assert.deepStrictEqual(canAccessForm(staff({ role: 'lead' }), { ...FORM, visibility: 'location' }, []), { view: true, edit: false })
})

test('missing staff or form is no access', () => {
  assert.deepStrictEqual(canAccessForm(null, FORM, []), { view: false, edit: false })
  assert.deepStrictEqual(canAccessForm(staff(), null, []), { view: false, edit: false })
})
