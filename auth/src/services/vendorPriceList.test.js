const test = require('node:test')
const assert = require('node:assert/strict')
const { parsePriceListCsv, packSizeFrom } = require('./vendorPriceList')

test('packSizeFrom: reads 12pk / 12 ct, defaults to 1', () => {
  assert.equal(packSizeFrom('12pk', ''), 12)
  assert.equal(packSizeFrom('12 ct', ''), 12)
  assert.equal(packSizeFrom('', 'Energy RTD 16oz 24pack'), 24)
  assert.equal(packSizeFrom('30serv', 'Pre-workout 30serv'), 1)
  assert.equal(packSizeFrom('', ''), 1)
})

test('parsePriceListCsv: maps columns by header, derives unit_cost = EDLP / pack', () => {
  const csv = [
    'BRAND,NEW,PRODUCT,SIZE,FLAVOR,SKU,UPC,INDIVIDUAL UNIT UPC,EDLP,MAP,MARGIN',
    'Alani,,Alani Nu Energy RTD 12oz,12pk,Watermelon,S2741023,860014328077,860014328084,22.23,29.99,26%',
    'APS,,APS Mesomorph,30serv,Grape,S1001011,852688003123,,24.99,39.95,37%',
  ].join('\n')
  const { rows, skipped } = parsePriceListCsv(csv)
  assert.equal(rows.length, 2)
  assert.equal(skipped, 0)
  const alani = rows.find(r => r.sku === 'S2741023')
  assert.equal(alani.pack_size, 12)
  assert.equal(alani.case_cost, 22.23)
  assert.equal(alani.unit_cost, +(22.23 / 12).toFixed(4)) // 1.8525
  assert.equal(alani.map_price, 29.99)
  assert.equal(alani.upc, '860014328077')
  assert.equal(alani.unit_upc, '860014328084')
  const aps = rows.find(r => r.sku === 'S1001011')
  assert.equal(aps.pack_size, 1)
  assert.equal(aps.unit_cost, 24.99) // single unit, cost = EDLP
  assert.equal(aps.unit_upc, null)
})

test('parsePriceListCsv: tolerates a messy multi-row preamble before the header', () => {
  const csv = [
    '*All prices subject to change,,,,,,,,,,',
    'Brand instructions blah,,,,,,,,,,',
    'BRAND,NEW,PRODUCT,SIZE,FLAVOR,SKU,UPC,INDIVIDUAL UNIT UPC,EDLP,MAP,MARGIN',
    '3D Energy,,3D Energy RTD 16oz,12pk,Spicy Mango,S2751014,860014328077,,18.52,23.88,22%',
  ].join('\n')
  const { rows } = parsePriceListCsv(csv)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sku, 'S2751014')
  assert.equal(rows[0].unit_cost, +(18.52 / 12).toFixed(4))
})

test('parsePriceListCsv: skips non-product rows, throws only when columns absent', () => {
  const csv = [
    'BRAND,NEW,PRODUCT,SIZE,FLAVOR,SKU,UPC,INDIVIDUAL UNIT UPC,EDLP,MAP,MARGIN',
    'Note,,Subtotal,,,,,,,,',
    'Good,,Bar,12ct,Choc,S999001,12345678,,30.00,40.00,25%',
  ].join('\n')
  const { rows, skipped } = parsePriceListCsv(csv)
  assert.equal(rows.length, 1)
  assert.ok(skipped >= 0)
  assert.throws(() => parsePriceListCsv('no,header,here\n1,2,3'), /Could not find/)
})
