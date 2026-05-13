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

module.exports = {
  CLUB_MAP,
  parseMoney,
  parseDate,
  parseHeaderMeta,
}
