const test = require('node:test')
const assert = require('node:assert/strict')
const { parseExtractionText, driveDownloadUrl } = require('./inventoryInvoiceParse')

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
