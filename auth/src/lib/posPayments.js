const { num } = require('../services/abcInventory')
const { tenderCategory } = require('./tenderCategory')

// A POS line's payments may be absent, a single object, or an array. Normalize
// to a flat array of typed rows.
function extractItemPayments(rawItem) {
  const p = rawItem && rawItem.payments
  const list = Array.isArray(p) ? p : (p && typeof p === 'object' ? [p] : [])
  return list.filter(Boolean).map(pay => ({
    payment_type: pay.paymentType || null,
    payment_amount: num(pay.paymentAmount),
    payment_tax: num(pay.paymentTax),
    tender_category: tenderCategory(pay.paymentType),
  }))
}

module.exports = { extractItemPayments }
