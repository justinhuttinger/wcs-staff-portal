const test = require('node:test')
const assert = require('node:assert')
const { validateRoleName, buildPermissionGrid, TIERS, planOverrideWrites, tileLabelsFromRows, tileCategoryForParent } = require('./rolesAdmin')

const SID = 'staff-1'

test('TIERS is the five canonical tiers', () => {
  assert.deepStrictEqual(TIERS, ['team_member', 'lead', 'manager', 'corporate', 'admin'])
})

test('validateRoleName rejects empty and duplicates (case-insensitive)', () => {
  assert.strictEqual(validateRoleName('', []).ok, false)
  assert.strictEqual(validateRoleName('  ', []).ok, false)
  assert.strictEqual(validateRoleName('Lead', ['lead']).ok, false)
  assert.strictEqual(validateRoleName('Assistant Manager', ['lead']).ok, true)
})

test('validateRoleName rejects names over 40 chars', () => {
  assert.strictEqual(validateRoleName('x'.repeat(41), []).ok, false)
})

test('buildPermissionGrid merges catalog rows and dynamic tiles, sorted by category then label', () => {
  const catalog = [
    { perm_key: 'report:payroll', label: 'Payroll Report', category: 'Reports', min_tier: 'manager' },
    { perm_key: 'grow', label: 'GROW', category: 'Apps', min_tier: 'team_member' },
  ]
  const tileLabels = { 'tile:abc': { label: 'Cancel Tool' } }
  const grid = buildPermissionGrid(catalog, tileLabels)
  assert.deepStrictEqual(grid.map(r => r.perm_key), ['grow', 'tile:abc', 'report:payroll'])
  assert.strictEqual(grid.find(r => r.perm_key === 'tile:abc').category, 'Tools')
  assert.strictEqual(grid.find(r => r.perm_key === 'tile:abc').min_tier, 'team_member')
})

test('tileCategoryForParent groups by parent into existing catalog categories', () => {
  assert.strictEqual(tileCategoryForParent('Reporting'), 'Reports')
  assert.strictEqual(tileCategoryForParent('Marketing'), 'Marketing')
  assert.strictEqual(tileCategoryForParent('Whatever'), 'Tools')
  assert.strictEqual(tileCategoryForParent(null), 'Tools')
})

test('tileLabelsFromRows nests child tiles under their parent category', () => {
  const rows = [
    { id: 'rep', label: 'Reporting', parent_id: null },
    { id: 'mem', label: 'Membership', parent_id: 'rep' },
    { id: 'mkt', label: 'Marketing', parent_id: null },
    { id: 'fb', label: 'Facebook', parent_id: 'mkt' },
    { id: 'ind', label: 'Indeed', parent_id: null },
  ]
  const out = tileLabelsFromRows(rows)
  assert.strictEqual(out['tile:rep'].category, 'Tools')   // parent group launcher
  assert.strictEqual(out['tile:mem'].category, 'Reports') // child of Reporting
  assert.strictEqual(out['tile:fb'].category, 'Marketing')// child of Marketing
  assert.strictEqual(out['tile:ind'].category, 'Tools')   // standalone
  assert.strictEqual(out['tile:mem'].label, 'Membership')
})

// planOverrideWrites: no tier ceiling — grants exactly what's stated.

test('planOverrideWrites: inherit deletes, on/off upsert visible true/false', () => {
  const { toDelete, toUpsert } = planOverrideWrites([
    { perm_key: 'tile:a', state: 'inherit' },
    { perm_key: 'tile:b', state: 'on' },
    { perm_key: 'tile:c', state: 'off' },
  ], SID)
  assert.deepStrictEqual(toDelete, ['tile:a'])
  assert.deepStrictEqual(toUpsert, [
    { staff_id: SID, perm_key: 'tile:b', visible: true },
    { staff_id: SID, perm_key: 'tile:c', visible: false },
  ])
})

test('planOverrideWrites: any report force-on is upserted, no ceiling', () => {
  const { toUpsert } = planOverrideWrites([{ perm_key: 'report:payroll', state: 'on' }], SID)
  assert.deepStrictEqual(toUpsert, [{ staff_id: SID, perm_key: 'report:payroll', visible: true }])
})

test('planOverrideWrites: force-off is recorded', () => {
  const { toUpsert } = planOverrideWrites([{ perm_key: 'report:payroll', state: 'off' }], SID)
  assert.deepStrictEqual(toUpsert, [{ staff_id: SID, perm_key: 'report:payroll', visible: false }])
})

test('planOverrideWrites: malformed items are skipped', () => {
  const { toDelete, toUpsert } = planOverrideWrites([
    null, {}, { perm_key: '' }, { perm_key: 'tile:a', state: 'bogus' },
  ], SID)
  assert.deepStrictEqual(toDelete, [])
  assert.deepStrictEqual(toUpsert, [])
})
