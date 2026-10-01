#!/usr/bin/env node
/**
 * One-time backfill of abc_member_checkin_days (migration 225): per-member
 * check-ins per Pacific day for the last N days, so "X visits in Y days"
 * celebration rules work from day one instead of only collecting from launch.
 *
 * One ABC request per club per day (365 days x 7 clubs ~= 2,555 requests,
 * ~15-20 min). Safe to re-run: rows upsert on (club_number, member_id, day).
 * The nightly cron keeps it current afterwards (src/abc/checkinDays.js).
 *
 * Usage:
 *   node scripts/backfill-checkin-days.js 365
 *   node scripts/backfill-checkin-days.js 30 --clubs 30935,31599
 * Or on the server: POST /api/checkin-days/backfill { "days": 365 }
 */
require('dotenv').config()
const { refreshCheckinDays } = require('../src/abc/checkinDays')

async function main() {
  const args = process.argv.slice(2)
  const days = parseInt(args.find(a => /^\d+$/.test(a)) || '365', 10)
  const clubIdx = args.indexOf('--clubs')
  const opts = { days, log: console.log }
  if (clubIdx >= 0) opts.clubs = args[clubIdx + 1].split(',')
  console.log(`Backfilling ${days} days of check-ins...`)
  const summary = await refreshCheckinDays(opts)
  console.log(`Done: ${summary.rows} rows, ${summary.visits} check-ins, ${summary.failed.length} club-days failed`)
  for (const f of summary.failed) console.log(`  FAILED ${f.club} ${f.day}: ${f.error}`)
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1) })
}
