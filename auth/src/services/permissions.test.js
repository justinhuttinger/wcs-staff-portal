const test = require('node:test')
const assert = require('node:assert')
const { applyOverrides } = require('./permissions')

// Roles are fully customizable: applyOverrides grants exactly what the base set
// plus overrides list, with NO tier ceiling.

test('no overrides returns the base set unchanged', () => {
  const out = applyOverrides(['tile:a', 'grow'], [])
  assert.deepStrictEqual(out.sort(), ['grow', 'tile:a'])
})

test('force-on adds a key', () => {
  const out = applyOverrides(['tile:a'], [{ perm_key: 'report:membership', visible: true }])
  assert.ok(out.includes('report:membership'))
})

test('force-off removes a base key', () => {
  const out = applyOverrides(['tile:a', 'tile:b'], [{ perm_key: 'tile:b', visible: false }])
  assert.deepStrictEqual(out.sort(), ['tile:a'])
})

test('any report grant is honored regardless of tier (no ceiling)', () => {
  // payroll would previously have been clamped for a low role; now it is granted.
  const out = applyOverrides([], [{ perm_key: 'report:payroll', visible: true }])
  assert.deepStrictEqual(out, ['report:payroll'])
})

test('a base report toggle is kept as-is (no clamp)', () => {
  const out = applyOverrides(['report:payroll', 'tile:a'], [])
  assert.deepStrictEqual(out.sort(), ['report:payroll', 'tile:a'])
})

test('force-off wins over a base key even when also force-on elsewhere', () => {
  const out = applyOverrides(['x'], [{ perm_key: 'x', visible: true }, { perm_key: 'x', visible: false }])
  assert.deepStrictEqual(out, [])
})

test('null inputs are safe', () => {
  assert.deepStrictEqual(applyOverrides(null, null), [])
})
