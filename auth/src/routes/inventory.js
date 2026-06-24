// Experimental Inventory tool API.
//
// Catalog + sale prices mirror ABC (synced by services/inventorySync); stock
// levels, costs (from uploaded vendor invoices), and profit margins are
// portal-owned. Whole router is manager+ — costs and margins are sensitive.

const { Router } = require('express')
const multer = require('multer')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, resolveRole } = require('../middleware/role')
const { getAccessToken } = require('./googleBusiness')
const { parseLocationSlugParam, SLUG_CLUB_MAP } = require('../utils/locationSlug')
const { SELLABLE_PROFIT_CENTERS, SELLABLE_CATEGORIES, isSellableItem } = require('../utils/inventoryProfitCenters')
const inventorySync = require('../services/inventorySync')
const { normalizeOrderNumber } = require('../utils/inventoryInvoiceKey')
const invoiceParse = require('../services/inventoryInvoiceParse')
const { matchLine, normalizeText, normalizeSku, upcVariants } = require('../utils/inventoryMatch')
const { parsePriceListCsv } = require('../services/vendorPriceList')
const { packUnitize } = require('../utils/inventoryPack')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLUB_TO_SLUG = Object.fromEntries(Object.entries(SLUG_CLUB_MAP).map(([s, c]) => [c, s]))

const router = Router()
router.use(authenticate)
// Leads can use inventory (restock, adjust, invoices) but NOT the financial
// views — the Sales (/summary) and POS-transactions endpoints stay manager+,
// and the Sales tab / margin column are hidden for them in the UI.
router.use(requireRole('lead'))

// Resolve ?location_slug= into a club_number list. Returns null (= no filter)
// for 'all', or { error } for unknown slugs.
function clubFilter(req) {
  const parsed = parseLocationSlugParam(req.query.location_slug)
  if (parsed.invalid) return { error: `Unknown location: ${parsed.invalid}` }
  if (parsed.all) return { clubs: null }
  return { clubs: parsed.slugs.map(s => SLUG_CLUB_MAP[s]) }
}

const num = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// Attach slug + margin fields the UI renders everywhere.
function decorateItem(it) {
  const cost = num(it.avg_unit_cost) ?? num(it.last_unit_cost)
  const price = num(it.abc_unit_price)
  return {
    ...it,
    location_slug: CLUB_TO_SLUG[it.club_number] || null,
    unit_cost: cost,
    unit_margin: cost != null && price != null ? +(price - cost).toFixed(2) : null,
    margin_pct: cost != null && price != null && price > 0 ? +(((price - cost) / price) * 100).toFixed(1) : null,
  }
}

function shapeInvoice(inv) {
  if (!inv) return inv
  return {
    ...inv,
    location_slug: inv.club_number ? CLUB_TO_SLUG[inv.club_number] || null : null,
    // Surface the matched catalog item's name + UPC on each line (when the line
    // is linked) so the UI can show WHAT a line matched to, not just a score.
    items: (inv.inventory_invoice_items || []).map(it => {
      const matched = it.inventory_items || null
      return {
        ...it,
        matched_item_name: matched?.item_name || null,
        matched_item_upc: matched?.upc || null,
        inventory_items: undefined,
      }
    }),
    files: (inv.inventory_invoice_files || []).sort((a, b) => (a.page_no || 0) - (b.page_no || 0)),
    inventory_invoice_items: undefined,
    inventory_invoice_files: undefined,
  }
}

// Supabase/PostgREST caps a single response (~1000 rows) regardless of .limit(),
// which was truncating the catalog (the item list cut off mid-alphabet). Fetch
// in pages. `makeQuery` must return a FRESH ordered query on every call.
async function fetchAllRows(makeQuery, pageSize = 1000) {
  const all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw error
    const batch = data || []
    all.push(...batch)
    if (batch.length < pageSize) break
  }
  return all
}

// Returns a Set of all UPC variants across all non-archived catalog items.
async function catalogUpcVariantSet() {
  const items = await fetchAllRows(() => supabaseAdmin.from('inventory_items').select('upc').eq('archived', false))
  const set = new Set()
  for (const it of items) for (const v of upcVariants(it.upc)) set.add(v)
  return set
}

// --- Items -------------------------------------------------------------------

