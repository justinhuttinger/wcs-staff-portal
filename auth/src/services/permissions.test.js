const test = require('node:test')
const assert = require('node:assert')
const { applyOverrides } = require('./permissions')

const HIER = ['team_member', 'lead', 'manager', 'corporate', 'admin']
const CATALOG = { 'report:payroll': 'manager', 'report:membership': 'lead' }

test('no overrides returns the base set unchanged (parity)', () => {
  const out = applyOverrides(['tile:a', 'grow'], [], CATALOG, 'lead', HIER)
  assert.deepStrictEqual(out.sort(), ['grow', 'tile:a'])
})

test('force-on within ceiling is added', () => {
  const out = applyOverrides(['tile:a'], [{ perm_key: 'report:membership', visible: true }], CATALOG, 'lead', HIER)
  assert.ok(out.includes('report:membership'))
})

test('force-on above ceiling is dropped', () => {
  // payroll needs manager; a lead override cannot add it.
  const out = applyOverrides(['tile:a'], [{ perm_key: 'report:payroll', visible: true }], CATALOG, 'lead', HIER)
  assert.ok(!out.includes('report:payroll'))
})

test('force-off removes a base key', () => {
  const out = applyOverrides(['tile:a', 'tile:b'], [{ perm_key: 'tile:b', visible: false }], CATALOG, 'lead', HIER)
  assert.deepStrictEqual(out.sort(), ['tile:a'])
})

test('force-on for a key absent from the catalog is allowed (no ceiling on uncatalogued tiles)', () => {
  const out = applyOverrides([], [{ perm_key: 'tile:custom', visible: true }], CATALOG, 'team_member', HIER)
  assert.deepStrictEqual(out, ['tile:custom'])
})
