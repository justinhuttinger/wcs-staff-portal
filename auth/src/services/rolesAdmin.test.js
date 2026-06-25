const test = require('node:test')
const assert = require('node:assert')
const { validateRoleName, buildPermissionGrid, TIERS, planOverrideWrites } = require('./rolesAdmin')
const { ROLE_HIERARCHY } = require('../middleware/role')

const HIER = ['team_member', 'lead', 'manager', 'corporate', 'admin']
const CATALOG = { 'report:payroll': 'manager', 'report:membership': 'lead' }
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

test('planOverrideWrites: inherit deletes, on/off upsert visible true/false', () => {
  const { toDelete, toUpsert } = planOverrideWrites([
    { perm_key: 'tile:a', state: 'inherit' },
    { perm_key: 'tile:b', state: 'on' },
    { perm_key: 'tile:c', state: 'off' },
  ], SID, CATALOG, 'lead', HIER)
  assert.deepStrictEqual(toDelete, ['tile:a'])
  assert.deepStrictEqual(toUpsert, [
    { staff_id: SID, perm_key: 'tile:b', visible: true },
    { staff_id: SID, perm_key: 'tile:c', visible: false },
  ])
})

test('planOverrideWrites: force-on within ceiling kept, above ceiling dropped', () => {
  assert.deepStrictEqual(
    planOverrideWrites([{ perm_key: 'report:membership', state: 'on' }], SID, CATALOG, 'lead', HIER).toUpsert,
    [{ staff_id: SID, perm_key: 'report:membership', visible: true }])
  // payroll needs manager; a lead member cannot be force-on'd into it.
  assert.deepStrictEqual(
    planOverrideWrites([{ perm_key: 'report:payroll', state: 'on' }], SID, CATALOG, 'lead', HIER).toUpsert,
    [])
})

test('planOverrideWrites: force-OFF above ceiling is still recorded (removal always allowed)', () => {
  assert.deepStrictEqual(
    planOverrideWrites([{ perm_key: 'report:payroll', state: 'off' }], SID, CATALOG, 'lead', HIER).toUpsert,
    [{ staff_id: SID, perm_key: 'report:payroll', visible: false }])
})

test('planOverrideWrites: uncatalogued report: force-on dropped (fail closed); tile force-on allowed', () => {
  assert.deepStrictEqual(
    planOverrideWrites([{ perm_key: 'report:mystery', state: 'on' }], SID, CATALOG, 'admin', HIER).toUpsert,
    [])
  assert.deepStrictEqual(
    planOverrideWrites([{ perm_key: 'tile:x', state: 'on' }], SID, CATALOG, 'team_member', HIER).toUpsert,
    [{ staff_id: SID, perm_key: 'tile:x', visible: true }])
})

test('planOverrideWrites: malformed items are skipped', () => {
  const { toDelete, toUpsert } = planOverrideWrites([
    null, {}, { perm_key: '' }, { perm_key: 'tile:a', state: 'bogus' },
  ], SID, CATALOG, 'admin', HIER)
  assert.deepStrictEqual(toDelete, [])
  assert.deepStrictEqual(toUpsert, [])
})

test('planOverrideWrites: a clamped force-on is also deleted, not left as a stale row', () => {
  // payroll needs manager; a lead force-on must be dropped AND its existing row removed.
  const { toDelete, toUpsert } = planOverrideWrites(
    [{ perm_key: 'report:payroll', state: 'on' }], SID, CATALOG, 'lead', HIER)
  assert.deepStrictEqual(toUpsert, [])
  assert.deepStrictEqual(toDelete, ['report:payroll'])
})

test('planOverrideWrites: clamp is correct against the real ROLE_HIERARCHY (custom/marketing present)', () => {
  // corporate-gated report force-on for a manager-tier member must be dropped,
  // even though 'custom' sits between lead and manager and 'marketing' between
  // corporate and admin in the real hierarchy.
  const catalog = { 'report:meta-ads': 'corporate', 'report:membership': 'lead' }
  const drop = planOverrideWrites([{ perm_key: 'report:meta-ads', state: 'on' }], SID, catalog, 'manager', ROLE_HIERARCHY)
  assert.deepStrictEqual(drop.toUpsert, [])
  const keep = planOverrideWrites([{ perm_key: 'report:membership', state: 'on' }], SID, catalog, 'manager', ROLE_HIERARCHY)
  assert.deepStrictEqual(keep.toUpsert, [{ staff_id: SID, perm_key: 'report:membership', visible: true }])
})
