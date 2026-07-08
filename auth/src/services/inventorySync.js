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
const { extractItemPayments } = require('../lib/posPayments')
const { fetchEmployees, CLUBS: EMP_CLUBS } = require('./abcEmployeeRoster')
const { ALL_SLUGS, SLUG_CLUB_MAP } = require('../utils/locationSlug')
const { isSellableProfitCenter } = require('../utils/inventoryProfitCenters')
const { runAbcPushRetry } = require('./abcPushRetry')

// First POS sync looks back this far; later runs resume from the last sync
// minus a 1h overlap (the unique constraint dedupes the overlap).
const FIRST_SYNC_LOOKBACK_DAYS = 30
const OVERLAP_MS = 60 * 60 * 1000

const running = { catalog: false, pos: false, employees: false }

// Fetch every row a query would return, paginating past PostgREST's default
// 1000-row cap. `makeQuery` must return a FRESH builder each call (awaiting a
// builder executes it, so it cannot be reused) and should carry a stable
// .order() so pages don't overlap or skip. Without this, a club with >1000
// catalog items had ~40% of its catalog invisible to the sale-line matcher, so
// those sales read as "(unmatched)" / Uncategorized forever.
const PAGE = 1000
async function fetchAll(makeQuery, label) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) throw new Error(`${label} failed: ` + error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

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
        // Catalog just grew/changed — relink any sale lines that were orphaned
        // because their item didn't exist when the sale was first synced.
        const relinked = await reconcileUnmatchedForClub(clubNumber)
        results[slug] = { ok: true, items: count, relinked }
        await setSyncState(clubNumber, 'catalog', { last_status: 'ok', last_synced_at: new Date().toISOString() })
        console.log(`[InventorySync] catalog ${slug}: ${count} items, ${relinked} sales relinked`)
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

// Re-link sale lines that were ingested before their catalog item existed.
//
// A line's item_id is decided at POS-sync time (by ABC sale-item id, then UPC)
// and stored on the line; POS sync only ever touches *new* transactions, so the
// catalog growing later never back-fills older orphaned lines — they'd read as
// "(unmatched)" on the Sales report forever. After each catalog refresh we sweep
// null-item_id lines for the club and relink any whose UPC now maps to a catalog
// item, stamping the item's current cost so margins compute.
//
// Stock is intentionally NOT moved here: these past sales were never deducted
// from on-hand, and on-hand reflects the latest physical count — retro-posting
// movements now would wrongly drop it. This only fixes reporting linkage.
async function reconcileUnmatchedForClub(clubNumber) {
  const catalog = await fetchAll(() => supabaseAdmin
    .from('inventory_items')
    .select('id, upc, avg_unit_cost, last_unit_cost')
    .eq('club_number', clubNumber)
    .order('id'), 'reconcile catalog read')
  const byUpc = new Map()
  for (const it of catalog || []) if (it.upc) byUpc.set(it.upc, it)
  if (byUpc.size === 0) return 0

  const orphans = await fetchAll(() => supabaseAdmin
    .from('inventory_transaction_items')
    .select('id, upc, unit_cost_at_sale')
    .eq('club_number', clubNumber)
    .is('item_id', null)
    .not('upc', 'is', null)
    .order('id'), 'reconcile orphan read')

  let relinked = 0
  for (const line of orphans || []) {
    const match = byUpc.get(line.upc)
    if (!match) continue
    const patch = { item_id: match.id }
    if (line.unit_cost_at_sale == null) patch.unit_cost_at_sale = costOf(match)
    const { error } = await supabaseAdmin
      .from('inventory_transaction_items').update(patch).eq('id', line.id)
    if (!error) relinked++
  }
  return relinked
}

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

  // Catalog lookup maps for line-item matching. Paginated: a club with >1000
  // catalog items would otherwise match only the first 1000 and orphan the rest.
  const catalog = await fetchAll(() => supabaseAdmin
    .from('inventory_items')
    .select('id, sale_item_id, upc, avg_unit_cost, last_unit_cost')
    .eq('club_number', clubNumber)
    .order('id'), 'POS catalog lookup')
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
    const paymentRows = []
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
      extractItemPayments(it).forEach((pay, pIdx) => {
        paymentRows.push({
          transaction_pk: txnPk,
          club_number: clubNumber,
          line_no: idx,
          pay_no: pIdx,
          payment_type: pay.payment_type,
          payment_amount: pay.payment_amount,
          payment_tax: pay.payment_tax,
          tender_category: pay.tender_category,
        })
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
          abc_push_status: 'na',
        })
        qtyDeltas.set(match.id, (qtyDeltas.get(match.id) || 0) + delta)
      }
    })

    if (lineRows.length) {
      const { error: liErr } = await supabaseAdmin.from('inventory_transaction_items').insert(lineRows)
      if (liErr) throw new Error('line items insert failed: ' + liErr.message)
    }
    if (paymentRows.length) {
      const { error: payErr } = await supabaseAdmin
        .from('inventory_transaction_payments').insert(paymentRows)
      if (payErr) throw new Error('payments insert failed: ' + payErr.message)
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

// --- Employees ---------------------------------------------------------------

// Mirror ABC's employee directory (/{club}/employees) into abc_employees so POS
// sales — which only carry an employeeId GUID — can be attributed to a name.
async function runEmployeeSync(clubs = EMP_CLUBS) {
  if (running.employees) return { skipped: true, reason: 'employee sync already running' }
  running.employees = true
  let upserted = 0
  try {
    for (const club of clubs) {
      let emps
      try {
        emps = await fetchEmployees(club.clubNumber)
      } catch (err) {
        console.error(`[InventorySync] employees ${club.slug} failed:`, err.message)
        continue
      }
      const rows = []
      for (const e of emps || []) {
        const id = e.employeeId || e.id
        if (!id) continue
        const first = (e.personal?.firstName || '').trim()
        const last = (e.personal?.lastName || '').trim()
        rows.push({
          employee_id: id,
          first_name: first || null,
          last_name: last || null,
          full_name: `${first} ${last}`.trim() || null,
          position: e.employment?.position || e.employment?.jobTitle || null,
          department: e.employment?.department || null,
          status: e.employment?.employeeStatus || null,
          club_number: club.clubNumber,
          updated_at: new Date().toISOString(),
        })
      }
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500)
        const { error } = await supabaseAdmin.from('abc_employees').upsert(chunk, { onConflict: 'employee_id' })
        if (error) throw error
        upserted += chunk.length
      }
      console.log(`[InventorySync] employees ${club.slug}: ${rows.length}`)
    }
  } finally {
    running.employees = false
  }
  return { upserted }
}

