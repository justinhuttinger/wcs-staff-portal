// Pure helpers for the print queue. No DB, no I/O — unit-testable.

function dedupeKey(type, locationSlug, businessDate) {
  return `${type}:${String(locationSlug).toLowerCase()}:${businessDate}`
}

// Translate an ILIKE pattern (only % wildcards used) to a case-insensitive test.
function matchAutomation(automation, jobName) {
  if (!automation || !automation.enabled) return false
  const pat = String(automation.job_name_match || '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')   // escape regex specials
    .replace(/%/g, '.*')                        // % -> .*
  return new RegExp(`^${pat}$`, 'i').test(String(jobName || ''))
}

function buildTillReceiptPayload(recon) {
  return {
    type: 'till_close',
    location: recon.location_slug,
    date: recon.business_date,
    closedBy: recon.closed_by || '',
    float: recon.opening_float,
    cashSales: recon.cash_sales,
    cashRefunds: recon.cash_refunds,
    dropsTotal: recon.cash_drops,
    expected: recon.expected_close,
    counted: recon.counted_close,
    overShort: recon.over_short,
    bagDrop: recon.bag_drop,
    drops: Array.isArray(recon.drops) ? recon.drops : [],
  }
}

module.exports = { dedupeKey, matchAutomation, buildTillReceiptPayload }
