// Inventory sync orchestration.
//
//  - Catalog sync (daily + on demand): mirror each club's ABC sale-item
//    catalog into inventory_items. Sale prices come from ABC; on-hand
//    quantity and cost basis are portal-owned and never touched here.
//  - POS sync (every 30 min + on demand): pull new POS transactions, store
//    them with line items, and post 'sale'/'return' movements against
//    matched items so qty_on_hand stays current.
//
// Scheduling lives here too (node-cron, like ghl-sync) — started from
// index.js unless INVENTORY_SYNC_DISABLED=1.

const cron = require('node-cron')
const { supabaseAdmin } = require('./supabase')
const { fetchCatalogItems, fetchPosTransactions, num } = require('./abcInventory')
const { ALL_SLUGS, SLUG_CLUB_MAP } = require('../utils/locationSlug')
const { isSellableProfitCenter } = require('../utils/inventoryProfitCenters')

// First POS sync looks back this far; later runs resume from the last sync
// minus a 1h overlap (the unique constraint dedupes the overlap).
const FIRST_SYNC_LOOKBACK_DAYS = 30
const OVERLAP_MS = 60 * 60 * 1000

const running = { catalog: false, pos: false }

async function setSyncState(clubNumber, kind, fields) {
  await supabaseAdmin.from('inventory_sync_state').upsert(
    { club_number: clubNumber, kind, ...fields },
    { onConflict: 'club_number,kind' },
  )
}

// --- Catalog ---------------------------------------------------------------

async function syncCatalogForClub(clubNumber) {
  const items = await fetchCatalogItems(clubNumber)
  const now = new Date().toISOString()

  const rows = items
    .filter(it => it.saleItemId && it.itemName)
    .map(it => ({
      club_number: clubNumber,
      sale_item_id: String(it.saleItemId),
      item_name: it.itemName,
      item_type: it.itemType || null,
      product_type: it.productType || null,
      category: it.itemCategoryName || null,
      description: it.itemDescription || null,
      upc: it.itemUpc || null,
      abc_unit_price: num(it.itemUnitPrice),
      abc_in_stock: it.inStock != null ? String(it.inStock) : null,
      archived: false,
      last_synced_at: now,
    }))

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabaseAdmin
      .from('inventory_items')
      .upsert(rows.slice(i, i + 200), { onConflict: 'club_number,sale_item_id' })
    if (error) throw new Error('catalog upsert failed: ' + error.message)
  }

  // Items that vanished from the catalog get archived (only when ABC actually
  // returned data — an empty response must not wipe the club).
  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from('inventory_items')
      .update({ archived: true })
      .eq('club_number', clubNumber)
      .eq('archived', false)
      .lt('last_synced_at', now)
    if (error) console.warn('[InventorySync] archive sweep failed:', error.message)
  }

  return rows.length
}

async function runCatalogSync(slugs = ALL_SLUGS) {
  if (running.catalog) return { skipped: true, reason: 'catalog sync already running' }
  running.catalog = true
  const results = {}
  try {
    for (const slug of slugs) {
      const clubNumber = SLUG_CLUB_MAP[slug]
      if (!clubNumber) continue
      await setSyncState(clubNumber, 'catalog', { last_status: 'running', last_error: null })
      try {
        const count = await syncCatalogForClub(clubNumber)
        results[slug] = { ok: true, items: count }
        await setSyncState(clubNumber, 'catalog', { last_status: 'ok', last_synced_at: new Date().toISOString() })
        console.log(`[InventorySync] catalog ${slug}: ${count} items`)
      } catch (err) {
        results[slug] = { ok: false, error: err.message }
        await setSyncState(clubNumber, 'catalog', { last_status: 'error', last_error: err.message })
        console.error(`[InventorySync] catalog ${slug} failed:`, err.message)
      }
    }
  } finally {
    running.catalog = false
  }
  return results
}

// --- POS transactions --------------------------------------------------------

// Cost snapshot for margin math: prefer the moving average, fall back to the
// most recent invoice cost.
const costOf = (item) => item ? (num(item.avg_unit_cost) ?? num(item.last_unit_cost)) : null

