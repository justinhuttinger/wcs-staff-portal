const test = require('node:test')
const assert = require('node:assert')

const {
  resolveRole, roleLevel, canSeeAllLocations, canAccessReport,
  ROLE_HIERARCHY, setCustomRoleTiers,
} = require('./role')

test.afterEach(() => { setCustomRoleTiers({}) })

test('built-in and alias roles resolve exactly as before (no map loaded)', () => {
  assert.strictEqual(resolveRole('manager'), 'manager')
  assert.strictEqual(resolveRole('custom'), 'custom') // built-in custom keeps its own tier
  assert.strictEqual(resolveRole('front_desk'), 'team_member')
  assert.strictEqual(resolveRole('director'), 'corporate')
  assert.strictEqual(resolveRole('unknown_role'), 'unknown_role') // identity fallback
})

test('a loaded custom role resolves to its base tier across every sync gate', () => {
  setCustomRoleTiers({ 'Assistant Manager': 'manager' })
  assert.strictEqual(resolveRole('Assistant Manager'), 'manager')
  assert.strictEqual(roleLevel('Assistant Manager'), ROLE_HIERARCHY.indexOf('manager'))
  // canAccessReport / canSeeAllLocations route through resolveRole too.
  assert.strictEqual(canAccessReport('Assistant Manager', 'payroll'), true) // manager tier
  assert.strictEqual(canAccessReport('Assistant Manager', 'marketing'), false) // marketing-only
  assert.strictEqual(canSeeAllLocations('Assistant Manager'), false) // manager isn't all-locations
})

test('a loaded corporate-tier custom role gets all-locations + corporate reports', () => {
  setCustomRoleTiers({ 'Regional Director': 'corporate' })
  assert.strictEqual(canSeeAllLocations('Regional Director'), true)
  assert.strictEqual(canAccessReport('Regional Director', 'marketing'), true)
})

test('an unknown custom role (map not yet loaded) resolves to tier -1 — fail closed', () => {
  // Empty map: a custom name is unresolved and treated as below every gate.
  assert.strictEqual(roleLevel('Some New Role'), -1)
})

test('an alias name can never be shadowed by a custom map entry', () => {
  setCustomRoleTiers({ front_desk: 'admin' }) // pathological
  assert.strictEqual(resolveRole('front_desk'), 'team_member')
})

test('setCustomRoleTiers ignores non-object input', () => {
  setCustomRoleTiers(null)
  assert.strictEqual(resolveRole('whatever'), 'whatever')
})
