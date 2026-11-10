const test = require('node:test')
const assert = require('node:assert/strict')
const { parseRevenueCsv, isDbxLayout } = require('./revenueCsvParser')

// Trimmed copy of ABC's "Revenue By Payment Type or Profit Center (DBX)" export
// (the layout newer ABC accounts get). Real files carry more columns; the
// parser only needs these. Club 30935 is used because it is in the bundled
// registry the tests load.
const HEADER = 'Location: 030935 - WEST COAST STRENGTH SALEM | Date: 11/01/2025 - 11/09/2026 | Total Revenue: $1,071.50'
const csv = [
  'Textbox1,location_name,location_num,payment_club,member_number,agreement_number,last_name,first_name,billing_type,membership_type,profit_center,catalog_item,date_key,payment_method,payment_description,total_amount,tax_amount,subtotal_amount,receipt_number,collected_method',
  `"${HEADER}",WCS SALEM,030935,030935,000101,30935000101,DOE,JANE,OPEN_END,PREMIU,Dues,Monthly Dues,04/15/2026,Visa,Credit Card Payment,"$1,100.00",$0.00,"$1,100.00",30935-57-1,ABC Member Billing`,
  `"${HEADER}",WCS SALEM,030935,030935,000102,30935000102,ROE,JOHN,OPEN_END,PREMIU,Pro Shop,Shirt,03/30/2026,Mastercard,Refund,($28.50),$0.00,($28.50),30935-57-2,Member Billing Collect at Club`,
  '"","","","",,,,,,,,,,,,,,,,',
].join('\n')

test('isDbxLayout spots the DBX columns only', () => {
  assert.equal(isDbxLayout({ Textbox1: 'x', location_num: '1', date_key: '01/01/2026' }), true)
  assert.equal(isDbxLayout({ Textbox16: 'x', CLUB_NUMBER: '1', DATE_KEY: '01/01/2026' }), false)
})

test('DBX export: period, total and rows parse like the original layout', () => {
  const out = parseRevenueCsv(Buffer.from('﻿' + csv))
  assert.equal(out.period_start, '2025-11-01')
  assert.equal(out.period_end, '2026-11-09')
  assert.equal(out.reported_total, 1071.5)
  assert.equal(out.rows.length, 2)

  const [a, b] = out.rows
  assert.equal(a.club_number, '30935')
  assert.equal(a.location_slug, 'salem')
  assert.equal(a.payment_date, '2026-04-15')
  assert.equal(a.payment_amount, 1100)
  assert.equal(a.total_amount, 1100)
  assert.equal(a.profit_center, 'DUES')
  assert.equal(a.payment_type, 'VISA')
  assert.equal(a.membership_type_code, 'PREMIU')
  assert.equal(a.receipt_number, '30935-57-1')

  assert.equal(b.payment_amount, -28.5)
  assert.equal(b.profit_center, 'PRO SHOP')

  const sum = out.rows.reduce((s, r) => s + r.payment_amount, 0)
  assert.equal(sum.toFixed(2), out.reported_total.toFixed(2))
})
