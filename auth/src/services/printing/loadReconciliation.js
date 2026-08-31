// Loads one club/day till reconciliation and maps it into the shape
// buildTillReceiptPayload consumes. Mirrors the single-club/day slice of the
// /till/reconciliation route, reusing the same till-cash-tracking primitives.

const { reconcileDay, resolveFloatForDate } = require('../../lib/tillReconcile')
const { aggregateCashByDay } = require('../../lib/tillCashMovements')
const { netMovementsByDay, reasonLabel } = require('../../lib/tillMovements')
const { SLUG_CLUB_MAP } = require('../../utils/locationSlug')

// Pure: map the till reconcileDay output (camelCase) + day cash totals + drop
// line items into the snake_case row buildTillReceiptPayload expects.
// Returns null when there's no close count yet (nothing to print).
function toReconRow({ slug, businessDate, rec, closeBy, cashSales, cashRefunds, cashDrops, dropItems, manualOut = 0, manualIn = 0, movementItems }) {
  if (!rec || rec.countedClose == null) return null
  return {
    location_slug: slug,
    business_date: businessDate,
    closed_by: closeBy || '',
    opening_float: rec.openingFloat,
    cash_sales: cashSales,
    cash_refunds: cashRefunds,
    cash_drops: cashDrops,
    manual_out: manualOut,
    manual_in: manualIn,
    expected_close: rec.expectedClose,
    counted_close: rec.countedClose,
    over_short: rec.overShort,
    bag_drop: rec.bagDrop,
    drops: Array.isArray(dropItems) ? dropItems : [],
    movements: Array.isArray(movementItems) ? movementItems : [],
  }
}

// Same wide-UTC window the till route uses, so day bucketing matches exactly.
function utcWindow(dateStr) {
  const fromDate = new Date(`${dateStr}T00:00:00-08:00`)
  fromDate.setUTCDate(fromDate.getUTCDate() - 1)
  const toDate = new Date(`${dateStr}T23:59:59-07:00`)
  toDate.setUTCDate(toDate.getUTCDate() + 1)
  return { fromUtc: fromDate, toUtc: toDate }
}

// Best-effort itemized cash drops for the receipt (each drawer pull as a line).
// The till aggregator collapses drops to a daily total, so we read the drop-UPC
// cash lines directly. Defensive: any failure degrades to [] (the total still
// prints), never breaks the receipt.
async function loadCashDrops(supabase, clubNumber, fromUtc, toUtc, dropUpc) {
  try {
    if (!dropUpc) return []
    const { data: pays } = await supabase
      .from('inventory_transaction_payments')
      .select('transaction_pk, line_no, payment_amount, tender_category, inventory_transactions!inner(transaction_at, employee_id, station_name, is_return)')
      .eq('club_number', clubNumber)
      .eq('tender_category', 'cash')
      .gte('inventory_transactions.transaction_at', fromUtc.toISOString())
      .lte('inventory_transactions.transaction_at', toUtc.toISOString())
    if (!pays || !pays.length) return []
    const txnPks = [...new Set(pays.map(p => p.transaction_pk))]
    const upcByLine = new Map()
    for (let i = 0; i < txnPks.length; i += 200) {
      const { data: items } = await supabase
        .from('inventory_transaction_items')
        .select('transaction_pk, line_no, upc')
        .in('transaction_pk', txnPks.slice(i, i + 200))
      for (const it of (items || [])) upcByLine.set(`${it.transaction_pk}|${it.line_no}`, it.upc)
    }
    const drops = []
    for (const p of pays) {
      const txn = p.inventory_transactions
      if (!txn || !txn.employee_id || txn.station_name === 'ABC Transaction') continue
      const upc = upcByLine.get(`${p.transaction_pk}|${p.line_no}`)
      if (!upc || String(upc).trim() !== String(dropUpc).trim()) continue
      drops.push({ name: 'Cash drop', amount: Number(p.payment_amount) || 0 })
    }
    return drops
  } catch {
    return []
  }
}

async function loadReconciliation(supabase, locationSlug, businessDate) {
  const slug = String(locationSlug || '').toLowerCase()
  const club = SLUG_CLUB_MAP[slug]
  if (!club) return null

  const { data: setting } = await supabase
    .from('till_settings').select('standard_float, drop_upc').eq('club_number', club).maybeSingle()
  const dropUpc = setting?.drop_upc || null

  // Float effective for this business date (matches /till/reconciliation).
  const { data: floatRows } = await supabase
    .from('till_float_history').select('effective_date, standard_float').eq('club_number', club)
  const standardFloat = resolveFloatForDate(floatRows, businessDate, setting?.standard_float ?? 100)

  const { data: counts } = await supabase
    .from('till_counts').select('count_type, counted_amount, employee_name')
    .eq('club_number', club).eq('business_date', businessDate)
  const open = (counts || []).find(c => c.count_type === 'open')
  const close = (counts || []).find(c => c.count_type === 'close')
  if (!close) return null // no close count yet -> nothing to print

  const { fromUtc, toUtc } = utcWindow(businessDate)
  const byDay = await aggregateCashByDay(supabase, { clubNumber: club, fromUtc, toUtc, dropUpc })
  const cash = byDay.get(businessDate) || { cashSales: 0, cashRefunds: 0, cashDrops: 0 }

  // Cash the staff logged in the portal's Till tile for this day. Defensive:
  // a failure here degrades to zero rather than blocking the receipt, matching
  // how loadCashDrops behaves.
  let moveRows = []
  try {
    const { data } = await supabase
      .from('till_cash_movements')
      .select('business_date, direction, reason, amount, note, created_by_name, voided_at')
      .eq('club_number', club).eq('business_date', businessDate)
    moveRows = (data || []).filter(m => !m.voided_at)
  } catch { moveRows = [] }
  const move = netMovementsByDay(moveRows).get(businessDate) || { manualOut: 0, manualIn: 0 }

  const rec = reconcileDay({
    standardFloat,
    openingCount: open ? Number(open.counted_amount) : null,
    closingCount: Number(close.counted_amount),
    cashSales: cash.cashSales, cashRefunds: cash.cashRefunds, cashDrops: cash.cashDrops,
    manualOut: move.manualOut, manualIn: move.manualIn,
  })

  const dropItems = await loadCashDrops(supabase, club, fromUtc, toUtc, dropUpc)
  const movementItems = moveRows.map(m => ({
    direction: m.direction,
    name: reasonLabel(m.direction, m.reason) + (m.created_by_name ? ` - ${m.created_by_name}` : ''),
    amount: Number(m.amount) || 0,
  }))

  return toReconRow({
    slug, businessDate, rec, closeBy: close.employee_name,
    cashSales: Math.round(cash.cashSales * 100) / 100,
    cashRefunds: Math.round(cash.cashRefunds * 100) / 100,
    cashDrops: Math.round(cash.cashDrops * 100) / 100,
    dropItems, manualOut: move.manualOut, manualIn: move.manualIn, movementItems,
  })
}

module.exports = { loadReconciliation, toReconRow }
