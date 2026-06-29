// auth/scripts/backfill-transaction-payments.js
// One-time backfill: read inventory_transactions.raw, flatten
// items.item[].payments[] into inventory_transaction_payments.
// Idempotent (ON CONFLICT skip). Usage: node scripts/backfill-transaction-payments.js [--dry-run]
require('dotenv').config()
const { supabaseAdmin } = require('../src/services/supabase')
const { extractItemPayments } = require('../src/lib/posPayments')

const DRY = process.argv.includes('--dry-run')
const PAGE = 500

function itemsOf(raw) {
  const it = raw && raw.items && raw.items.item
  return Array.isArray(it) ? it : (it ? [it] : [])
}

async function main() {
  let from = 0, scanned = 0, inserted = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('inventory_transactions')
      .select('id, club_number, raw')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break

    const rows = []
    for (const t of data) {
      scanned++
      itemsOf(t.raw).forEach((it, lineNo) => {
        extractItemPayments(it).forEach((pay, pIdx) => {
          rows.push({
            transaction_pk: t.id, club_number: t.club_number,
            line_no: lineNo, pay_no: pIdx,
            payment_type: pay.payment_type, payment_amount: pay.payment_amount,
            payment_tax: pay.payment_tax, tender_category: pay.tender_category,
          })
        })
      })
    }
    if (rows.length && !DRY) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error: e } = await supabaseAdmin
          .from('inventory_transaction_payments')
          .upsert(rows.slice(i, i + 500), { onConflict: 'transaction_pk,line_no,pay_no', ignoreDuplicates: true })
        if (e) throw e
      }
    }
    inserted += rows.length
    from += PAGE
    console.log(`scanned ${scanned} txns, ${inserted} payment rows${DRY ? ' (dry-run)' : ''}`)
  }
  console.log(`DONE — ${scanned} transactions, ${inserted} payment rows ${DRY ? '(dry-run, nothing written)' : 'written'}`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
