// Membership Price Breakdown Excel workbook.
//
// Two sheets:
//   Price Summary — one row per price point, one column per club (+ Total),
//                   so "how many members pay $50 at each club" reads straight
//                   across. Mirrors the on-screen matrix.
//   Members       — the detail list backing it: one row per active member with
//                   the amount as charged, the payment frequency, and the
//                   monthly-equivalent price used for grouping.
//
// exceljs is already a dependency (used by the roster + trends exports).

const CLUB_SLUG_MAP = {
  '30935': 'salem', '31599': 'keizer', '7655': 'eugene',
  '31598': 'springfield', '31600': 'clackamas', '31601': 'milwaukie', '32073': 'medford',
}
// Display order matches the portal's location list, not club-number order.
const CLUB_ORDER = ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0102F' } }
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }

function title(slug) {
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : ''
}

function styleHeader(row) {
  row.eachCell(cell => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  row.height = 22
}

/**
 * @param {object} input
 * @param {Array}  input.detail    rows from membership_price_detail (club_number, …)
 * @param {Array}  input.breakdown rows from membership_price_breakdown
 * @param {string[]|null} input.clubSlugs clubs in scope (null = all)
 * @param {'monthly'|'charged'} input.basis which price column groups the summary
 * @returns {Promise<Buffer>}
 */
async function buildPriceWorkbook({ detail = [], breakdown = [], clubSlugs = null, basis = 'monthly' }) {
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'WCS Staff Portal'
  wb.created = new Date()

  const clubs = CLUB_ORDER.filter(s => !clubSlugs || clubSlugs.includes(s))
  const priceKey = basis === 'charged' ? 'charged_amount' : 'monthly_price'
  const basisLabel = basis === 'charged' ? 'Amount as Charged' : 'Monthly Equivalent'

  // --- Sheet 1: price × club matrix -----------------------------------------
  const sum = wb.addWorksheet('Price Summary', { views: [{ state: 'frozen', ySplit: 1 }] })
  sum.columns = [
    { header: `Price (${basisLabel})`, key: 'price', width: 24 },
    ...clubs.map(s => ({ header: title(s), key: s, width: 13 })),
    { header: 'Total Members', key: 'total', width: 15 },
    { header: 'Monthly Revenue', key: 'revenue', width: 17 },
  ]
  styleHeader(sum.getRow(1))

  // price -> { slug: count }
  const byPrice = new Map()
  for (const r of breakdown) {
    const price = Number(r[priceKey]) || 0
    const slug = CLUB_SLUG_MAP[r.club_number] || r.club_number
    if (!byPrice.has(price)) byPrice.set(price, {})
    const bucket = byPrice.get(price)
    bucket[slug] = (bucket[slug] || 0) + (Number(r.members) || 0)
  }
  const prices = [...byPrice.keys()].sort((a, b) => b - a)
  for (const price of prices) {
    const bucket = byPrice.get(price)
    const total = clubs.reduce((n, s) => n + (bucket[s] || 0), 0)
    const row = sum.addRow({
      price,
      ...Object.fromEntries(clubs.map(s => [s, bucket[s] || 0])),
      total,
      revenue: price * total,
    })
    row.getCell('price').numFmt = '$#,##0.00'
    row.getCell('revenue').numFmt = '$#,##0.00'
  }
  const totalRow = sum.addRow({
    price: 'Total',
    ...Object.fromEntries(clubs.map(s => [
      s, prices.reduce((n, p) => n + (byPrice.get(p)[s] || 0), 0),
    ])),
    total: prices.reduce((n, p) => n + clubs.reduce((m, s) => m + (byPrice.get(p)[s] || 0), 0), 0),
    revenue: prices.reduce((n, p) => n + p * clubs.reduce((m, s) => m + (byPrice.get(p)[s] || 0), 0), 0),
  })
  totalRow.font = { bold: true }
  totalRow.getCell('revenue').numFmt = '$#,##0.00'

  // --- Sheet 2: member detail -----------------------------------------------
  const det = wb.addWorksheet('Members', { views: [{ state: 'frozen', ySplit: 1 }] })
  det.columns = [
    { header: 'Club', key: 'club', width: 13 },
    { header: 'First Name', key: 'first_name', width: 16 },
    { header: 'Last Name', key: 'last_name', width: 18 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Agreement #', key: 'agreement_number', width: 16 },
    { header: 'Membership Type', key: 'membership_type', width: 34 },
    { header: 'Frequency', key: 'payment_frequency', width: 13 },
    { header: 'Amount Charged', key: 'charged_amount', width: 16 },
    { header: 'Monthly Equivalent', key: 'monthly_price', width: 18 },
    { header: 'Begin Date', key: 'begin_date', width: 13 },
    { header: 'Tenure (mo)', key: 'tenure_months', width: 12 },
    { header: 'Past Due', key: 'is_past_due', width: 10 },
    { header: 'Sold By', key: 'sales_person_name', width: 20 },
  ]
  styleHeader(det.getRow(1))
  for (const r of detail) {
    const row = det.addRow({
      club: title(CLUB_SLUG_MAP[r.club_number] || r.club_number),
      first_name: r.first_name || '',
      last_name: r.last_name || '',
      email: r.email || '',
      agreement_number: r.agreement_number || '',
      membership_type: r.membership_type || '',
      payment_frequency: r.payment_frequency || '',
      charged_amount: Number(r.charged_amount) || 0,
      monthly_price: Number(r.monthly_price) || 0,
      begin_date: r.begin_date || '',
      tenure_months: r.tenure_months == null ? '' : Number(r.tenure_months),
      is_past_due: r.is_past_due ? 'Yes' : 'No',
      sales_person_name: r.sales_person_name || '',
    })
    row.getCell('charged_amount').numFmt = '$#,##0.00'
    row.getCell('monthly_price').numFmt = '$#,##0.00'
  }
  det.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: det.columns.length } }

  return wb.xlsx.writeBuffer().then(ab => Buffer.from(ab))
}

module.exports = { buildPriceWorkbook, CLUB_SLUG_MAP, CLUB_ORDER }
