const test = require('node:test')
const assert = require('node:assert')
const { validateRoleName, buildPermissionGrid, TIERS } = require('./rolesAdmin')

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
