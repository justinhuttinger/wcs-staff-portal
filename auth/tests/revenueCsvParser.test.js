const test = require('node:test')
const assert = require('node:assert/strict')
const { parseMoney, parseDate } = require('../src/services/revenueCsvParser')

test('parseMoney handles plain dollars', () => {
  assert.equal(parseMoney('$24.50'), 24.5)
})

test('parseMoney handles commas', () => {
  assert.equal(parseMoney('$1,234.56'), 1234.56)
})

test('parseMoney handles quoted commas', () => {
  assert.equal(parseMoney('"$262,386.78"'), 262386.78)
})

test('parseMoney handles parens as negative (refund)', () => {
  assert.equal(parseMoney('($40.00)'), -40)
})

test('parseMoney handles empty/blank as 0', () => {
  assert.equal(parseMoney(''), 0)
  assert.equal(parseMoney(null), 0)
  assert.equal(parseMoney(undefined), 0)
})

test('parseMoney handles zero', () => {
  assert.equal(parseMoney('$0.00'), 0)
})

test('parseDate converts MM/DD/YYYY to ISO', () => {
  assert.equal(parseDate('05/12/2026'), '2026-05-12')
})

test('parseDate handles single-digit-via-leading-zero MM/DD', () => {
  assert.equal(parseDate('01/05/2024'), '2024-01-05')
})

test('parseDate returns null for blank/invalid', () => {
  assert.equal(parseDate(''), null)
  assert.equal(parseDate(null), null)
  assert.equal(parseDate('garbage'), null)
})

const { parseHeaderMeta } = require('../src/services/revenueCsvParser')

test('parseHeaderMeta extracts period and total from Textbox16', () => {
  const tb = 'Location: All Locations | Date: 05/01/2026 - 05/12/2026 | Total Revenue: $262,386.78'
  assert.deepEqual(parseHeaderMeta(tb), {
    period_start: '2026-05-01',
    period_end: '2026-05-12',
    reported_total: 262386.78,
  })
})

test('parseHeaderMeta handles single-day period', () => {
  const tb = 'Location: All Locations | Date: 05/12/2026 - 05/12/2026 | Total Revenue: $5,000.00'
  assert.deepEqual(parseHeaderMeta(tb), {
    period_start: '2026-05-12',
    period_end: '2026-05-12',
    reported_total: 5000,
  })
})

test('parseHeaderMeta returns null on unrecognized string', () => {
  assert.equal(parseHeaderMeta('Some other subject line'), null)
  assert.equal(parseHeaderMeta(''), null)
  assert.equal(parseHeaderMeta(null), null)
})

const fs = require('node:fs')
const path = require('node:path')
const { parseRevenueCsv } = require('../src/services/revenueCsvParser')

const FIXTURE = path.join(__dirname, 'fixtures', 'revenue-sample.csv')
const hasFixture = fs.existsSync(FIXTURE)

test('parseRevenueCsv reads the 12-day sample end-to-end', { skip: !hasFixture && 'fixture missing; copy it into auth/tests/fixtures/' }, () => {
  const buf = fs.readFileSync(FIXTURE)
  const result = parseRevenueCsv(buf)

  assert.equal(result.period_start, '2026-05-01')
  assert.equal(result.period_end, '2026-05-12')
  assert.equal(result.reported_total, 262386.78)

  // All parsed rows pass WCS club filter
  assert.ok(result.rows.length > 0, 'expected > 0 parsed rows')
  for (const r of result.rows) {
    assert.ok(['salem','keizer','eugene','springfield','clackamas','medford','milwaukie'].includes(r.location_slug),
      `unexpected location_slug ${r.location_slug}`)
    assert.ok(r.payment_date.match(/^\d{4}-\d{2}-\d{2}$/), `bad payment_date ${r.payment_date}`)
    assert.ok(typeof r.payment_amount === 'number', 'payment_amount must be a number')
    assert.ok(r.profit_center, 'profit_center required')
  }

  // Computed total should match reported total within 1 cent
  const computed = result.rows.reduce((s, r) => s + r.payment_amount, 0)
  assert.ok(Math.abs(computed - result.reported_total) < 0.01,
    `computed ${computed} != reported ${result.reported_total}`)

  // At least one refund row should be negative
  const refunds = result.rows.filter(r => r.payment_amount < 0)
  assert.ok(refunds.length > 0, 'expected at least one negative refund row')

  // Milwaukie rows should exist (East Side Athletic Club, club 31601)
  const milwaukie = result.rows.filter(r => r.location_slug === 'milwaukie')
  assert.ok(milwaukie.length > 0, 'expected Milwaukie rows from club 31601')
  for (const r of milwaukie) assert.equal(r.club_number, '31601')
})

test('parseRevenueCsv skips rows with unknown club_number', () => {
  // Build a minimal in-memory CSV with one known + one unknown club
  const csv = [
    'Textbox16,CLUB_NAME,CLUB_NUMBER,PAYMENT_CLUB,HOME_CLUB,MEMBER_NUMBER,AGREEMENT_NUMBER,LAST_NAME,FIRST_NAME,BILLING_TYPE,BILLING_MODE,BILLING_FREQUENCY,MEMBERSHIP_TYPE_ABC_CODE,PROFIT_CENTER,CATALOG_ITEM,DATE_KEY,PAYMENT_TYPE,PAYMENT_CODE_DESCRIPTION,TOTAL_AMOUNT3,TAX_AMOUNT,PAYMENT_AMOUNT,RECEIPT_NUMBER,COLLECTED_METHOD,GL_CODE,Textbox69,CLUB_NUMBER_I2,TOTAL_AMOUNT4,Textbox86,PAYMENT_AMOUNT1,CLUB_NUMBER_I1,TOTAL_AMOUNT5,Textbox64,PAYMENT_AMOUNT2',
    '"Location: All Locations | Date: 05/01/2026 - 05/01/2026 | Total Revenue: $100.00",WEST COAST STRENGTH SALEM,30935,30935,30935,001,30935001,DOE,JOHN,,,,SGL,DUES,DUES PAYMENT,05/01/2026,VISA,,$100.00,$0.00,$100.00,R1,POS Club Collected,,Total DUES,1,$100.00,$0.00,$100.00,1,$100.00,$0.00,$100.00',
    '"Location: All Locations | Date: 05/01/2026 - 05/01/2026 | Total Revenue: $100.00",SOME OTHER GYM,99999,99999,99999,002,99999002,SMITH,JANE,,,,SGL,DUES,DUES PAYMENT,05/01/2026,VISA,,$50.00,$0.00,$50.00,R2,POS Club Collected,,Total DUES,1,$100.00,$0.00,$100.00,1,$100.00,$0.00,$100.00',
  ].join('\n')
  const result = parseRevenueCsv(Buffer.from(csv))
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].location_slug, 'salem')
  assert.equal(result.skipped.unknown_club, 1)
})
