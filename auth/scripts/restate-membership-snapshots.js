#!/usr/bin/env node
/**
 * Restate recorded membership snapshots after the ghost clear-out (migration 193).
 *
 * Every other member report reconstructs history from current state, so
 * removing a ghost row removes it from every month at once and no chart shows
 * a step. membership_daily_snapshots is the exception: it FREEZES the number it
 * computed that night. Left alone, its series would carry the old inflated
 * totals up to the clear-out and the corrected ones after, which is precisely
 * the cliff the correction was designed not to create.
 *
 * So the nights already recorded are recomputed against the corrected member
 * table. Recomputation is normally what this table exists to avoid, but these
 * rows are days old rather than months, and a small reconstruction error is a
 * far better outcome than a visible notch that means nothing.
 *
 * Run AFTER ghl-sync/scripts/reconcile-ghost-members.js.
 *
 * Usage:
 *   node scripts/restate-membership-snapshots.js --dry-run
 *   node scripts/restate-membership-snapshots.js
 *   node scripts/restate-membership-snapshots.js 2026-09-02 2026-09-03
 */

require('dotenv').config()

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const explicit = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a))

  const { supabaseAdmin } = require('../src/services/supabase')
  const { runSnapshot } = require('../src/services/membershipSnapshot')

  let dates = explicit
  if (dates.length === 0) {
    const { data, error } = await supabaseAdmin
      .from('membership_daily_snapshots')
      .select('snapshot_date')
      .order('snapshot_date')
    if (error) throw new Error(error.message)
    dates = [...new Set((data || []).map(r => r.snapshot_date))]
  }

  if (dates.length === 0) {
    console.log('No recorded snapshots — nothing to restate.')
    return
  }

  const before = await totals(supabaseAdmin, dates)
  console.log('Recorded now:')
  for (const d of dates) console.log(`  ${d}  ${before[d] ?? '?'}`)

  if (dryRun) {
    console.log('\nDRY RUN — no rows written.')
    return
  }

  for (const d of dates) {
    // Upserts by (snapshot_date, location_slug), so this replaces the night's
    // row rather than adding a second one.
    await runSnapshot(d)
    console.log(`  restated ${d}`)
  }

  const after = await totals(supabaseAdmin, dates)
  console.log('\nRestated:')
  for (const d of dates) {
    const delta = (after[d] ?? 0) - (before[d] ?? 0)
    console.log(`  ${d}  ${before[d] ?? '?'} -> ${after[d] ?? '?'}  (${delta >= 0 ? '+' : ''}${delta})`)
  }
}

async function totals(supabaseAdmin, dates) {
  const { data, error } = await supabaseAdmin
    .from('membership_daily_snapshots')
    .select('snapshot_date,total_members')
    .in('snapshot_date', dates)
  if (error) throw new Error(error.message)
  const out = {}
  for (const r of data || []) out[r.snapshot_date] = (out[r.snapshot_date] || 0) + (r.total_members || 0)
  return out
}

main().catch(err => { console.error(err); process.exit(1) })
