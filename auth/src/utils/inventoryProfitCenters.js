// Sellable-inventory gate for the Inventory tool.
//
// ABC's POS catalog mixes real retail goods (drinks, snacks, supplements,
// merch, tanning) with non-stock line items: membership dues, enrollment and
// guest fees, day passes, training, swim lessons, club-account payments, etc.
// Only the retail goods are physical inventory we count and can oversell, so
// the whole module is restricted to a handful of ABC "profit centers".
//
// Profit center is the source of truth, but it only rides on POS *sale lines*
// — a catalog item that has never sold has no profit center yet. For those we
// fall back to the catalog category, which maps 1:1 onto the profit center
// (Drinks -> WCS Drinks, etc.; note ABC misspells "Tannning").
//
// Both lists are overridable via env (comma-separated) so the allowlist can be
// tuned without a deploy.

const splitEnv = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean)

const SELLABLE_PROFIT_CENTERS = splitEnv(process.env.INVENTORY_SELLABLE_PROFIT_CENTERS).length
  ? splitEnv(process.env.INVENTORY_SELLABLE_PROFIT_CENTERS)
  : ['WCS Drinks', 'WCS Snacks', 'WCS Supplements', 'WCS Merchandise', 'WCS Tanning']

const SELLABLE_CATEGORIES = splitEnv(process.env.INVENTORY_SELLABLE_CATEGORIES).length
  ? splitEnv(process.env.INVENTORY_SELLABLE_CATEGORIES)
  : ['Drinks', 'Snacks', 'Supplements', 'Merchandise', 'Tanning', 'Tannning', 'Drinks & Accessories']

const PC_SET = new Set(SELLABLE_PROFIT_CENTERS)
const CAT_SET = new Set(SELLABLE_CATEGORIES)

// A POS sale line is sellable purely by its profit center.
function isSellableProfitCenter(profitCenter) {
  return profitCenter != null && PC_SET.has(profitCenter)
}

// A catalog item is sellable if its (POS-derived) profit center qualifies, or,
// for items not yet sold, if its catalog category qualifies.
function isSellableItem(item) {
  if (item.profit_center) return PC_SET.has(item.profit_center)
  return item.category != null && CAT_SET.has(item.category)
}

// PostgREST `.or()` argument that keeps a Supabase inventory_items query to
// sellable rows: profit_center in (...) OR category in (...). Values are
// quoted so spaces/`&` survive.
function sellableItemsOrFilter() {
  const quote = (vals) => vals.map(v => `"${v}"`).join(',')
  return `profit_center.in.(${quote(SELLABLE_PROFIT_CENTERS)}),category.in.(${quote(SELLABLE_CATEGORIES)})`
}

module.exports = {
  SELLABLE_PROFIT_CENTERS,
  SELLABLE_CATEGORIES,
  isSellableProfitCenter,
  isSellableItem,
  sellableItemsOrFilter,
}