// --- Scheduler ---------------------------------------------------------------

function start() {
  const posMinutes = parseInt(process.env.INVENTORY_POS_SYNC_MINUTES || '30')
  // Employees daily 3:15am PST (11:15 UTC), catalog 3:30am, POS every N minutes.
  cron.schedule('15 11 * * *', () => {
    runEmployeeSync().catch(err => console.error('[InventorySync] employee cron failed:', err.message))
  })
  cron.schedule('30 11 * * *', () => {
    runCatalogSync().catch(err => console.error('[InventorySync] catalog cron failed:', err.message))
  })
  cron.schedule(`*/${posMinutes} * * * *`, () => {
    runPosSync().catch(err => console.error('[InventorySync] pos cron failed:', err.message))
  })
  // Retry failed/stuck ABC stock pushes every 15 minutes.
  cron.schedule('*/15 * * * *', () => {
    runAbcPushRetry().then(
      (r) => { if (r.attempted) console.log('[Inventory] ABC push retry:', JSON.stringify(r)) },
      (e) => console.error('[Inventory] ABC push retry failed:', e.message),
    )
  })
  console.log(`[InventorySync] scheduled — employees + catalog daily ~3:15-3:30am PST, POS every ${posMinutes}m`)
}

module.exports = { runCatalogSync, runPosSync, runEmployeeSync, runAbcPushRetry, start, running }
