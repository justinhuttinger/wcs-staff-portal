// Sellable-inventory gate for the Inventory tool.
//
// The catalog API (GET /{club}/clubs/items) gives a reliable `category` for
// every item but NOT a profit center (that only rides POS sale lines). So the
// module decides what's "sellable retail" from the catalog category, plus a
// barcode catch for real products ABC left uncategorized (those have a numeric
// UPC; fees/passes/challenges use text pseudo-UPCs like "Challenge"/"GIFTCARD").
//
// SELLABLE_PROFIT_CENTERS is still used for the POS-based profit report and the
// POS stock-movement gate, where the profit center IS present and reliable.

const splitEnv = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean)

const SELLABLE_PROFIT_CENTERS = splitEnv(process.env.INVENTORY_SELLABLE_PROFIT_CENTERS).length
  ? splitEnv(process.env.INVENTORY_SELLABLE_PROFIT_CENTERS)
  : ['WCS Drinks', 'WCS Snacks', 'WCS Supplements', 'WCS Merchandise', 'WCS Tanning']

const SELLABLE_CATEGORIES = splitEnv(process.env.INVENTORY_SELLABLE_CATEGORIES).length
  ? splitEnv(process.env.INVENTORY_SELLABLE_CATEGORIES)
  : ['Drinks', 'Snacks', 'Supplements', 'Merchandise', 'Tannning', 'Tanning']

const PC_SET = new Set(SELLABLE_PROFIT_CENTERS)
const CAT_SET = new Set(SELLABLE_CATEGORIES)
const BARCODE_RE = /^\d{6,}$/

// A POS sale line is sellable purely by its profit center.
function isSellableProfitCenter(profitCenter) {
  return profitCenter != null && PC_SET.has(profitCenter)
}

// A catalog item is sellable if its category is a retail category, or it has a
// real scannable barcode (catches uncategorized retail; fees/passes don't).
function isSellableItem(item) {
  if (item.category && CAT_SET.has(item.category)) return true
  return !!(item.upc && BARCODE_RE.test(item.upc))
}

module.exports = {
  SELLABLE_PROFIT_CENTERS,
  SELLABLE_CATEGORIES,
  isSellableProfitCenter,
  isSellableItem,
}
