// Pure helpers for invoice order-number identity. Order numbers group the pages
// of one delivery into a single invoice; they are globally unique per order.

function normalizeOrderNumber(raw) {
  if (raw == null) return null
  const s = String(raw).replace(/\s+/g, ' ').trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').trim()
  return s ? s.toUpperCase() : null
}

module.exports = { normalizeOrderNumber }
