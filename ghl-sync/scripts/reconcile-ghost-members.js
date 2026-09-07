#!/usr/bin/env node
/**
 * One-time clear-out of the ghost backlog that accumulated before the sync
 * learned to reconcile (migration 193).
 *
 * abc_members had never removed a row, so every member ABC dropped since the
 * table was created is still in it, still reading Active. Measured 2026-09-07:
 * 356 rows, 325 of them Active, 100 of those double-counted because the member
 * transferred club and is active at the new one too.
 *
 * Does exactly what the sync now does every cycle, for every club, in one pass:
 * a full active pull plus a full INACTIVE pull (the sync's inactive pull is
 * incremental, which is fine for keeping up but not for a backlog — a member
 * who went inactive a year ago must be seen here or they would be archived by
 * mistake), then archive whatever we hold as active that ABC did not return.
 *
 * Safe to re-run: a second pass finds nothing, because the first one moved the
 * rows out.
 *
 * Usage:
 *   node scripts/reconcile-ghost-members.js --dry-run     # show, change nothing
 *   node scripts/reconcile-ghost-members.js               # every club
 *   node scripts/reconcile-ghost-members.js 30935         # one club
 *
 * NOTE: needs Node 22+. supabase-js wants native WebSocket and refuses to
 * initialise on the machine default of Node 20 — the same trap the migration
 * 123 backfill hit. Run it with an explicit newer binary if `node -v` is 20.
 */

require('dotenv').config()
const { fetchAllABCMembers } = require('../src/abc/client')
const { planGhosts } = require('../src/abc/ghostMembers')

const CLUBS = ['30935', '31599', '7655', '31598', '31600', '31601', '32073']
const PAGE = 1000

let _supabase = null
function db() {
  if (!_supabase) _supabase = require('../src/db/supabase')
  return _supabase
}

async function heldActive(clubNumber) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from('abc_members')
      .select('member_id,last_sync_at,membership_type,since_date')
      .eq('club_number', clubNumber)
      .eq('member_status', 'Active')
      // Stable sort required: range() is LIMIT/OFFSET and an unordered paged
      // read can skip rows, which here would read as a member we do not hold.
      .order('member_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

async function run(clubNumber, dryRun) {
  // A stamp from BEFORE the pulls. Every held row predates it, so the "not
  // refreshed this cycle" half of the rule is satisfied by all of them and the
  // decision rests entirely on whether ABC returned the member — which is what
  // a backlog clear-out should turn on.
  const cycleStartedAt = new Date().toISOString()

  const active = await fetchAllABCMembers(clubNumber, { activeStatus: 'active' })
  const inactive = await fetchAllABCMembers(clubNumber, { activeStatus: 'inactive' })
  const abcIds = new Set([...active, ...inactive].map(m => m.memberId))

  const rows = await heldActive(clubNumber)
  const plan = planGhosts({ heldActive: rows, abcIds, cycleStartedAt })

  if (plan.skipped) {
    console.error(
      `[${clubNumber}] SKIPPED — ABC returned ${plan.abcCount} ids against ${plan.heldActiveCount} ` +
      `held active (${(plan.coverage * 100).toFixed(1)}%). Refusing to archive on a pull this thin.`
    )
    return { club: clubNumber, held: plan.heldActiveCount, abc: plan.abcCount, ghosts: 0, skipped: true }
  }

  const byId = new Map(rows.map(r => [r.member_id, r]))
  console.log(
    `[${clubNumber}] held active ${plan.heldActiveCount}, ABC returned ${plan.abcCount} ` +
    `(active ${active.length} + inactive ${inactive.length}), ghosts ${plan.ghostIds.length}`
  )
  for (const id of plan.ghostIds.slice(0, 10)) {
    const r = byId.get(id) || {}
    console.log(`    ${id}  ${r.membership_type || '?'}  since ${r.since_date || '?'}  last synced ${r.last_sync_at || 'never'}`)
  }
  if (plan.ghostIds.length > 10) console.log(`    ... and ${plan.ghostIds.length - 10} more`)

  if (dryRun || plan.ghostIds.length === 0) {
    return { club: clubNumber, held: plan.heldActiveCount, abc: plan.abcCount, ghosts: plan.ghostIds.length, archived: 0 }
  }

  const { data, error } = await db().rpc('abc_ghost_members', {
    p_club: clubNumber,
    p_member_ids: plan.ghostIds,
    p_reason: 'backlog clear-out: absent from full ABC active+inactive pull',
  })
  if (error) throw new Error(`abc_ghost_members failed: ${error.message}`)

  return { club: clubNumber, held: plan.heldActiveCount, abc: plan.abcCount, ghosts: plan.ghostIds.length, archived: data }
}

async function main() {
  if (!process.env.ABC_APP_ID || !process.env.ABC_APP_KEY) {
    console.error('ABC_APP_ID and ABC_APP_KEY must be set')
    process.exit(1)
  }
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const only = args.filter(a => !a.startsWith('--'))
  const clubs = only.length > 0 ? only : CLUBS

  if (dryRun) console.log('DRY RUN — nothing will be changed\n')

  const summary = []
  for (const club of clubs) {
    try {
      summary.push(await run(club, dryRun))
    } catch (err) {
      console.error(`[${club}] failed:`, err.message)
      summary.push({ club, error: err.message })
    }
  }
  console.table(summary)

  if (!dryRun) {
    console.log(
      '\nDone. membership_daily_snapshots still holds the pre-correction totals for\n' +
      'any night already recorded — restate those with:\n' +
      '  node scripts/restate-membership-snapshots.js'
    )
  }
}

main().catch(err => { console.error(err); process.exit(1) })
