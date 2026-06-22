// Deterministic invoice-line -> catalog-item matcher. Pure and unit-tested.
// Resolution order: UPC exact -> learned vendor alias -> fuzzy name -> unmatched.

const FUZZY_THRESHOLD = 0.6

function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function upcVariants(upc) {
  const base = String(upc || '').replace(/\D/g, '')
  if (!base) return []
  const set = new Set([base, base.replace(/^0+/, ''), base.padStart(12, '0')])
  set.delete('')
  return [...set]
}

// Jaccard token overlap — order-independent, cheap, good enough for product names.
function tokenScore(a, b) {
  const sa = new Set(normalizeText(a).split(' ').filter(Boolean))
  const sb = new Set(normalizeText(b).split(' ').filter(Boolean))
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return inter / (sa.size + sb.size - inter)
}

function matchLine(line, { items = [], aliases = [] } = {}) {
  const miss = { item_id: null, match_source: null, match_confidence: null }

  // 1. UPC exact (with leading-zero/padded variants on both sides).
  const lineUpcs = new Set(upcVariants(line.upc))
  if (lineUpcs.size) {
    for (const it of items) {
      if (upcVariants(it.upc).some(v => lineUpcs.has(v))) {
        return { item_id: it.id, match_source: 'upc', match_confidence: 1 }
      }
    }
  }

  // 2. Vendor alias (alias_text already normalized; also allow UPC alias).
  const descNorm = normalizeText(line.description)
  for (const a of aliases) {
    if ((a.alias_text && a.alias_text === descNorm) ||
        (a.upc && lineUpcs.has(String(a.upc).replace(/\D/g, '')))) {
      return { item_id: a.item_id, match_source: 'alias', match_confidence: 1 }
    }
  }

  // 3. Fuzzy name.
  let best = miss, bestScore = 0
  for (const it of items) {
    const score = tokenScore(line.description, it.item_name)
    if (score > bestScore) { bestScore = score; best = { item_id: it.id, match_source: 'fuzzy', match_confidence: +score.toFixed(2) } }
  }
  return bestScore >= FUZZY_THRESHOLD ? best : miss
}

module.exports = { normalizeText, upcVariants, matchLine, FUZZY_THRESHOLD }
