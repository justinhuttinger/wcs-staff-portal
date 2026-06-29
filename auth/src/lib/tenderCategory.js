// Normalize ABC's free-form paymentType strings into drawer-relevant buckets.
// Masked card forms look like "Visa(xxxx6263)" — strip the suffix before match.
function tenderCategory(paymentType) {
  const raw = String(paymentType || '').trim()
  if (!raw) return 'other'
  const base = raw.replace(/\(.*\)\s*$/, '').trim().toLowerCase()
  if (base === 'cash') return 'cash'
  if (base === 'check') return 'check'
  if (base === 'club account') return 'account'
  if (base === 'write off') return 'writeoff'
  if (['visa', 'master card', 'mastercard', 'american express', 'amex', 'discover'].includes(base)) return 'card'
  return 'other'
}

module.exports = { tenderCategory }
