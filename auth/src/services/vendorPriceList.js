// Vendor price-list CSV parsing + cost derivation. Pure and unit-tested; the
// admin endpoints feed an uploaded CSV buffer through here. Tuned for the
// SportLife "Master Product List" layout (a messy multi-row header, then data),
// but column detection is by header name so it tolerates column reordering.
//
// Cost model (per Justin): EDLP is the TRUE wholesale cost (per case); MAP is
// the retail price. Per-unit cost = EDLP / pack size (12 for a 12pk, 1 otherwise).

// Minimal RFC4180 CSV parser: handles quoted fields with embedded commas,
// newlines, and "" escapes. Returns an array of string-arrays.
function parseCsv(s) {
  const rows = []
  let row = [], field = '', inQ = false
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (inQ) {
      if (c === '"') { if (str[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '')
const toMoney = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null }

// Pull pack size from a "12pk" / "12 ct" / "12 pack" style string; default 1.
function packSizeFrom(size, product) {
  for (const s of [size, product]) {
    const m = String(s || '').match(/(\d+)\s*(?:pk|pack|ct|count)\b/i)
    if (m) { const n = parseInt(m[1], 10); if (n > 0) return n }
  }
  return 1
}

// Locate the header row (the one containing SKU + UPC) and map column indexes by
// name, so the data rows that follow can be read regardless of exact ordering.
function findColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = rows[r].map(c => String(c || '').toUpperCase())
    const idx = {}
    cells.forEach((c, i) => {
      const t = c.replace(/\s+/g, ' ').trim()
      if (t === 'SKU' || t.startsWith('SLD SKU')) idx.sku ??= i
      else if (t === 'UPC' || t.startsWith('UPC')) idx.upc ??= i
      else if (t.includes('INDIVIDUAL UNIT UPC') || t.includes('UNIT UPC')) idx.unitUpc ??= i
      else if (t === 'PRODUCT' || t.startsWith('TITLE')) idx.product ??= i
      else if (t === 'SIZE' || t.startsWith('PRODUCT SIZE')) idx.size ??= i
      else if (t === 'FLAVOR' || t.startsWith('PRODUCT FLAVOR')) idx.flavor ??= i
      else if (t === 'EDLP' || t.startsWith('EDLP')) idx.edlp ??= i
      else if (t === 'MAP' || t.startsWith('MAP PRICE')) idx.map ??= i
    })
    if (idx.sku != null && idx.upc != null && idx.edlp != null) return { headerRow: r, idx }
  }
  return null
}

// Parse a price-list CSV into normalized rows. Returns
// { rows: [...], skipped: n, columns } — never throws on a stray row.
// Each row: { sku, product_name, upc, unit_upc, pack_size, case_cost, unit_cost, map_price }
function parsePriceListCsv(text) {
  const records = parseCsv(text)
  const found = findColumns(records)
  if (!found) throw new Error('Could not find the SKU / UPC / EDLP columns in this CSV')
  const { headerRow, idx } = found
  const out = []
  let skipped = 0
  for (let r = headerRow + 1; r < records.length; r++) {
    const cells = records[r]
    const sku = String(cells[idx.sku] || '').trim()
    if (!/^[A-Za-z]?\d{3,}$/.test(sku) && !/^S\d{3,}$/.test(sku)) { if (sku) skipped++; continue }
    const product = [cells[idx.product], cells[idx.flavor]].map(x => String(x || '').trim()).filter(Boolean).join(' ').trim()
    const caseCost = idx.edlp != null ? toMoney(cells[idx.edlp]) : null
    const packSize = packSizeFrom(idx.size != null ? cells[idx.size] : '', product)
    out.push({
      sku,
      product_name: product || null,
      upc: idx.upc != null ? (digits(cells[idx.upc]) || null) : null,
      unit_upc: idx.unitUpc != null ? (digits(cells[idx.unitUpc]) || null) : null,
      pack_size: packSize,
      case_cost: caseCost,
      unit_cost: caseCost != null && packSize > 0 ? +(caseCost / packSize).toFixed(4) : null,
      map_price: idx.map != null ? toMoney(cells[idx.map]) : null,
    })
  }
  return { rows: out, skipped, columns: idx }
}

module.exports = { parsePriceListCsv, packSizeFrom, parseCsv }