// GET / items list. Filters: location_slug, q (name/upc search), category,
// include_archived=1. When from/to (YYYY-MM-DD) are given, each item also
// gets sold_in_range — net units sold over that window (returns subtract).
router.get('/items', async (req, res) => {
  try {
    const { clubs, error: cErr } = clubFilter(req)
    if (cErr) return res.status(400).json({ error: cErr })

    const makeItemsQuery = () => {
      let q = supabaseAdmin.from('inventory_items').select('*').order('item_name')
      if (clubs) q = q.in('club_number', clubs)
      if (req.query.include_archived !== '1') q = q.eq('archived', false)
      if (req.query.category) q = q.eq('category', String(req.query.category))
      if (req.query.q) {
        const term = String(req.query.q).replace(/[%_,()]/g, ' ').trim()
        if (term) q = q.or(`item_name.ilike.%${term}%,upc.ilike.%${term}%`)
      }
      return q
    }
    // Sellable retail goods only — by catalog category, with a barcode catch for
    // uncategorized real products (profit center isn't on the catalog API).
    const data = (await fetchAllRows(makeItemsQuery)).filter(isSellableItem)

    // Units sold per item over the requested window.
    const soldByItem = new Map()
    if (req.query.from || req.query.to) {
      const makeSalesQuery = () => {
        let sq = supabaseAdmin
          .from('inventory_transaction_items')
          .select('item_id, quantity, inventory_transactions!inner(transaction_at, is_return)')
          .not('item_id', 'is', null)
          .order('id')
        if (clubs) sq = sq.in('club_number', clubs)
        if (req.query.from) sq = sq.gte('inventory_transactions.transaction_at', `${req.query.from}T00:00:00Z`)
        if (req.query.to) sq = sq.lte('inventory_transactions.transaction_at', `${req.query.to}T23:59:59Z`)
        return sq
      }
      const sales = await fetchAllRows(makeSalesQuery)
      for (const row of sales || []) {
        const sign = row.inventory_transactions?.is_return ? -1 : 1
        soldByItem.set(row.item_id, (soldByItem.get(row.item_id) || 0) + (num(row.quantity) || 0) * sign)
      }
    }

    res.json({
      items: (data || []).map(it => ({
        ...decorateItem(it),
        sold_in_range: soldByItem.has(it.id) ? +soldByItem.get(it.id).toFixed(2) : 0,
      })),
    })
  } catch (err) {
    console.error('[Inventory] items list error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /items/categories — distinct categories for the filter dropdown.
router.get('/items/categories', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('inventory_items').select('category').eq('archived', false)
      .in('category', SELLABLE_CATEGORIES)
    if (error) throw error
    res.json({ categories: [...new Set((data || []).map(r => r.category))].sort() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /upc/:code?location_slug=salem — barcode lookup for the mobile scanner.
// Tries the raw code plus leading-zero variants (UPC-A scanned as EAN-13).
router.get('/upc/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').replace(/\D/g, '')
    if (!code) return res.status(400).json({ error: 'Invalid UPC' })
    const { clubs, error: cErr } = clubFilter(req)
    if (cErr) return res.status(400).json({ error: cErr })

    const candidates = [...new Set([code, code.replace(/^0+/, ''), '0' + code, '00' + code])]
    let q = supabaseAdmin.from('inventory_items').select('*')
      .in('upc', candidates).eq('archived', false).limit(10)
    if (clubs) q = q.in('club_number', clubs)
    const { data, error } = await q
    if (error) throw error
    res.json({ items: (data || []).map(decorateItem) })
  } catch (err) {
    console.error('[Inventory] upc lookup error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /items/:id/movements — ledger history for one item.
router.get('/items/:id/movements', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid item id' })
    const { data, error } = await supabaseAdmin
      .from('inventory_movements').select('*')
      .eq('item_id', req.params.id)
      .order('occurred_at', { ascending: false })
      .limit(200)
    if (error) throw error

    // For POS movements (ref_id = ABC transaction id) resolve the employee who
    // rang the sale: transaction.employee_id (a GUID) -> name. The ABC employee
    // directory (abc_employees, synced from /{club}/employees) is authoritative
    // and resolves ~94% of POS sales; abc_calendar_events is a fallback for the
    // few not in the directory.
    const movements = data || []
    const posRefs = [...new Set(movements.filter(m => m.source === 'abc_pos' && m.ref_id).map(m => m.ref_id))]
    if (posRefs.length) {
      const { data: txns } = await supabaseAdmin
        .from('inventory_transactions').select('transaction_id, employee_id').in('transaction_id', posRefs)
      const empByTxn = new Map((txns || []).map(t => [t.transaction_id, t.employee_id]))
      const empIds = [...new Set((txns || []).map(t => t.employee_id).filter(Boolean))]
      const nameByEmp = new Map()
      if (empIds.length) {
        // Primary: ABC employee directory.
        const { data: dir } = await supabaseAdmin
          .from('abc_employees').select('employee_id, full_name').in('employee_id', empIds)
        for (const e of dir || []) if (e.full_name) nameByEmp.set(e.employee_id, e.full_name)
        // Fallback: calendar events for anyone not in the directory.
        const missing = empIds.filter(id => !nameByEmp.has(id))
        if (missing.length) {
          const { data: emps } = await supabaseAdmin
            .from('abc_calendar_events')
            .select('employee_id, employee_first_name, employee_last_name')
            .in('employee_id', missing).limit(5000)
          for (const e of emps || []) {
            if (!nameByEmp.has(e.employee_id)) {
              const nm = `${e.employee_first_name || ''} ${e.employee_last_name || ''}`.trim()
              if (nm) nameByEmp.set(e.employee_id, nm)
            }
          }
        }
      }
      for (const m of movements) {
        if (!m.created_by_name && m.source === 'abc_pos' && m.ref_id) {
          m.employee_name = nameByEmp.get(empByTxn.get(m.ref_id)) || null
        }
      }
    }
    // Stamp each movement's club so the history can show where it happened.
    for (const m of movements) m.location_slug = m.club_number ? CLUB_TO_SLUG[m.club_number] || null : null
    res.json({ movements })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /items/:id — toggle tracking (manager+). Admins can also set the
// item's unit cost directly (ABC has the price but not the cost — invoices
// or this field are where cost comes from) and fix a missing/wrong UPC.
//
// apply_all_clubs=true (with a cost/UPC change) propagates that change to every
// club's copy of the same product — matched by UPC — so a product that's the
// same price everywhere only needs its cost set once from the All-clubs view.
router.patch('/items/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid item id' })
    const isAdmin = resolveRole(req.staff.role) === 'admin'
    const patch = {}

    if (typeof req.body.is_tracked === 'boolean') patch.is_tracked = req.body.is_tracked

    const editsCostOrUpc = 'unit_cost' in req.body || 'upc' in req.body
    if (editsCostOrUpc) {
      if (!isAdmin) return res.status(403).json({ error: 'Only admins can edit item cost or UPC' })
      if ('unit_cost' in req.body) {
        if (req.body.unit_cost === null || req.body.unit_cost === '') {
          patch.last_unit_cost = null
          patch.avg_unit_cost = null
        } else {
          const cost = num(req.body.unit_cost)
          if (cost == null || cost < 0) return res.status(400).json({ error: 'Unit cost must be a non-negative number' })
          // Manual cost overrides both bases so margins use it immediately.
          patch.last_unit_cost = cost
          patch.avg_unit_cost = cost
        }
      }
      if ('upc' in req.body) {
        const upc = String(req.body.upc || '').replace(/\D/g, '')
        patch.upc = upc || null
      }
    }

    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' })

    // Resolve which rows the cost/UPC change touches. apply_all_clubs fans the
    // change out to every club's copy of this product (same UPC); is_tracked is
    // never fanned out (it's per-club). Falls back to just this row if the item
    // has no UPC to match siblings on.
    let targetIds = [req.params.id]
    if (req.body.apply_all_clubs === true && editsCostOrUpc) {
      const { data: self } = await supabaseAdmin
        .from('inventory_items').select('upc').eq('id', req.params.id).maybeSingle()
      if (self?.upc) {
        const { data: sibs } = await supabaseAdmin
          .from('inventory_items').select('id').eq('upc', self.upc)
        targetIds = [...new Set((sibs || []).map(s => s.id).concat(req.params.id))]
      }
    }

    const { data, error } = await supabaseAdmin
      .from('inventory_items').update(patch).in('id', targetIds).select()
    if (error) throw error
    if (!data || data.length === 0) return res.status(404).json({ error: 'Item not found' })
    const self = data.find(r => r.id === req.params.id) || data[0]
    res.json({ item: decorateItem(self), updated_count: data.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /items/:id/adjust — manual stock change.
// Body: { set_qty } for a physical count, or { qty_delta } to ADD stock;
// optional note + source ('manual' | 'mobile'). Manual removals are not
// allowed — sales/removals must flow through ABC POS so the books reconcile;
// a physical count (set_qty) is the only way to lower stock here.
router.post('/items/:id/adjust', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid item id' })
    const setQty = num(req.body.set_qty)
    const qtyDelta = num(req.body.qty_delta)
    if (setQty == null && (qtyDelta == null || qtyDelta === 0)) {
      return res.status(400).json({ error: 'Provide set_qty or a qty_delta' })
    }
    if (setQty != null && setQty < 0) {
      return res.status(400).json({ error: 'Count cannot be negative' })
    }
    if (setQty == null && qtyDelta < 0) {
      return res.status(400).json({ error: 'Stock can only be added here — removals must go through ABC POS' })
    }

    const { data: item, error: iErr } = await supabaseAdmin
      .from('inventory_items').select('*').eq('id', req.params.id).maybeSingle()
    if (iErr) throw iErr
    if (!item) return res.status(404).json({ error: 'Item not found' })

    const current = num(item.qty_on_hand) || 0
    const kind = setQty != null ? 'count' : 'adjustment'
    const delta = setQty != null ? setQty - current : qtyDelta
    const after = current + delta

    const { error: mErr } = await supabaseAdmin.from('inventory_movements').insert({
      item_id: item.id,
      club_number: item.club_number,
      kind,
      qty_delta: delta,
      qty_after: after,
      source: req.body.source === 'mobile' ? 'mobile' : 'manual',
      note: typeof req.body.note === 'string' ? req.body.note.slice(0, 500) : null,
      created_by: req.staff.id,
      created_by_name: req.staff.display_name || req.staff.email || null,
    })
    if (mErr) throw mErr

    const { data: updated, error: uErr } = await supabaseAdmin
      .from('inventory_items').update({ qty_on_hand: after }).eq('id', item.id).select().single()
    if (uErr) throw uErr
    res.json({ item: decorateItem(updated) })
  } catch (err) {
    console.error('[Inventory] adjust error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// --- Transactions --------------------------------------------------------------

// GET /transactions?location_slug=&from=&to=&limit= — synced POS sales with
// line items (newest first). from/to are YYYY-MM-DD. Financial data → manager+.
router.get('/transactions', requireRole('manager'), async (req, res) => {
  try {
    const { clubs, error: cErr } = clubFilter(req)
    if (cErr) return res.status(400).json({ error: cErr })
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000)

    let q = supabaseAdmin
      .from('inventory_transactions')
      .select('*, inventory_transaction_items(*)')
      .order('transaction_at', { ascending: false })
      .limit(limit)
    if (clubs) q = q.in('club_number', clubs)
    if (req.query.from) q = q.gte('transaction_at', `${req.query.from}T00:00:00Z`)
    if (req.query.to) q = q.lte('transaction_at', `${req.query.to}T23:59:59Z`)

    const { data, error } = await q
    if (error) throw error
    const transactions = (data || []).map(t => ({
      ...t,
      location_slug: CLUB_TO_SLUG[t.club_number] || null,
      raw: undefined,
      items: (t.inventory_transaction_items || []).sort((a, b) => a.line_no - b.line_no),
      inventory_transaction_items: undefined,
    }))
    res.json({ transactions })
  } catch (err) {
    console.error('[Inventory] transactions error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /summary?location_slug=&from=&to= — per-item revenue, COGS, profit.
// Financial data (the Sales tab) → manager+ only.
router.get('/summary', requireRole('manager'), async (req, res) => {
  try {
    const { clubs, error: cErr } = clubFilter(req)
    if (cErr) return res.status(400).json({ error: cErr })

    const makeSummaryQuery = () => {
      let q = supabaseAdmin
        .from('inventory_transaction_items')
        .select('item_id, name, upc, quantity, unit_price, subtotal, unit_cost_at_sale, club_number, inventory_transactions!inner(transaction_at, is_return)')
        .in('profit_center', SELLABLE_PROFIT_CENTERS) // sellable retail lines only
        .order('id')
      if (clubs) q = q.in('club_number', clubs)
      if (req.query.from) q = q.gte('inventory_transactions.transaction_at', `${req.query.from}T00:00:00Z`)
      if (req.query.to) q = q.lte('inventory_transactions.transaction_at', `${req.query.to}T23:59:59Z`)
      return q
    }
    const data = await fetchAllRows(makeSummaryQuery)

    // Current cost per item, used as a FALLBACK when a sale line has no frozen
    // cost-at-sale (e.g. it sold before the item had any cost). The stamped
    // cost-at-sale always wins so historical COGS stays frozen; this only fills
    // blanks so the Sales tab can still show COGS once a cost exists.
    // Query in chunks: a single .in('id', [...]) with hundreds of UUIDs makes the
    // PostgREST request URL exceed the length limit and returns 400 Bad Request.
    const itemIds = [...new Set((data || []).map(r => r.item_id).filter(Boolean))]
    const costByItem = new Map()
    const catByItem = new Map()
    const COST_CHUNK = 100
    for (let i = 0; i < itemIds.length; i += COST_CHUNK) {
      const chunk = itemIds.slice(i, i + COST_CHUNK)
      const { data: costRows, error: cErr2 } = await supabaseAdmin
        .from('inventory_items').select('id, avg_unit_cost, last_unit_cost, category').in('id', chunk)
      if (cErr2) throw cErr2
      for (const it of costRows || []) {
        const c = num(it.avg_unit_cost) ?? num(it.last_unit_cost)
        if (c != null) costByItem.set(it.id, c)
        if (it.category) catByItem.set(it.id, it.category)
      }
    }

    const byItem = new Map()
    for (const row of data || []) {
      const isReturn = row.inventory_transactions?.is_return
      const sign = isReturn ? -1 : 1
      const key = row.item_id || `unmatched:${row.name}`
      const entry = byItem.get(key) || {
        item_id: row.item_id, name: row.name, upc: row.upc,
        category: row.item_id ? catByItem.get(row.item_id) || null : null,
        location_slug: CLUB_TO_SLUG[row.club_number] || null,
        units: 0, revenue: 0, cogs: 0, cogs_known: true,
      }
      const qty = (num(row.quantity) || 0) * sign
      const rev = (num(row.subtotal) ?? (num(row.unit_price) || 0) * (num(row.quantity) || 0)) * sign
      entry.units += qty
      entry.revenue += rev
      const cost = num(row.unit_cost_at_sale) ?? (row.item_id ? costByItem.get(row.item_id) : null)
      if (cost != null) entry.cogs += cost * qty
      else if (qty !== 0) entry.cogs_known = false
      byItem.set(key, entry)
    }

    const rows = [...byItem.values()].map(e => ({
      ...e,
      units: +e.units.toFixed(2),
      revenue: +e.revenue.toFixed(2),
      cogs: e.cogs_known ? +e.cogs.toFixed(2) : null,
      profit: e.cogs_known ? +(e.revenue - e.cogs).toFixed(2) : null,
      margin_pct: e.cogs_known && e.revenue > 0 ? +(((e.revenue - e.cogs) / e.revenue) * 100).toFixed(1) : null,
    })).sort((a, b) => b.revenue - a.revenue)

    res.json({ summary: rows })
  } catch (err) {
    console.error('[Inventory] summary error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /shrinkage?location_slug=&from=&to= — physical-count variances. Every time
// staff "set exact count" on an item we log a kind='count' movement whose
// qty_delta is the net difference vs. what was on hand (negative = missing /
// shrink, positive = found extra). This rolls those up by employee / item /
// location and values each at the item's cost so misplacement and theft can be
// measured. Financial data → manager+.
router.get('/shrinkage', requireRole('manager'), async (req, res) => {
  try {
    const { clubs, error: cErr } = clubFilter(req)
    if (cErr) return res.status(400).json({ error: cErr })

    const makeQuery = () => {
      let q = supabaseAdmin
        .from('inventory_movements')
        .select('id, item_id, club_number, qty_delta, qty_after, note, created_by_name, occurred_at, inventory_items(item_name, upc, category, avg_unit_cost, last_unit_cost)')
        .eq('kind', 'count')
        .order('occurred_at', { ascending: false })
      if (clubs) q = q.in('club_number', clubs)
      if (req.query.from) q = q.gte('occurred_at', `${req.query.from}T00:00:00Z`)
      if (req.query.to) q = q.lte('occurred_at', `${req.query.to}T23:59:59Z`)
      return q
    }
    const rows = await fetchAllRows(makeQuery)

    const events = (rows || []).map(m => {
      const item = m.inventory_items || null
      const delta = num(m.qty_delta) || 0
      const counted = num(m.qty_after)
      const unitCost = item ? (num(item.avg_unit_cost) ?? num(item.last_unit_cost)) : null
      const impact = unitCost != null ? +(delta * unitCost).toFixed(2) : null
      return {
        id: m.id,
        item_id: m.item_id,
        item_name: item?.item_name || null,
        item_upc: item?.upc || null,
        category: item?.category || null,
        location_slug: m.club_number ? CLUB_TO_SLUG[m.club_number] || null : null,
        created_by_name: m.created_by_name || null,
        occurred_at: m.occurred_at,
        expected: counted != null ? +(counted - delta).toFixed(2) : null,
        counted,
        delta: +delta.toFixed(2),
        unit_cost: unitCost,
        impact,
        note: m.note || null,
      }
    })

    // Roll up. shrink_value sums negative impact (a negative number), found_value
    // sums positive impact, net_value sums all impact.
    const empMap = new Map()
    const itemMap = new Map()
    const locMap = new Map()
    let shrinkValue = 0, foundValue = 0, noCostEvents = 0
    for (const e of events) {
      if (e.impact == null) noCostEvents++
      else if (e.impact < 0) shrinkValue += e.impact
      else foundValue += e.impact

      const empKey = e.created_by_name || 'Unknown'
      const emp = empMap.get(empKey) || { name: empKey, events: 0, net_units: 0, shrink_value: 0, found_value: 0, net_value: 0 }
      emp.events++; emp.net_units += e.delta
      if (e.impact != null) { emp.net_value += e.impact; if (e.impact < 0) emp.shrink_value += e.impact; else emp.found_value += e.impact }
      empMap.set(empKey, emp)

      if (e.item_id) {
        const it = itemMap.get(e.item_id) || { item_id: e.item_id, item_name: e.item_name, location_slug: e.location_slug, events: 0, net_units: 0, net_value: 0 }
        it.events++; it.net_units += e.delta; if (e.impact != null) it.net_value += e.impact
        itemMap.set(e.item_id, it)
      }

      const locKey = e.location_slug || '—'
      const loc = locMap.get(locKey) || { location_slug: locKey, events: 0, net_units: 0, net_value: 0 }
      loc.events++; loc.net_units += e.delta; if (e.impact != null) loc.net_value += e.impact
      locMap.set(locKey, loc)
    }

    const round = (v) => +Number(v).toFixed(2)
    const byEmployee = [...empMap.values()].map(e => ({
      ...e, net_units: round(e.net_units), shrink_value: round(e.shrink_value), found_value: round(e.found_value), net_value: round(e.net_value),
    })).sort((a, b) => a.shrink_value - b.shrink_value) // biggest loss first
    const byItem = [...itemMap.values()].map(i => ({
      ...i, net_units: round(i.net_units), net_value: round(i.net_value),
    })).sort((a, b) => a.net_value - b.net_value)
    const byLocation = [...locMap.values()].map(l => ({
      ...l, net_units: round(l.net_units), net_value: round(l.net_value),
    })).sort((a, b) => a.net_value - b.net_value)

    res.json({
      events,
      by_employee: byEmployee,
      by_item: byItem,
      by_location: byLocation,
      totals: {
        events: events.length,
        shrink_value: round(shrinkValue),
        found_value: round(foundValue),
        net_value: round(shrinkValue + foundValue),
        no_cost_events: noCostEvents,
      },
    })
  } catch (err) {
    console.error('[Inventory] shrinkage error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /movements — recent manual/mobile stock adjustments (for the Restock audit
// feed). POS sales and invoice receipts are excluded; invoices show on their own.
router.get('/movements', async (req, res) => {
  try {
    const { clubs, error: cErr } = clubFilter(req)
    if (cErr) return res.status(400).json({ error: cErr })
    let q = supabaseAdmin
      .from('inventory_movements')
      .select('id, item_id, club_number, kind, qty_delta, qty_after, source, note, created_by_name, occurred_at, inventory_items(item_name, upc)')
      .in('source', ['manual', 'mobile'])
      .order('occurred_at', { ascending: false })
      .limit(300)
    if (clubs) q = q.in('club_number', clubs)
    const { data, error } = await q
    if (error) throw error
    res.json({
      movements: (data || []).map(m => ({
        id: m.id, item_id: m.item_id, kind: m.kind, qty_delta: m.qty_delta, qty_after: m.qty_after,
        source: m.source, note: m.note, created_by_name: m.created_by_name, occurred_at: m.occurred_at,
        location_slug: m.club_number ? CLUB_TO_SLUG[m.club_number] || null : null,
        item_name: m.inventory_items?.item_name || null,
        item_upc: m.inventory_items?.upc || null,
      })),
    })
  } catch (err) {
    console.error('[Inventory] movements error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// --- Audit (admin only) -----------------------------------------------------------

// GET /audit?location_slug=&days=30&min_margin=15 — items that are priced
// poorly or have data problems. Issue flags per item:
//   negative_margin     price < cost (losing money on every sale)
//   low_margin          margin below min_margin % (default 15)
//   selling_below_price actual avg sold price in window < 90% of catalog price
//   no_cost             sells (or holds stock) but no invoice cost on file
//   no_price            no/zero catalog price from ABC
//   negative_stock      qty_on_hand < 0 (oversold — counts have drifted)
//   missing_upc         no UPC, so it can't be scanned
//   no_category         no ABC category — add one in ABC so the 3am sync fixes it
router.get('/audit', requireRole('admin'), async (req, res) => {
  try {
    const { clubs, error: cErr } = clubFilter(req)
    if (cErr) return res.status(400).json({ error: cErr })
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365)
    const minMargin = Number.isFinite(parseFloat(req.query.min_margin)) ? parseFloat(req.query.min_margin) : 15
    // include_clean=1 returns every sellable item (issue or not) so costs can be
    // edited/exported for the whole catalog, not just flagged items.
    const includeClean = req.query.include_clean === '1' || req.query.include_clean === 'true'

    const makeAuditItemsQuery = () => {
      let iq = supabaseAdmin.from('inventory_items').select('*').eq('archived', false).order('item_name')
      if (clubs) iq = iq.in('club_number', clubs)
      return iq
    }
    const items = (await fetchAllRows(makeAuditItemsQuery)).filter(isSellableItem) // sellable retail goods only

    const fromIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const makeAuditSalesQuery = () => {
      let sq = supabaseAdmin
        .from('inventory_transaction_items')
        .select('item_id, quantity, unit_price, subtotal, inventory_transactions!inner(transaction_at, is_return)')
        .not('item_id', 'is', null)
        .gte('inventory_transactions.transaction_at', fromIso)
        .order('id')
      if (clubs) sq = sq.in('club_number', clubs)
      return sq
    }
    const sales = await fetchAllRows(makeAuditSalesQuery)

    // Per-item sold units + quantity-weighted average actual sold price.
    const salesByItem = new Map()
    for (const row of sales || []) {
      if (row.inventory_transactions?.is_return) continue
      const qty = num(row.quantity) || 0
      const price = num(row.unit_price)
      const e = salesByItem.get(row.item_id) || { units: 0, priceQty: 0, priceWeight: 0 }
      e.units += qty
      if (price != null && qty > 0) { e.priceQty += price * qty; e.priceWeight += qty }
      salesByItem.set(row.item_id, e)
    }

    const result = []
    for (const raw of items || []) {
      const it = decorateItem(raw)
      const s = salesByItem.get(it.id)
      const soldUnits = s ? +s.units.toFixed(2) : 0
      const avgSoldPrice = s && s.priceWeight > 0 ? +(s.priceQty / s.priceWeight).toFixed(2) : null
      const price = num(it.abc_unit_price)
      const cost = it.unit_cost
      const onHand = num(it.qty_on_hand) || 0

      const issues = []
      if (price == null || price <= 0) issues.push('no_price')
      if (cost != null && price != null && price > 0) {
        if (cost >= price) issues.push('negative_margin')
        else if (it.margin_pct != null && it.margin_pct < minMargin) issues.push('low_margin')
      }
      if (avgSoldPrice != null && price != null && price > 0 && avgSoldPrice < price * 0.9) {
        issues.push('selling_below_price')
      }
      if (cost == null && (soldUnits > 0 || onHand > 0)) issues.push('no_cost')
      if (onHand < 0) issues.push('negative_stock')
      if (!it.upc) issues.push('missing_upc')
      if (!raw.category) issues.push('no_category') // fix in ABC so the 3am sync picks it up

      if (issues.length > 0 || includeClean) {
        result.push({ ...it, sold_units: soldUnits, avg_sold_price: avgSoldPrice, issues })
      }
    }

    // All-items view stays alphabetical (the catalog order) for finding an item to
    // edit; the flagged-only view leads with the worst offenders.
    if (!includeClean) {
      result.sort((a, b) =>
        b.issues.length - a.issues.length || (a.margin_pct ?? 999) - (b.margin_pct ?? 999))
    }

    res.json({ items: result, days, min_margin: minMargin, scanned: (items || []).length, include_clean: includeClean })
  } catch (err) {
    console.error('[Inventory] audit error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// --- Employee Spend (admin only) ---------------------------------------------

// Employee discount % by catalog category (Justin's policy). Anything not listed
// (Tanning, etc.) gets no discount.
const EMP_DISCOUNT = { Drinks: 0.25, Snacks: 0.25, Supplements: 0.37, Merchandise: 0.40 }
const empDiscountFor = (category) => EMP_DISCOUNT[category] || 0

// GET /employee-spend?location_slug=&from=&to= — what staff are buying, and the
// margin after the employee discount is applied to the catalog price. Staff are
// identified by an Employee/STAFF membership type (codes EMPLOY/COMP). The
// discounted price is MODELED (catalog × (1 − discount)), not the till price.
router.get('/employee-spend', requireRole('admin'), async (req, res) => {
  try {
    const { clubs, error: cErr } = clubFilter(req)
    if (cErr) return res.status(400).json({ error: cErr })

    // Staff buyers = members with an Employee/STAFF membership.
    const staffRows = await fetchAllRows(() =>
      supabaseAdmin.from('abc_members').select('member_id')
        .in('membership_type_abc_code', ['EMPLOY', 'COMP']).order('member_id'))
    const staffIds = [...new Set((staffRows || []).map(r => r.member_id).filter(Boolean))]
    if (staffIds.length === 0) return res.json({ rows: [], totals: { spend: 0, profit: 0, units: 0 }, buyers: 0 })

    // Staff sale lines over the window. Chunk the member_id IN list so the
    // PostgREST URL stays under the length limit.
    const CHUNK = 100
    const lines = []
    for (let i = 0; i < staffIds.length; i += CHUNK) {
      const chunk = staffIds.slice(i, i + CHUNK)
      const makeQ = () => {
        let q = supabaseAdmin
          .from('inventory_transaction_items')
          .select('item_id, quantity, club_number, transaction_pk, inventory_transactions!inner(member_id, transaction_at, is_return)')
          .in('profit_center', SELLABLE_PROFIT_CENTERS)
          .not('item_id', 'is', null)
          .in('inventory_transactions.member_id', chunk)
          .order('id')
        if (clubs) q = q.in('club_number', clubs)
        if (req.query.from) q = q.gte('inventory_transactions.transaction_at', `${req.query.from}T00:00:00Z`)
        if (req.query.to) q = q.lte('inventory_transactions.transaction_at', `${req.query.to}T23:59:59Z`)
        return q
      }
      lines.push(...(await fetchAllRows(makeQ)))
    }

    // Aggregate per item, netting returns, counting distinct purchase occasions.
    const byItem = new Map()
    for (const row of lines) {
      const sign = row.inventory_transactions?.is_return ? -1 : 1
      const e = byItem.get(row.item_id) || { units: 0, txns: new Set() }
      e.units += (num(row.quantity) || 0) * sign
      if (row.transaction_pk) e.txns.add(row.transaction_pk)
      byItem.set(row.item_id, e)
    }
    const itemIds = [...byItem.keys()]
    if (itemIds.length === 0) return res.json({ rows: [], totals: { spend: 0, profit: 0, units: 0 }, buyers: staffIds.length })

    // Item details (chunked IN).
    const itemInfo = new Map()
    for (let i = 0; i < itemIds.length; i += CHUNK) {
      const { data: items, error } = await supabaseAdmin
        .from('inventory_items')
        .select('id, item_name, upc, category, club_number, abc_unit_price, avg_unit_cost, last_unit_cost')
        .in('id', itemIds.slice(i, i + CHUNK))
      if (error) throw error
      for (const it of items || []) itemInfo.set(it.id, it)
    }

    const rows = []
    let tSpend = 0, tProfit = 0, tUnits = 0, profitKnown = true
    for (const [itemId, agg] of byItem) {
      const it = itemInfo.get(itemId)
      if (!it) continue
      const units = +agg.units.toFixed(2)
      if (units <= 0) continue
      const disc = empDiscountFor(it.category)
      const price = num(it.abc_unit_price)
      const cost = num(it.avg_unit_cost) ?? num(it.last_unit_cost)
      const empPrice = price != null ? +(price * (1 - disc)).toFixed(2) : null
      const spend = empPrice != null ? +(empPrice * units).toFixed(2) : null
      const cogs = cost != null ? +(cost * units).toFixed(2) : null
      const profit = spend != null && cogs != null ? +(spend - cogs).toFixed(2) : null
      const marginPct = profit != null && spend > 0 ? +((profit / spend) * 100).toFixed(1) : null
      if (spend != null) tSpend += spend
      if (profit != null) tProfit += profit
      else if (cogs == null) profitKnown = false
      tUnits += units
      rows.push({
        item_id: itemId, item_name: it.item_name, upc: it.upc, category: it.category,
        location_slug: CLUB_TO_SLUG[it.club_number] || null,
        units, purchases: agg.txns.size,
        abc_unit_price: price, unit_cost: cost,
        emp_discount_pct: +(disc * 100).toFixed(0),
        emp_price: empPrice, emp_spend: spend, cogs, profit, margin_pct: marginPct,
      })
    }
    rows.sort((a, b) => (b.emp_spend || 0) - (a.emp_spend || 0))

    res.json({
      rows,
      totals: { spend: +tSpend.toFixed(2), profit: profitKnown ? +tProfit.toFixed(2) : null, units: +tUnits.toFixed(2) },
      buyers: staffIds.length,
    })
  } catch (err) {
    console.error('[Inventory] employee-spend error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// --- Vendor price-list (admin only) -------------------------------------------

// POST /price-list/preview — parse a CSV and compute coverage vs the catalog.
// Writes nothing; returns stats + a sample of rows.
router.post('/price-list/preview', requireRole('admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const text = req.file.buffer.toString('utf8')
    let rows, skipped
    try {
      ;({ rows, skipped } = parsePriceListCsv(text))
    } catch (e) {
      return res.status(400).json({ error: e.message })
    }
    const catSet = await catalogUpcVariantSet()
    let matched = 0
    const sample = []
    for (const row of rows) {
      const isMatched =
        upcVariants(row.upc).some(v => catSet.has(v)) ||
        upcVariants(row.unit_upc).some(v => catSet.has(v))
      if (isMatched) matched++
      if (sample.length < 30) {
        sample.push({ sku: row.sku, product_name: row.product_name, pack_size: row.pack_size, case_cost: row.case_cost, unit_cost: row.unit_cost, map_price: row.map_price, matched: isMatched })
      }
    }
    res.json({
      total: rows.length,
      skipped,
      matched,
      unmatched: rows.length - matched,
      with_cost: rows.filter(r => r.unit_cost != null).length,
      sample,
    })
  } catch (err) {
    console.error('[Inventory] price-list preview error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /price-list/apply — upsert rows into vendor_sku_upc; optionally back-fill
// item costs. Body fields: vendor (string), update_costs ('true'/'false').
router.post('/price-list/apply', requireRole('admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const vendor = (req.body.vendor || 'Sportlife Distribution').toLowerCase().trim()
    let rows
    try {
      ;({ rows } = parsePriceListCsv(req.file.buffer.toString('utf8')))
    } catch (e) {
      return res.status(400).json({ error: e.message })
    }

    // Upsert into vendor_sku_upc in chunks of 500.
    const now = new Date().toISOString()
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map(r => ({
        vendor,
        sku: normalizeSku(r.sku) || r.sku,
        product_name: r.product_name,
        upc: r.upc,
        unit_upc: r.unit_upc,
        pack_size: r.pack_size,
        case_cost: r.case_cost,
        unit_cost: r.unit_cost,
        map_price: r.map_price,
        updated_at: now,
      }))
      const { error } = await supabaseAdmin.from('vendor_sku_upc').upsert(chunk, { onConflict: 'vendor,sku' })
      if (error) throw error
    }

    let costUpdated = 0
    if (req.body.update_costs === 'true' || req.body.update_costs === true) {
      // Build variant -> unit_cost map from price-list rows.
      const costByVariant = new Map()
      for (const row of rows) {
        if (row.unit_cost == null) continue
        for (const v of upcVariants(row.upc)) costByVariant.set(v, row.unit_cost)
        for (const v of upcVariants(row.unit_upc)) costByVariant.set(v, row.unit_cost)
      }
      if (costByVariant.size > 0) {
        // Page through all non-archived items, update those whose UPC is in the map.
        const allItems = await fetchAllRows(() =>
          supabaseAdmin.from('inventory_items').select('id, upc').eq('archived', false))
        for (const item of allItems) {
          const cost = upcVariants(item.upc).map(v => costByVariant.get(v)).find(c => c != null)
          if (cost == null) continue
          const { error } = await supabaseAdmin
            .from('inventory_items')
            .update({ last_unit_cost: cost, avg_unit_cost: cost })
            .eq('id', item.id)
          if (error) throw error
          costUpdated++
        }
      }
    }

    res.json({ upserted: rows.length, cost_updated_items: costUpdated })
  } catch (err) {
    console.error('[Inventory] price-list apply error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// --- Invoices -------------------------------------------------------------------

async function getUploadFolderId() {
  if (process.env.INVENTORY_UPLOAD_FOLDER_ID) return process.env.INVENTORY_UPLOAD_FOLDER_ID
  const { data } = await supabaseAdmin
    .from('app_config').select('value').eq('key', 'inventory_upload_folder_id').maybeSingle()
  return data?.value || null
}

async function uploadBufferToDrive(buffer, originalname, mime, token, folderId) {
  const name = (originalname || 'invoice').replace(/[\r\n"]/g, '').slice(0, 200)
  const boundary = '----wcsInventoryUploadBoundary'
  const metadata = JSON.stringify({ name, parents: [folderId] })
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8')
  const post = Buffer.from(`\r\n--${boundary}--`, 'utf8')
  const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([pre, buffer, post]),
  })
  const created = await up.json()
  if (created.error) { const e = new Error(created.error.message || 'Drive upload failed'); e.status = up.status || 500; throw e }
  await fetch(`https://www.googleapis.com/drive/v3/files/${created.id}/permissions?supportsAllDrives=true`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  }).catch(() => {})
  return { fileLink: `https://drive.google.com/file/d/${created.id}/view`, fileName: created.name, mime }
}

const ALLOWED_MIME = /^image\/(?!svg)|^application\/pdf$/
function uploadFiles(req, res, next) {
  upload.array('files', 12)(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE'
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'A file exceeds the 50 MB limit' : 'Upload failed' })
    }
    next()
  })
}

// GET /invoices — list with line items and file pages.
router.get('/invoices', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('inventory_invoices')
      .select('*, inventory_invoice_items(*, inventory_items(item_name,upc)), inventory_invoice_files(*)')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw error
    res.json({ invoices: (data || []).map(shapeInvoice) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /invoices — create or update an invoice. multipart/form-data with
// optional `files` (1..n pdf/images, stored in Drive) or a single back-compat
// `file` field, plus vendor / invoice_number / invoice_date / total / notes /
// location_slug fields. Resolves an existing invoice by normalized order number
// when provided; otherwise creates a new one.
router.post('/invoices', uploadFiles, async (req, res) => {
  try {
    const vendor = typeof req.body.vendor === 'string' ? req.body.vendor.trim() : ''
    if (!vendor) return res.status(400).json({ error: 'Vendor is required' })

    let clubNumber = null
    if (req.body.location_slug && req.body.location_slug !== 'all') {
      clubNumber = SLUG_CLUB_MAP[String(req.body.location_slug).toLowerCase()]
      if (!clubNumber) return res.status(400).json({ error: 'Unknown location' })
    }

    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : [])
    for (const f of files) {
      if (!ALLOWED_MIME.test(f.mimetype || '')) return res.status(400).json({ error: 'Only photo or PDF files are allowed' })
    }

    // Resolve-or-create by (club, vendor, normalized order number). An order
    // number alone is not unique across vendors/clubs in the shared table.
    const orderNorm = normalizeOrderNumber(req.body.invoice_number)
    let invoice = null
    if (orderNorm) {
      let q = supabaseAdmin.from('inventory_invoices').select('*')
        .eq('invoice_number', orderNorm)
        .eq('vendor', vendor)
      q = clubNumber ? q.eq('club_number', clubNumber) : q.is('club_number', null)
      const { data: existing } = await q.limit(1).maybeSingle()
      invoice = existing || null
    }
    if (!invoice) {
      const { data, error } = await supabaseAdmin.from('inventory_invoices').insert({
        club_number: clubNumber,
        vendor,
        invoice_number: orderNorm,
        invoice_date: req.body.invoice_date || null,
        total: num(req.body.total),
        notes: req.body.notes ? String(req.body.notes).slice(0, 2000) : null,
        parse_status: files.length ? 'pending' : null,
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || req.staff.email || null,
      }).select().single()
      if (error) throw error
      invoice = data
    }

    // Upload each page to Drive + record it.
    if (files.length) {
      const folderId = await getUploadFolderId()
      if (!folderId) return res.status(400).json({ error: 'Invoice upload folder is not configured yet (set app_config key inventory_upload_folder_id or INVENTORY_UPLOAD_FOLDER_ID)' })
      const token = await getAccessToken()
      // Page numbers continue from the current count; assumes no concurrent uploads for one invoice.
      const { count: existingPages } = await supabaseAdmin
        .from('inventory_invoice_files').select('id', { count: 'exact', head: true }).eq('invoice_id', invoice.id)
      let pageNo = existingPages || 0
      for (const f of files) {
        try {
          const up = await uploadBufferToDrive(f.buffer, f.originalname, f.mimetype, token, folderId)
          pageNo++
          await supabaseAdmin.from('inventory_invoice_files').insert({
            invoice_id: invoice.id, file_link: up.fileLink, file_name: up.fileName, page_no: pageNo, mime_type: up.mime,
          })
          if (!invoice.file_link) {
            await supabaseAdmin.from('inventory_invoices').update({ file_link: up.fileLink, file_name: up.fileName }).eq('id', invoice.id)
            invoice.file_link = up.fileLink
          }
        } catch (e) {
          console.error('[Inventory] Drive upload page error:', e.message)
          return res.status(e.status || 500).json({ error: e.message })
        }
      }
    }

    const { data: full } = await supabaseAdmin
      .from('inventory_invoices').select('*, inventory_invoice_items(*, inventory_items(item_name,upc)), inventory_invoice_files(*)')
      .eq('id', invoice.id).single()
    res.status(201).json({ invoice: shapeInvoice(full) })
  } catch (err) {
    console.error('[Inventory] invoice create error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /invoices/:id/parse — vision-extract all pages, backfill header, and
// regenerate UNRECEIVED draft lines with catalog matches. Received lines untouched.
router.post('/invoices/:id/parse', async (req, res) => {
  try {
    if (process.env.INVENTORY_OCR_DISABLED === '1') return res.status(503).json({ error: 'Invoice OCR is disabled' })
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice id' })

    const { data: invoice } = await supabaseAdmin
      .from('inventory_invoices').select('*, inventory_invoice_files(*)').eq('id', req.params.id).maybeSingle()
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
    const pages = (invoice.inventory_invoice_files || []).sort((a, b) => (a.page_no || 0) - (b.page_no || 0))
    if (!pages.length) return res.status(400).json({ error: 'No pages to parse — upload a photo or PDF first' })

    let parsed
    try {
      const token = await getAccessToken()
      parsed = await invoiceParse.extractFromPages(pages, { token })
    } catch (e) {
      await supabaseAdmin.from('inventory_invoices').update({ parse_status: 'error', parse_error: e.message }).eq('id', invoice.id)
      return res.status(502).json({ error: 'Could not read the invoice: ' + e.message })
    }

    // Catalog for matching: this club, or every club for corporate invoices.
    const makeCat = () => {
      let q = supabaseAdmin.from('inventory_items').select('id,item_name,upc,club_number,category,profit_center').eq('archived', false)
      if (invoice.club_number) q = q.eq('club_number', invoice.club_number)
      return q.order('item_name')
    }
    const catalog = (await fetchAllRows(makeCat)).filter(isSellableItem)
    let aliasQ = supabaseAdmin
      .from('inventory_vendor_aliases').select('vendor_sku,alias_text,upc,item_id')
      .eq('vendor', String(parsed.vendor || invoice.vendor || '').toLowerCase().trim())
    aliasQ = invoice.club_number ? aliasQ.eq('club_number', invoice.club_number) : aliasQ.is('club_number', null)
    const { data: aliases } = await aliasQ

    // "Fresh parse": drop existing UNRECEIVED lines, keep received ones. Then
    // regenerate draft lines, but SKIP any parsed line whose matched item is
    // ALREADY received on this invoice — otherwise re-parsing (or attaching a
    // page to a partly/fully-received order) would create duplicate draft lines
    // for products already in stock and double-count them on the next Receive.
    const { data: receivedLines } = await supabaseAdmin
      .from('inventory_invoice_items').select('item_id').eq('invoice_id', invoice.id).eq('received', true)
    const receivedItemIds = new Set((receivedLines || []).map(r => r.item_id).filter(Boolean))

    await supabaseAdmin.from('inventory_invoice_items').delete().eq('invoice_id', invoice.id).eq('received', false)

    // Look up the vendor price list once for every SKU on the invoice. It is the
    // authoritative source for both (a) the catalog UPC behind a vendor SKU and
    // (b) the PACK SIZE — so a case-priced line (e.g. a 12pk at $18.52) gets
    // normalized to per-individual-unit cost and count before it reaches stock.
    const allSkus = [...new Set(parsed.lines.map(l => normalizeSku(l.vendor_sku)).filter(Boolean))]
    const skuMap = new Map()
    if (allSkus.length > 0) {
      const invoiceVendorNorm = String(parsed.vendor || invoice.vendor || '').toLowerCase().trim()
      const { data: skuRows } = await supabaseAdmin
        .from('vendor_sku_upc')
        .select('sku, upc, unit_upc, vendor, pack_size, case_cost, unit_cost')
        .in('sku', allSkus)
      // Build a map: sku -> best row (prefer the invoice's vendor, then any).
      for (const row of skuRows || []) {
        const normalized = normalizeSku(row.sku)
        const existing = skuMap.get(normalized)
        const isVendorMatch = row.vendor === invoiceVendorNorm
        if (!existing || (isVendorMatch && existing.vendor !== invoiceVendorNorm)) {
          skuMap.set(normalized, row)
        }
      }
      // SKU -> UPC enrichment: lines with a SKU but no UPC borrow the catalog UPC.
      if (skuMap.size > 0) {
        const catSet = await catalogUpcVariantSet()
        for (const line of parsed.lines) {
          if (!line.vendor_sku || line.upc) continue
          const pRow = skuMap.get(normalizeSku(line.vendor_sku))
          if (!pRow) continue
          // Prefer whichever UPC variant is in the catalog; fall back to case upc.
          if (pRow.upc && upcVariants(pRow.upc).some(v => catSet.has(v))) {
            line.upc = pRow.upc
          } else if (pRow.unit_upc && upcVariants(pRow.unit_upc).some(v => catSet.has(v))) {
            line.upc = pRow.unit_upc
          } else if (pRow.upc) {
            line.upc = pRow.upc
          }
        }
      }
    }

    const rows = parsed.lines
      .filter(l => l.quantity && l.quantity > 0)
      .map(l => {
        // Normalize case-priced packs to per-individual-unit cost + count.
        const pack = packUnitize(l, skuMap.get(normalizeSku(l.vendor_sku)))
        const m = matchLine({ description: l.description, upc: l.upc, vendor_sku: l.vendor_sku }, { items: catalog, aliases: aliases || [] })
        return {
          invoice_id: invoice.id, item_id: m.item_id, description: l.description || null, upc: l.upc,
          vendor_sku: l.vendor_sku || null,
          quantity: pack.quantity, unit_cost: pack.unit_cost != null ? pack.unit_cost : 0,
          match_confidence: m.match_confidence, match_source: m.match_source,
        }
      })
      // Skip products already received on this invoice (avoid double-count).
      .filter(r => !(r.item_id && receivedItemIds.has(r.item_id)))
    if (rows.length) await supabaseAdmin.from('inventory_invoice_items').insert(rows)

    await supabaseAdmin.from('inventory_invoices').update({
      vendor: invoice.vendor || parsed.vendor,
      invoice_number: invoice.invoice_number || normalizeOrderNumber(parsed.order_number),
      invoice_date: invoice.invoice_date || parsed.invoice_date || null,
      total: invoice.total != null ? invoice.total : parsed.total,
      parse_status: 'parsed', parsed_at: new Date().toISOString(), parse_error: null,
    }).eq('id', invoice.id)

    const { data: full } = await supabaseAdmin
      .from('inventory_invoices').select('*, inventory_invoice_items(*, inventory_items(item_name,upc)), inventory_invoice_files(*)').eq('id', invoice.id).single()
    res.json({ invoice: shapeInvoice(full), parsed_lines: rows.length })
  } catch (err) {
    console.error('[Inventory] parse error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /invoices/:id/files — attach more page(s) to an existing invoice.
router.post('/invoices/:id/files', uploadFiles, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice id' })
    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : [])
    if (!files.length) return res.status(400).json({ error: 'No files provided' })
    for (const f of files) if (!ALLOWED_MIME.test(f.mimetype || '')) return res.status(400).json({ error: 'Only photo or PDF files are allowed' })

    const { data: invoice } = await supabaseAdmin.from('inventory_invoices').select('*').eq('id', req.params.id).maybeSingle()
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })

    const folderId = await getUploadFolderId()
    if (!folderId) return res.status(400).json({ error: 'Invoice upload folder is not configured yet' })
    const token = await getAccessToken()
    const { count } = await supabaseAdmin.from('inventory_invoice_files').select('id', { count: 'exact', head: true }).eq('invoice_id', invoice.id)
    let pageNo = count || 0
    for (const f of files) {
      const up = await uploadBufferToDrive(f.buffer, f.originalname, f.mimetype, token, folderId)
      pageNo++
      await supabaseAdmin.from('inventory_invoice_files').insert({
        invoice_id: invoice.id, file_link: up.fileLink, file_name: up.fileName, page_no: pageNo, mime_type: up.mime,
      })
    }
    const { data: full } = await supabaseAdmin
      .from('inventory_invoices').select('*, inventory_invoice_items(*, inventory_items(item_name,upc)), inventory_invoice_files(*)').eq('id', invoice.id).single()
    res.status(201).json({ invoice: shapeInvoice(full) })
  } catch (err) { res.status(err.status || 500).json({ error: err.message }) }
})

// DELETE /invoices/:id/files/:fileId — remove one page.
router.delete('/invoices/:id/files/:fileId', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.fileId)) return res.status(400).json({ error: 'Invalid file id' })
    const { data, error } = await supabaseAdmin
      .from('inventory_invoice_files').delete().eq('id', req.params.fileId).eq('invoice_id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Page not found' })
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /invoices/:id/items — add a line item (qty + unit cost, optionally
// linked to a catalog item).
router.post('/invoices/:id/items', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice id' })
    const quantity = num(req.body.quantity)
    const unitCost = num(req.body.unit_cost)
    if (!quantity || quantity <= 0) return res.status(400).json({ error: 'Quantity must be positive' })
    if (unitCost == null || unitCost < 0) return res.status(400).json({ error: 'Unit cost is required' })
    if (req.body.item_id && !UUID_RE.test(req.body.item_id)) return res.status(400).json({ error: 'Invalid item id' })

    const { data, error } = await supabaseAdmin
      .from('inventory_invoice_items')
      .insert({
        invoice_id: req.params.id,
        item_id: req.body.item_id || null,
        description: req.body.description ? String(req.body.description).slice(0, 300) : null,
        upc: req.body.upc ? String(req.body.upc).slice(0, 50) : null,
        quantity,
        unit_cost: unitCost,
      })
      .select()
      .single()
    if (error) {
      if (error.code === '23503') return res.status(404).json({ error: 'Invoice not found' })
      throw error
    }
    res.status(201).json({ item: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /invoices/:id/items/:lineId — remove an unreceived line.
router.delete('/invoices/:id/items/:lineId', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.lineId)) return res.status(400).json({ error: 'Invalid line id' })
    const { data, error } = await supabaseAdmin
      .from('inventory_invoice_items')
      .delete()
      .eq('id', req.params.lineId)
      .eq('invoice_id', req.params.id)
      .eq('received', false)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Line not found (or already received)' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /invoices/:id/receive — apply all unreceived, item-matched lines to
// stock: 'received' movement per line, qty_on_hand += qty, and cost basis
// update (last cost + moving average).
router.post('/invoices/:id/receive', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice id' })
    const { data: invoice, error: iErr } = await supabaseAdmin
      .from('inventory_invoices').select('*').eq('id', req.params.id).maybeSingle()
    if (iErr) throw iErr
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })

    const { data: lines, error: lErr } = await supabaseAdmin
      .from('inventory_invoice_items').select('*')
      .eq('invoice_id', invoice.id).eq('received', false)
    if (lErr) throw lErr

    const matched = (lines || []).filter(l => l.item_id)
    if (matched.length === 0) {
      return res.status(400).json({ error: 'No unreceived lines are linked to a catalog item' })
    }

    let applied = 0
    for (const line of matched) {
      const { data: item } = await supabaseAdmin
        .from('inventory_items').select('*').eq('id', line.item_id).maybeSingle()
      if (!item) continue

      const qty = num(line.quantity) || 0
      const cost = num(line.unit_cost) || 0
      const onHand = Math.max(num(item.qty_on_hand) || 0, 0)
      const prevAvg = num(item.avg_unit_cost)
      // Moving average over positive stock; first receipt sets the average.
      const newAvg = prevAvg != null && onHand > 0
        ? (onHand * prevAvg + qty * cost) / (onHand + qty)
        : cost

      const { error: mErr } = await supabaseAdmin.from('inventory_movements').insert({
        item_id: item.id,
        club_number: item.club_number,
        kind: 'received',
        qty_delta: qty,
        qty_after: (num(item.qty_on_hand) || 0) + qty,
        unit_cost: cost,
        source: 'invoice',
        ref_id: invoice.id,
        note: invoice.vendor + (invoice.invoice_number ? ` #${invoice.invoice_number}` : ''),
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || req.staff.email || null,
      })
      if (mErr) throw mErr

      const { error: uErr } = await supabaseAdmin.from('inventory_items').update({
        qty_on_hand: (num(item.qty_on_hand) || 0) + qty,
        last_unit_cost: cost,
        avg_unit_cost: +newAvg.toFixed(4),
      }).eq('id', item.id)
      if (uErr) throw uErr

      await supabaseAdmin.from('inventory_invoice_items')
        .update({ received: true }).eq('id', line.id)
      const vendorNorm = String(invoice.vendor || '').toLowerCase().trim()
      const skuNorm = normalizeSku(line.vendor_sku)
      const aliasText = normalizeText(line.description)
      if (skuNorm) {
        await supabaseAdmin.from('inventory_vendor_aliases').upsert({
          club_number: item.club_number, vendor: vendorNorm,
          vendor_sku: skuNorm, alias_text: null, upc: line.upc || null,
          item_id: item.id, created_by: req.staff.id,
        }, { onConflict: 'club_number,vendor,vendor_sku' }).then(() => {}, () => {})
      } else if (aliasText) {
        await supabaseAdmin.from('inventory_vendor_aliases').upsert({
          club_number: item.club_number, vendor: vendorNorm,
          vendor_sku: null, alias_text: aliasText, upc: line.upc || null,
          item_id: item.id, created_by: req.staff.id,
        }, { onConflict: 'club_number,vendor,alias_text' }).then(() => {}, () => {})
      }
      applied++
    }

    await supabaseAdmin.from('inventory_invoices')
      .update({ received_at: new Date().toISOString() }).eq('id', invoice.id)

    res.json({ success: true, applied, skipped: (lines || []).length - applied })
  } catch (err) {
    console.error('[Inventory] receive error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /invoices/:id — only before any line was received.
router.delete('/invoices/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice id' })
    const { count } = await supabaseAdmin
      .from('inventory_invoice_items')
      .select('id', { count: 'exact', head: true })
      .eq('invoice_id', req.params.id).eq('received', true)
    if (count > 0) return res.status(400).json({ error: 'Invoice has received lines — it can no longer be deleted' })

    const { data, error } = await supabaseAdmin
      .from('inventory_invoices').delete().eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Invoice not found' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Sync -----------------------------------------------------------------------

// POST /sync { kind: 'catalog' | 'pos' | 'all', location_slug? } — fire and
// poll /sync-status; a full catalog pull across 7 clubs takes a few minutes.
router.post('/sync', async (req, res) => {
  try {
    const kind = String(req.body.kind || 'all')
    const parsed = parseLocationSlugParam(req.body.location_slug)
    if (parsed.invalid) return res.status(400).json({ error: `Unknown location: ${parsed.invalid}` })

    if (kind !== 'catalog' && kind !== 'pos' && kind !== 'all') {
      return res.status(400).json({ error: 'kind must be catalog, pos, or all' })
    }
    if ((kind === 'catalog' || kind === 'all') && inventorySync.running.catalog) {
      return res.status(409).json({ error: 'A catalog sync is already running' })
    }
    if ((kind === 'pos' || kind === 'all') && inventorySync.running.pos) {
      return res.status(409).json({ error: 'A POS sync is already running' })
    }

    // Run in the background; status lands in inventory_sync_state.
    ;(async () => {
      if (kind === 'catalog' || kind === 'all') await inventorySync.runCatalogSync(parsed.slugs)
      if (kind === 'pos' || kind === 'all') await inventorySync.runPosSync(parsed.slugs)
    })().catch(err => console.error('[Inventory] manual sync failed:', err.message))

    res.status(202).json({ started: true, kind, locations: parsed.slugs })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /sync-status — per club+kind state rows.
router.get('/sync-status', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('inventory_sync_state').select('*')
    if (error) throw error
    res.json({
      status: (data || []).map(r => ({ ...r, location_slug: CLUB_TO_SLUG[r.club_number] || null })),
      running: inventorySync.running,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
