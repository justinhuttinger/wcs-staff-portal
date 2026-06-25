// Retry ABC stock pushes that failed or never completed. The inventory_movements
// row is the queue; bounded attempts (<5) stop a permanently-rejecting row from
// looping forever. supabase is lazy-required so unit tests (which inject db) do
// not load it.
const { pushMovement } = require('./abcStockLevel')

async function runAbcPushRetry(deps = {}) {
  if (process.env.INVENTORY_ABC_PUSH_DISABLED === '1') return { attempted: 0, synced: 0, failed: 0, skipped: 0 }
  const db = deps.db || require('./supabase').supabaseAdmin
  const push = deps.push || pushMovement
  const { data: rows, error } = await db
    .from('inventory_movements')
    .select('id')
    .in('abc_push_status', ['failed', 'pending'])
    .lt('abc_push_attempts', 5)
    .order('occurred_at', { ascending: true })
    .limit(100)
  if (error) throw error
  const out = { attempted: 0, synced: 0, failed: 0, skipped: 0 }
  for (const r of rows || []) {
    out.attempted++
    let res
    try { res = await push(r.id) } catch { res = { status: 'failed' } }
    if (res.status === 'synced') out.synced++
    else if (res.status === 'skipped') out.skipped++
    else out.failed++
  }
  return out
}

module.exports = { runAbcPushRetry }
