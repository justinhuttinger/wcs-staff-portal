const test = require('node:test')
const assert = require('node:assert')
const { packUnitize } = require('./inventoryPack')

test('packUnitize: case-priced 12pk from price list → per-can cost, ×12 qty', () => {
  const line = { description: 'Alani Nu Energy RTD 12oz 12pk Watermelon Wave', quantity: 1, unit_cost: 18.52 }
  const packRow = { pack_size: 12, case_cost: 18.52, unit_cost: 1.5433 }
  const r = packUnitize(line, packRow)
  assert.strictEqual(r.pack_size, 12)
  assert.strictEqual(r.quantity, 12)
  assert.ok(Math.abs(r.unit_cost - 1.5433) < 0.001, `got ${r.unit_cost}`)
  assert.strictEqual(r.divided, true)
})

test('packUnitize: pack size from description when no price-list row', () => {
  const line = { description: 'Random Brand Soda 12pk', quantity: 2, unit_cost: 24 }
  const r = packUnitize(line, null)
  assert.strictEqual(r.pack_size, 12)
  assert.strictEqual(r.quantity, 24)
  assert.strictEqual(r.unit_cost, 2)
  assert.strictEqual(r.divided, true)
})

test('packUnitize: single unit (pack_size 1) is untouched', () => {
  const line = { description: 'Quest Bar 12oz', quantity: 6, unit_cost: 2.10 }
  const r = packUnitize(line, { pack_size: 1, case_cost: 2.10, unit_cost: 2.10 })
  assert.strictEqual(r.pack_size, 1)
  assert.strictEqual(r.quantity, 6)
  assert.strictEqual(r.unit_cost, 2.10)
  assert.strictEqual(r.divided, false)
})

test('packUnitize: "12oz" size alone is not a pack', () => {
  const line = { description: 'Some Drink 16oz', quantity: 3, unit_cost: 1.5 }
  const r = packUnitize(line, null)
  assert.strictEqual(r.pack_size, 1)
  assert.strictEqual(r.quantity, 3)
  assert.strictEqual(r.divided, false)
})

test('packUnitize: invoice already per-unit (closer to unit_cost) is not divided', () => {
  // Invoice line shows the per-can price already; the price list confirms it.
  const line = { description: 'Alani 12pk', quantity: 12, unit_cost: 1.54 }
  const packRow = { pack_size: 12, case_cost: 18.52, unit_cost: 1.5433 }
  const r = packUnitize(line, packRow)
  assert.strictEqual(r.divided, false)
  assert.strictEqual(r.quantity, 12)
  assert.strictEqual(r.unit_cost, 1.54)
})

test('packUnitize: null unit_cost stays null, qty still ×pack', () => {
  const line = { description: 'Mystery 12pk', quantity: 1, unit_cost: null }
  const r = packUnitize(line, null)
  // No cost to divide, so we leave the line as-is (qty unchanged when cost unknown).
  assert.strictEqual(r.unit_cost, null)
  assert.strictEqual(r.divided, false)
  assert.strictEqual(r.quantity, 1)
})
