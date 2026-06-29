// auth/src/lib/tillCashMovements.js
// Aggregate physical-register CASH movements per Pacific business day for a club.
// Only cash tenders matter to a drawer. A line whose UPC is the club's configured
// drop sentinel is a drawer reduction (cash pulled), not a sale.
//
// inventory_transaction_payments has a real FK to inventory_transactions but NOT
// to inventory_transaction_items (both key on transaction_pk; the line link is the
// composite (transaction_pk, line_no), which PostgREST cannot embed). So we pull
// the cash payment rows with their parent transaction in one query, then fetch the
// line UPCs for those transactions in a second query and join in JS by
// (transaction_pk, line_no).

function classifyCashLine({ tender_category, is_return, upc, amount }, dropUpc) {
  const out = { sales: 0, refunds: 0, drops: 0 }
  // The aggregation path pre-filters to cash, but this guard keeps the function a
  // self-contained pure unit (tested directly with mixed tenders).
  if (tender_category !== 'cash') return out
  const amt = Number(amount) || 0
  // drop_upc is NOT NULL in till_settings (defaults to the sentinel), so the
  // dropUpc guard below is effectively always satisfied; if a caller ever passes
  // a falsy dropUpc the sentinel line falls through to `sales` rather than `drops`.
  if (dropUpc && upc && String(upc).trim() === String(dropUpc).trim()) {
    out.drops = amt          // cash physically pulled from the drawer
  } else if (is_return) {
    out.refunds = amt
  } else {
    out.sales = amt
  }
  return out
}

// pacificDate reused from operandioJobs to keep day-bucketing consistent.
const { pacificDate } = require('./operandioJobs')

const PAGE = 1000

// Fetch every row a query would return, paginating past PostgREST's default row
// cap. `makeQuery` must return a FRESH builder each call (awaiting a builder
// executes it, so it cannot be reused). Without this a high-volume club or a long
// window would silently truncate and undercount cash.
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

async function aggregateCashByDay(supabaseAdmin, { clubNumber, fromUtc, toUtc, dropUpc }) {
  // 1) Cash payment rows + parent transaction (real FK embed), fully paginated.
  const pays = await fetchAll(() => supabaseAdmin
    .from('inventory_transaction_payments')
    .select('transaction_pk, line_no, payment_amount, tender_category, inventory_transactions!inner(transaction_at, employee_id, station_name, is_return)')
    .eq('club_number', clubNumber)
    .eq('tender_category', 'cash')
    .gte('inventory_transactions.transaction_at', fromUtc.toISOString())
    .lte('inventory_transactions.transaction_at', toUtc.toISOString()), 'cash aggregate')
  if (pays.length === 0) return new Map()

  // 2) UPCs for those transactions' lines, keyed (transaction_pk|line_no). Each
  // 200-pk batch is itself paginated in case the lines exceed the row cap.
  const txnPks = [...new Set(pays.map(p => p.transaction_pk))]
  const upcByLine = new Map()
  for (let i = 0; i < txnPks.length; i += 200) {
    const batch = txnPks.slice(i, i + 200)
    const items = await fetchAll(() => supabaseAdmin
      .from('inventory_transaction_items')
      .select('transaction_pk, line_no, upc')
      .in('transaction_pk', batch), 'cash aggregate line lookup')
    for (const it of items) upcByLine.set(`${it.transaction_pk}|${it.line_no}`, it.upc)
  }

  // 3) Classify + bucket by Pacific day.
  const byDay = new Map()
  for (const p of pays) {
    const txn = p.inventory_transactions
    if (!txn || !txn.employee_id || txn.station_name === 'ABC Transaction') continue // physical register only
    const day = pacificDate(txn.transaction_at)
    if (!day) continue
    const c = classifyCashLine({
      tender_category: p.tender_category, is_return: txn.is_return,
      upc: upcByLine.get(`${p.transaction_pk}|${p.line_no}`),
      amount: p.payment_amount,
    }, dropUpc)
    const cur = byDay.get(day) || { cashSales: 0, cashRefunds: 0, cashDrops: 0 }
    cur.cashSales += c.sales; cur.cashRefunds += c.refunds; cur.cashDrops += c.drops
    byDay.set(day, cur)
  }
  return byDay
}

module.exports = { classifyCashLine, aggregateCashByDay }
