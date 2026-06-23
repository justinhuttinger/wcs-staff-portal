// Claude vision extraction for vendor invoices. The pure parsers are unit-tested;
// the network/SDK calls are thin and dependency-injected for testability.

const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk').Anthropic || require('@anthropic-ai/sdk')

const EXTRACTION_MODEL = 'claude-sonnet-4-6'
const apiKey = process.env.ANTHROPIC_API_KEY || process.env.MASTERMIND_ANTHROPIC_API_KEY

function getClient() { return apiKey ? new Anthropic({ apiKey }) : null }

const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }

// Non-product invoice lines (shipping, fees, taxes, totals) must never count as
// inventory cost. The model is told to omit them, but a "Processing Fee" or
// "Shipping Charge" can still slip through — so we also drop them deterministically.
// High-precision whole-word patterns: real drink/snack/supplement names don't
// contain these as standalone words (e.g. "coffee" does NOT match \bfee\b).
const NON_PRODUCT_PATTERNS = [
  /\bshipping\b/i, /\bfreight\b/i, /\bhandling\b/i, /\bpostage\b/i,
  /\bsurcharge\b/i, /fuel\s*surcharge/i, /\bs\s*&\s*h\b/i,
  /\bfee\b/i, /\bfees\b/i,
  /\bsubtotal\b/i, /sub-total/i, /\bdiscount\b/i,
  /sales\s*tax/i, /\btax\b/i, /\bgratuity\b/i,
]
function isNonProductLine(description) {
  const d = String(description || '')
  return NON_PRODUCT_PATTERNS.some(re => re.test(d))
}

function parseExtractionText(text) {
  const s = String(text || '')
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : s
  const start = body.indexOf('{'); const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object found')
  const jsonSlice = body.slice(start, end + 1)
  let obj
  try { obj = JSON.parse(jsonSlice) } catch { throw new Error('Invoice JSON was malformed or truncated') }
  const lines = (Array.isArray(obj.lines) ? obj.lines : []).map(l => {
    const quantity = toNum(l.quantity)
    const lineTotal = toNum(l.line_total)
    let unitCost = toNum(l.unit_cost)
    if (unitCost == null && lineTotal != null && quantity) unitCost = +(lineTotal / quantity).toFixed(4)
    return {
      vendor_sku: l.vendor_sku ? String(l.vendor_sku).trim().slice(0, 80) || null : null,
      description: l.description ? String(l.description).slice(0, 300) : '',
      upc: l.upc ? String(l.upc).replace(/\D/g, '') || null : null,
      quantity, unit_cost: unitCost, line_total: lineTotal,
    }
  }).filter(l => (l.description || l.quantity != null) && !isNonProductLine(l.description))
  return {
    vendor: obj.vendor ? String(obj.vendor).slice(0, 200) : null,
    order_number: obj.order_number != null ? String(obj.order_number) : null,
    invoice_date: obj.invoice_date ? String(obj.invoice_date).slice(0, 10) : null,
    total: toNum(obj.total),
    lines,
  }
}

function driveDownloadUrl(fileLink) {
  const m = String(fileLink || '').match(/\/file\/d\/([^/]+)/)
  return m ? `https://www.googleapis.com/drive/v3/files/${m[1]}?alt=media&supportsAllDrives=true` : null
}

const SYSTEM = [
  'You read vendor invoices/packing slips for a retail store and return STRICT JSON only.',
  'Schema: {"vendor":string|null,"order_number":string|null,"invoice_date":"YYYY-MM-DD"|null,',
  '"total":number|null,"lines":[{"vendor_sku":string|null,"description":string,"upc":string|null,',
  '"quantity":number,"unit_cost":number|null,"line_total":number|null}]}.',
  'order_number is the order/PO number, usually top-right (e.g. labeled "Order #").',
  'total is the grand total, which may appear only on the LAST page.',
  'INCLUDE ONLY purchasable PRODUCT lines. OMIT any subtotal, discount, shipping,',
  'freight, handling, processing fee, service fee, surcharge, tax, or summary rows',
  '(e.g. rows whose Type is Subtotal/Discount/Shipping, or labeled "Processing Fee").',
  'vendor_sku is the vendor item/SKU number on the line (e.g. an "Item" column value like S1181001); null if none.',
  'description is the clean product name only; EXCLUDE trailing lot/expiration text',
  'such as "4 ea - Lot#: 510731049 ExpDate: Aug 1, 2027".',
  'Use the per-unit price for unit_cost; if only an extended/line total is shown, leave unit_cost null and set line_total.',
  'Do not invent values. Return ONLY the JSON object, no prose.',
  '',
  'Example: a line shown as',
  '"1  Sale  S1181001  Top Secret Nutrition Fireball L-Carnitine Liquid w/ Paradoxine 16oz Cherry',
  ' 4 ea - Lot#: 510731049 ExpDate: Aug 1, 2027   $14.61   4 ea   $58.44"',
  'becomes {"vendor_sku":"S1181001","description":"Top Secret Nutrition Fireball L-Carnitine Liquid w/ Paradoxine 16oz Cherry",',
  '"upc":null,"quantity":4,"unit_cost":14.61,"line_total":58.44}.',
  'A "Subtotal", "Shipping Charge", "Processing Fee", or "Handling" row is NOT a',
  'product and must be omitted entirely.',
].join('\n')

async function extractFromPages(pages, { token, client }) {
  const c = client || getClient()
  if (!c) throw new Error('Anthropic client not initialized (ANTHROPIC_API_KEY missing)')
  const content = []
  for (const p of pages) {
    const url = driveDownloadUrl(p.file_link)
    if (!url) continue
    const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } })
    const buf = Buffer.from(await resp.arrayBuffer())
    const b64 = buf.toString('base64')
    const mime = p.mime_type || 'image/jpeg'
    if (mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } })
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } })
    }
  }
  if (!content.some(b => b.type === 'image' || b.type === 'document')) {
    throw new Error('No readable pages (could not fetch any uploaded file)')
  }
  content.push({ type: 'text', text: 'Extract this invoice as JSON.' })
  const resp = await c.messages.create({
    model: EXTRACTION_MODEL, max_tokens: 4096, system: SYSTEM,
    messages: [{ role: 'user', content }],
  })
  const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
  return parseExtractionText(text)
}

module.exports = { parseExtractionText, isNonProductLine, driveDownloadUrl, extractFromPages, getClient, EXTRACTION_MODEL }
