const test = require('node:test')
const assert = require('node:assert/strict')
const { parseExtractionText, isNonProductLine, driveDownloadUrl } = require('./inventoryInvoiceParse')

test('isNonProductLine: flags fees/shipping/tax, not real products', () => {
  for (const d of ['Processing Fee', 'Shipping Charge', 'Freight', 'Handling', 'Fuel Surcharge',
                   'Service Fee', 'Sales Tax', 'Subtotal', 'Discount', 'S & H', 'Postage', 'Gratuity']) {
    assert.equal(isNonProductLine(d), true, `should flag: ${d}`)
  }
  for (const d of ['Bang Coffee 16oz', 'Redline Fuel Pre-Workout', 'Toffee Protein Bar',
                   'Alani Nu Energy 12pk', 'Quest Bar', 'Mesomorph Grape']) {
    assert.equal(isNonProductLine(d), false, `should NOT flag: ${d}`)
  }
})

test('parseExtractionText: drops fee/shipping lines from the parsed result', () => {
  const out = parseExtractionText(JSON.stringify({
    lines: [
      { vendor_sku: 'S1', description: 'Alani Nu Energy 12pk', quantity: 1, unit_cost: 18.52 },
      { vendor_sku: null, description: 'Processing Fee', quantity: 1, unit_cost: 3.5 },
      { vendor_sku: null, description: 'Shipping Charge', quantity: 1, unit_cost: 12 },
      { vendor_sku: 'S2', description: 'Quest Bar', quantity: 2, unit_cost: 1.8 },
    ],
  }))
  assert.equal(out.lines.length, 2)
  assert.deepEqual(out.lines.map(l => l.description), ['Alani Nu Energy 12pk', 'Quest Bar'])
})

test('parseExtractionText: parses fenced json, derives unit_cost, keeps vendor_sku', () => {
  const out = parseExtractionText('Here you go:\n```json\n' + JSON.stringify({
    vendor: 'Acme', order_number: 'PO-9', invoice_date: '2026-06-20', total: 50,
    lines: [{ vendor_sku: 'S1181001', description: 'Bars', upc: '12', quantity: 5, line_total: 25 }],
  }) + '\n```')
  assert.equal(out.vendor, 'Acme')
  assert.equal(out.order_number, 'PO-9')
  assert.equal(out.lines.length, 1)
  assert.equal(out.lines[0].vendor_sku, 'S1181001')
  assert.equal(out.lines[0].unit_cost, 5) // 25/5
})

test('parseExtractionText: drops empty lines, keeps unit_cost when given', () => {
  const out = parseExtractionText(JSON.stringify({
    lines: [
      { description: '', upc: null, quantity: null },
      { description: 'Shaker', quantity: 2, unit_cost: 3.5 },
    ],
  }))
  assert.equal(out.lines.length, 1)
  assert.equal(out.lines[0].unit_cost, 3.5)
})

test('parseExtractionText: no json -> throws', () => {
  assert.throws(() => parseExtractionText('sorry, cannot read this'), /No JSON object found/)
})

test('driveDownloadUrl: maps view link to alt=media', () => {
  assert.equal(
    driveDownloadUrl('https://drive.google.com/file/d/ABC123/view'),
    'https://www.googleapis.com/drive/v3/files/ABC123?alt=media&supportsAllDrives=true')
  assert.equal(driveDownloadUrl('https://example.com/x'), null)
})
