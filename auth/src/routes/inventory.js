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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLUB_TO_SLUG = Object.fromEntries(Object.entries(SLUG_CLUB_MAP).map(([s, c]) => [c, s]))

const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

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
    // rang the sale: transaction.employee_id -> name via abc_calendar_events
    // (the only place ABC employee names live).
    const movements = data || []
    const posRefs = [...new Set(movements.filter(m => m.source === 'abc_pos' && m.ref_id).map(m => m.ref_id))]
    if (posRefs.length) {
      const { data: txns } = await supabaseAdmin
        .from('inventory_transactions').select('transaction_id, employee_id').in('transaction_id', posRefs)
      const empByTxn = new Map((txns || []).map(t => [t.transaction_id, t.employee_id]))
      const empIds = [...new Set((txns || []).map(t => t.employee_id).filter(Boolean))]
      const nameByEmp = new Map()
      if (empIds.length) {
        const { data: emps } = await supabaseAdmin
          .from('abc_calendar_events')
          .select('employee_id, employee_first_name, employee_last_name')
          .in('employee_id', empIds).limit(5000)
        for (const e of emps || []) {
          if (!nameByEmp.has(e.employee_id)) {
            const nm = `${e.employee_first_name || ''} ${e.employee_last_name || ''}`.trim()
            if (nm) nameByEmp.set(e.employee_id, nm)
          }
        }
      }
      for (const m of movements) {
        if (!m.created_by_name && m.source === 'abc_pos' && m.ref_id) {
          m.employee_name = nameByEmp.get(empByTxn.get(m.ref_id)) || null
        }
      }
    }
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
// line items (newest first). from/to are YYYY-MM-DD.
router.get('/transactions', async (req, res) => {
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
router.get('/summary', async (req, res) => {
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

    const byItem = new Map()
    for (const row of data || []) {
      const isReturn = row.inventory_transactions?.is_return
      const sign = isReturn ? -1 : 1
      const key = row.item_id || `unmatched:${row.name}`
      const entry = byItem.get(key) || {
        item_id: row.item_id, name: row.name, upc: row.upc,
        location_slug: CLUB_TO_SLUG[row.club_number] || null,
        units: 0, revenue: 0, cogs: 0, cogs_known: true,
      }
      const qty = (num(row.quantity) || 0) * sign
      const rev = (num(row.subtotal) ?? (num(row.unit_price) || 0) * (num(row.quantity) || 0)) * sign
      entry.units += qty
      entry.revenue += rev
      const cost = num(row.unit_cost_at_sale)
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

    const flagged = []
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

      if (issues.length > 0) {
        flagged.push({ ...it, sold_units: soldUnits, avg_sold_price: avgSoldPrice, issues })
      }
    }

    // Worst offenders first: more issues, then lowest margin.
    flagged.sort((a, b) =>
      b.issues.length - a.issues.length || (a.margin_pct ?? 999) - (b.margin_pct ?? 999))

    res.json({ items: flagged, days, min_margin: minMargin, scanned: (items || []).length })
  } catch (err) {
    console.error('[Inventory] audit error:', err.message)
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

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE'
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'File exceeds the 50 MB limit' : 'Upload failed' })
    }
    next()
  })
}

// GET /invoices — list with line items.
router.get('/invoices', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('inventory_invoices')
      .select('*, inventory_invoice_items(*)')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw error
    res.json({
      invoices: (data || []).map(inv => ({
        ...inv,
        location_slug: inv.club_number ? CLUB_TO_SLUG[inv.club_number] || null : null,
        items: inv.inventory_invoice_items || [],
        inventory_invoice_items: undefined,
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /invoices — create an invoice. multipart/form-data with an optional
// `file` (pdf/image, stored in Drive) plus vendor / invoice_number /
// invoice_date / total / notes / location_slug fields.
router.post('/invoices', uploadSingle, async (req, res) => {
  try {
    const vendor = typeof req.body.vendor === 'string' ? req.body.vendor.trim() : ''
    if (!vendor) return res.status(400).json({ error: 'Vendor is required' })

    let clubNumber = null
    if (req.body.location_slug && req.body.location_slug !== 'all') {
      clubNumber = SLUG_CLUB_MAP[String(req.body.location_slug).toLowerCase()]
      if (!clubNumber) return res.status(400).json({ error: 'Unknown location' })
    }

    let fileLink = null, fileName = null
    if (req.file) {
      const mime = req.file.mimetype || 'application/octet-stream'
      if (!/^image\/(?!svg)|^application\/pdf$/.test(mime)) {
        return res.status(400).json({ error: 'Only photo or PDF files are allowed' })
      }
      const folderId = await getUploadFolderId()
      if (!folderId) {
        return res.status(400).json({ error: 'Invoice upload folder is not configured yet (set app_config key inventory_upload_folder_id or INVENTORY_UPLOAD_FOLDER_ID)' })
      }
      const token = await getAccessToken()
      // ABC drops uploads with disallowed filename chars; Drive is fine, but
      // strip newlines/quotes to keep the metadata JSON safe.
      const name = (req.file.originalname || 'invoice').replace(/[\r\n"]/g, '').slice(0, 200)
      const boundary = '----wcsInventoryUploadBoundary'
      const metadata = JSON.stringify({ name, parents: [folderId] })
      const pre = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8')
      const post = Buffer.from(`\r\n--${boundary}--`, 'utf8')
      const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: Buffer.concat([pre, req.file.buffer, post]),
      })
      const created = await up.json()
      if (created.error) {
        return res.status(up.status || 500).json({ error: created.error.message || 'Drive upload failed' })
      }
      await fetch(`https://www.googleapis.com/drive/v3/files/${created.id}/permissions?supportsAllDrives=true`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }).catch(() => {})
      fileLink = `https://drive.google.com/file/d/${created.id}/view`
      fileName = created.name
    }

    const { data, error } = await supabaseAdmin
      .from('inventory_invoices')
      .insert({
        club_number: clubNumber,
        vendor,
        invoice_number: req.body.invoice_number ? String(req.body.invoice_number).slice(0, 100) : null,
        invoice_date: req.body.invoice_date || null,
        total: num(req.body.total),
        notes: req.body.notes ? String(req.body.notes).slice(0, 2000) : null,
        file_link: fileLink,
        file_name: fileName,
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || req.staff.email || null,
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json({ invoice: { ...data, items: [] } })
  } catch (err) {
    console.error('[Inventory] invoice create error:', err.message)
    res.status(500).json({ error: err.message })
  }
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
