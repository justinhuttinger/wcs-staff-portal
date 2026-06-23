// Per-unit normalization for invoice (OCR) lines.
//
// Catalog items are tracked as the INDIVIDUAL sale unit (one can/bar), but vendor
// invoices price and count by the CASE (e.g. a "12pk" line at $18.52/case). Left
// alone, receiving would store the case price as the per-can cost and add only one
// unit to stock. This module converts a case-priced line to per-individual-unit
// cost and count, so receiving is correct no matter the source.
//
// Pack size comes from the vendor price list (vendor_sku_upc) when the SKU is
// known — that's authoritative — and falls back to parsing "12pk"/"12 ct" out of
// the line description.

const { packSizeFrom } = require('../services/vendorPriceList')

// line:    { description, quantity, unit_cost }  (unit_cost = whatever the invoice showed)
// packRow: optional vendor_sku_upc row { pack_size, case_cost, unit_cost }
// Returns: { quantity, unit_cost, pack_size, divided }
function packUnitize(line, packRow) {
  const descPack = packSizeFrom(line.description || '', line.description || '')
  const packSize = packRow && packRow.pack_size > 1 ? packRow.pack_size : descPack

  let quantity = line.quantity
  let unitCost = line.unit_cost
  let divided = false

  if (packSize > 1 && unitCost != null) {
    // Default: the invoice cost is a CASE price and needs dividing. When the price
    // list gives us both reference prices, only divide if the invoice cost is
    // closer to the case price than the per-unit price — this avoids
    // double-dividing an invoice that already lists per-unit pricing.
    let divide = true
    if (packRow && packRow.unit_cost != null && packRow.case_cost != null) {
      divide = Math.abs(unitCost - packRow.case_cost) <= Math.abs(unitCost - packRow.unit_cost)
    }
    if (divide) {
      unitCost = +(unitCost / packSize).toFixed(4)
      if (quantity != null) quantity = quantity * packSize
      divided = true
    }
  }

  return { quantity, unit_cost: unitCost, pack_size: packSize, divided }
}

module.exports = { packUnitize }
