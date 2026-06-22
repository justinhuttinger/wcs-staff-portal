const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeText, upcVariants, matchLine } = require('./inventoryMatch')

const items = [
  { id: 'i-shaker', item_name: 'WCS Shaker Bottle Black', upc: '195602030729' },
  { id: 'i-bar',    item_name: 'Chocolate Protein Bar 60g', upc: '0090210' },
]
const aliases = [{ alias_text: 'choc prot bar', upc: null, item_id: 'i-bar' }]

test('normalizeText lowercases and strips punctuation', () => {
  assert.equal(normalizeText('  WCS-Shaker (Black)! '), 'wcs shaker black')
})

test('upcVariants includes leading-zero and padded forms', () => {
  const v = upcVariants('90210')
  assert.ok(v.includes('90210'))
  assert.ok(v.includes('000000090210'))
})

test('matchLine: exact UPC wins with confidence 1', () => {
  const r = matchLine({ description: 'whatever', upc: '195602030729' }, { items, aliases })
  assert.deepEqual(r, { item_id: 'i-shaker', match_source: 'upc', match_confidence: 1 })
})

test('matchLine: UPC variant (leading zero) matches', () => {
  const r = matchLine({ description: 'bar', upc: '90210' }, { items, aliases })
  assert.equal(r.item_id, 'i-bar')
  assert.equal(r.match_source, 'upc')
})

test('matchLine: alias hit when no UPC', () => {
  const r = matchLine({ description: 'Choc Prot Bar', upc: null }, { items, aliases })
  assert.deepEqual(r, { item_id: 'i-bar', match_source: 'alias', match_confidence: 1 })
})

test('matchLine: alias UPC matches across zero-padding', () => {
  const aliasesUpc = [{ alias_text: 'zzz no name match', upc: '0090210', item_id: 'i-bar' }]
  const r = matchLine({ description: 'totally different text', upc: '90210' }, { items: [], aliases: aliasesUpc })
  assert.equal(r.item_id, 'i-bar')
  assert.equal(r.match_source, 'alias')
  assert.equal(r.match_confidence, 1)
})

test('matchLine: fuzzy name above threshold', () => {
  const r = matchLine({ description: 'shaker bottle wcs black', upc: null }, { items, aliases: [] })
  assert.equal(r.item_id, 'i-shaker')
  assert.equal(r.match_source, 'fuzzy')
  assert.ok(r.match_confidence >= 0.6 && r.match_confidence <= 1)
})

test('matchLine: unmatched below threshold', () => {
  const r = matchLine({ description: 'garden hose 50ft', upc: null }, { items, aliases: [] })
  assert.deepEqual(r, { item_id: null, match_source: null, match_confidence: null })
})

const { normalizeSku } = require('./inventoryMatch')

test('normalizeSku: uppercases and trims, null on empty', () => {
  assert.equal(normalizeSku(' s1181001 '), 'S1181001')
  assert.equal(normalizeSku(''), null)
  assert.equal(normalizeSku(null), null)
})

test('matchLine: vendor SKU alias wins over fuzzy', () => {
  const skuAliases = [{ vendor_sku: 'S1181001', alias_text: null, upc: null, item_id: 'i-shaker' }]
  // description deliberately does NOT fuzzy-match the shaker
  const r = matchLine(
    { description: 'fireball lcarnitine cherry', upc: null, vendor_sku: 's1181001' },
    { items, aliases: skuAliases })
  assert.deepEqual(r, { item_id: 'i-shaker', match_source: 'sku', match_confidence: 1 })
})

test('matchLine: no SKU alias falls through to fuzzy', () => {
  const r = matchLine(
    { description: 'shaker bottle wcs black', upc: null, vendor_sku: 'S999' },
    { items, aliases: [] })
  assert.equal(r.item_id, 'i-shaker')
  assert.equal(r.match_source, 'fuzzy')
})
