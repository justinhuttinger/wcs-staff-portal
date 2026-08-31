// Pure helpers for the print queue. No DB, no I/O — unit-testable.

function dedupeKey(type, locationSlug, businessDate) {
  return `${type}:${String(locationSlug).toLowerCase()}:${businessDate}`
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
    // Cash logged in and out through the portal's Till tile, separate from the
    // register-rung drops above so the receipt shows where each pull came from.
    manualOut: recon.manual_out || 0,
    manualIn: recon.manual_in || 0,
    expected: recon.expected_close,
    counted: recon.counted_close,
    overShort: recon.over_short,
    bagDrop: recon.bag_drop,
    drops: Array.isArray(recon.drops) ? recon.drops : [],
    movements: Array.isArray(recon.movements) ? recon.movements : [],
  }
}

module.exports = { dedupeKey, buildTillReceiptPayload }
