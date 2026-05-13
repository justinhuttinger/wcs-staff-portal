// ABC "Revenue by Profit Center" CSV parser.
// Pure functions only — no DB, no I/O. Consumed by routes/revenue.js.
//
// Spec: docs/superpowers/specs/2026-05-13-revenue-reporting-design.md

// WCS-only club mapping. Anything not in this map is skipped at parse time.
// 31601 ("EAST SIDE ATHLETIC CLUB" in ABC) is Milwaukie's trade name.
const CLUB_MAP = {
  '30935': 'salem',
  '31599': 'keizer',
  '07655': 'eugene',
  '31598': 'springfield',
  '31600': 'clackamas',
  '32073': 'medford',
  '31601': 'milwaukie',
}

function parseMoney(raw) {
  if (raw === null || raw === undefined || raw === '') return 0
  let s = String(raw).trim()
  // Strip surrounding double quotes (CSV preserves them inside cells when commas are present)
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim()
  let negative = false
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true
    s = s.slice(1, -1).trim()
  }
  s = s.replace(/[$,]/g, '')
  if (s === '' || s === '-') return 0
  const n = Number(s)
  if (Number.isNaN(n)) return 0
  return negative ? -n : n
}

function parseDate(raw) {
  if (!raw) return null
  const m = String(raw).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[1]}-${m[2]}`
}

function parseHeaderMeta(textbox16) {
  if (!textbox16) return null
  const s = String(textbox16)
  const dateMatch = s.match(/Date:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/)
  const totalMatch = s.match(/Total Revenue:\s*\$?([\d,]+\.\d{2})/)
  if (!dateMatch || !totalMatch) return null
  const period_start = parseDate(dateMatch[1])
  const period_end = parseDate(dateMatch[2])
  const reported_total = Number(totalMatch[1].replace(/,/g, ''))
  if (!period_start || !period_end || Number.isNaN(reported_total)) return null
  return { period_start, period_end, reported_total }
}

const { parse: parseSync } = require('csv-parse/sync')

function parseRevenueCsv(buffer) {
  const text = buffer.toString('utf8').replace(/\r\n/g, '\n')

  // csv-parse `relax_*` flags absorb the ABC report's footer junk + smart quotes
  let records
  try {
    records = parseSync(text, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      trim: false,
    })
  } catch (err) {
    return {
      period_start: null,
      period_end: null,
      reported_total: null,
      rows: [],
      skipped: { unknown_club: 0, missing_date: 0, missing_amount: 0, bad_shape: 0 },
      errors: [`csv-parse failed: ${err.message}`],
    }
  }

  let header = null
  const rows = []
  const skipped = { unknown_club: 0, missing_date: 0, missing_amount: 0, bad_shape: 0 }
  const errors = []

  records.forEach((rec, idx) => {
    // First row that has a non-empty Textbox16 carries the period + total
    if (!header && rec.Textbox16) {
      const meta = parseHeaderMeta(rec.Textbox16)
      if (meta) header = meta
    }

    const clubNumber = (rec.CLUB_NUMBER || '').trim()
    if (!clubNumber) {
      skipped.bad_shape += 1
      return
    }
    const slug = CLUB_MAP[clubNumber]
    if (!slug) {
      skipped.unknown_club += 1
      return
    }
    const payment_date = parseDate(rec.DATE_KEY)
    if (!payment_date) {
      skipped.missing_date += 1
      return
    }
    const payment_amount = parseMoney(rec.PAYMENT_AMOUNT)
    // We allow 0 amounts (zero-dollar membership rows exist in the data) but
    // skip rows that have neither a date nor any amount AND blank profit center.
    if (payment_amount === 0 && !rec.PROFIT_CENTER) {
      skipped.missing_amount += 1
      return
    }

    rows.push({
      source_row_index: idx,
      payment_date,
      club_number: clubNumber,
      location_slug: slug,
      member_number: (rec.MEMBER_NUMBER || '').trim() || null,
      agreement_number: (rec.AGREEMENT_NUMBER || '').trim() || null,
      member_first_name: (rec.FIRST_NAME || '').trim() || null,
      member_last_name: (rec.LAST_NAME || '').trim() || null,
      billing_type: (rec.BILLING_TYPE || '').trim() || null,
      membership_type_code: (rec.MEMBERSHIP_TYPE_ABC_CODE || '').trim() || null,
      profit_center: (rec.PROFIT_CENTER || '').trim(),
      catalog_item: (rec.CATALOG_ITEM || '').trim() || null,
      payment_code_desc: (rec.PAYMENT_CODE_DESCRIPTION || '').trim() || null,
      payment_type: (rec.PAYMENT_TYPE || '').trim() || null,
      collected_method: (rec.COLLECTED_METHOD || '').trim() || null,
      receipt_number: (rec.RECEIPT_NUMBER || '').trim() || null,
      gl_code: (rec.GL_CODE || '').trim() || null,
      payment_amount,
      total_amount: parseMoney(rec.TOTAL_AMOUNT3) || null,
      tax_amount: parseMoney(rec.TAX_AMOUNT) || null,
    })
  })

  return {
    period_start: header ? header.period_start : null,
    period_end: header ? header.period_end : null,
    reported_total: header ? header.reported_total : null,
    rows,
    skipped,
    errors,
  }
}

module.exports = {
  CLUB_MAP,
  parseMoney,
  parseDate,
  parseHeaderMeta,
  parseRevenueCsv,
}