async function syncPosForClub(clubNumber) {
  const { data: state } = await supabaseAdmin
    .from('inventory_sync_state')
    .select('last_synced_at')
    .eq('club_number', clubNumber).eq('kind', 'pos')
    .maybeSingle()

  const from = state?.last_synced_at
    ? new Date(new Date(state.last_synced_at).getTime() - OVERLAP_MS)
    : new Date(Date.now() - FIRST_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const to = new Date()

  const txns = await fetchPosTransactions(clubNumber, from, to)
  if (txns.length === 0) return { transactions: 0, newTransactions: 0, movements: 0 }

  // Catalog lookup maps for line-item matching.
  const { data: catalog, error: catErr } = await supabaseAdmin
    .from('inventory_items')
    .select('id, sale_item_id, upc, avg_unit_cost, last_unit_cost')
    .eq('club_number', clubNumber)
  if (catErr) throw new Error('catalog lookup failed: ' + catErr.message)
  const bySaleItemId = new Map((catalog || []).map(it => [String(it.sale_item_id), it]))
  const byUpc = new Map()
  for (const it of catalog || []) if (it.upc) byUpc.set(it.upc, it)

  let newCount = 0
  let movementCount = 0
  const qtyDeltas = new Map() // item uuid → total delta
  const pcByItem = new Map()  // item uuid → latest profit center (catalog backfill)

  for (const t of txns) {
    if (!t.transactionId) continue
    // Insert-if-absent; ignoreDuplicates + select returns the row only when
    // it was actually inserted, which is our "new transaction" signal.
    const { data: inserted, error } = await supabaseAdmin
      .from('inventory_transactions')
      .upsert({
        club_number: clubNumber,
        transaction_id: String(t.transactionId),
        transaction_at: t.transactionTimestamp,
        member_id: t.memberId,
        employee_id: t.employeeId,
        receipt_number: t.receiptNumber,
        station_name: t.stationName,
        is_return: t.isReturn,
        raw: t.raw,
      }, { onConflict: 'club_number,transaction_id', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error('transaction insert failed: ' + error.message)
    if (!inserted || inserted.length === 0) continue // already synced
    newCount++
    const txnPk = inserted[0].id

    const lineRows = []
    const movementRows = []
    t.items.forEach((it, idx) => {
      const match = (it.itemId && bySaleItemId.get(String(it.itemId))) || (it.upc && byUpc.get(it.upc)) || null
      const unitCost = costOf(match)
      lineRows.push({
        transaction_pk: txnPk,
        club_number: clubNumber,
        line_no: idx,
        abc_item_id: it.itemId,
        name: it.name,
        upc: it.upc,
        inventory_type: it.inventoryType,
        profit_center: it.profitCenter,
        catalog: it.catalog,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        subtotal: it.subtotal,
        tax: it.tax,
        item_id: match?.id || null,
        unit_cost_at_sale: unitCost,
      })
      // Only sellable retail lines move stock — dues, fees, passes, training,
      // etc. share the catalog but are not physical inventory. Their lines are
      // still recorded above (for profit/history) but never touch qty_on_hand.
      if (match && it.quantity && isSellableProfitCenter(it.profitCenter)) {
        if (it.profitCenter) pcByItem.set(match.id, it.profitCenter)
        const delta = t.isReturn ? Math.abs(it.quantity) : -Math.abs(it.quantity)
        movementRows.push({
          item_id: match.id,
          club_number: clubNumber,
          kind: t.isReturn ? 'return' : 'sale',
          qty_delta: delta,
          unit_cost: unitCost,
          unit_price: it.unitPrice,
          source: 'abc_pos',
          ref_id: String(t.transactionId),
          occurred_at: t.transactionTimestamp,
        })
        qtyDeltas.set(match.id, (qtyDeltas.get(match.id) || 0) + delta)
      }
    })

    if (lineRows.length) {
      const { error: liErr } = await supabaseAdmin.from('inventory_transaction_items').insert(lineRows)
      if (liErr) throw new Error('line items insert failed: ' + liErr.message)
    }
    if (movementRows.length) {
      const { error: mvErr } = await supabaseAdmin.from('inventory_movements').insert(movementRows)
      if (mvErr) throw new Error('movements insert failed: ' + mvErr.message)
      movementCount += movementRows.length
    }
  }

  // Apply aggregated quantity deltas (read-modify-write; the sync is the
  // single automated writer so contention is negligible).
  for (const [itemId, delta] of qtyDeltas) {
    const { data: cur } = await supabaseAdmin
      .from('inventory_items').select('qty_on_hand, profit_center').eq('id', itemId).maybeSingle()
    if (!cur) continue
    const patch = { qty_on_hand: (num(cur.qty_on_hand) || 0) + delta }
    // Keep the catalog item's profit center in step with its POS lines.
    const pc = pcByItem.get(itemId)
    if (pc && cur.profit_center !== pc) patch.profit_center = pc
    await supabaseAdmin.from('inventory_items').update(patch).eq('id', itemId)
  }

  return { transactions: txns.length, newTransactions: newCount, movements: movementCount }
}

async function runPosSync(slugs = ALL_SLUGS) {
  if (running.pos) return { skipped: true, reason: 'pos sync already running' }
  running.pos = true
  const results = {}
  try {
    for (const slug of slugs) {
      const clubNumber = SLUG_CLUB_MAP[slug]
      if (!clubNumber) continue
      await setSyncState(clubNumber, 'pos', { last_status: 'running', last_error: null })
      try {
        const r = await syncPosForClub(clubNumber)
        results[slug] = { ok: true, ...r }
        await setSyncState(clubNumber, 'pos', { last_status: 'ok', last_synced_at: new Date().toISOString() })
        console.log(`[InventorySync] pos ${slug}: ${r.newTransactions} new / ${r.transactions} fetched`)
      } catch (err) {
        results[slug] = { ok: false, error: err.message }
        await setSyncState(clubNumber, 'pos', { last_status: 'error', last_error: err.message })
        console.error(`[InventorySync] pos ${slug} failed:`, err.message)
      }
    }
  } finally {
    running.pos = false
  }
  return results
}

// --- Scheduler ---------------------------------------------------------------

function start() {
  const posMinutes = parseInt(process.env.INVENTORY_POS_SYNC_MINUTES || '30')
  // Catalog daily at 3:30am PST (11:30 UTC), POS every N minutes.
  cron.schedule('30 11 * * *', () => {
    runCatalogSync().catch(err => console.error('[InventorySync] catalog cron failed:', err.message))
  })
  cron.schedule(`*/${posMinutes} * * * *`, () => {
    runPosSync().catch(err => console.error('[InventorySync] pos cron failed:', err.message))
  })
  console.log(`[InventorySync] scheduled — catalog daily 3:30am PST, POS every ${posMinutes}m`)
}

module.exports = { runCatalogSync, runPosSync, start, running }
