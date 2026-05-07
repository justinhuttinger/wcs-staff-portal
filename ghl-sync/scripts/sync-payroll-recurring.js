#!/usr/bin/env node
/**
 * One-shot: pull ABC recurring services SOLD during a month for all 7 clubs,
 * compute 4% commissions, and upsert into payroll_recurring_commissions.
 *
 * Usage:
 *   node scripts/sync-payroll-recurring.js --month 2026-04          # April 2026
 *   node scripts/sync-payroll-recurring.js --from 2026-04-01 --to 2026-04-30
 *   node scripts/sync-payroll-recurring.js --month 2026-04 --clubs 30935,31599
 */
require('dotenv').config();
const LOCATIONS = require('../src/config/locations');
const { syncRecurringCommissionsForClub } = require('../src/abc/recurringServices');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

function monthBounds(monthStr) {
  // monthStr "2026-04" -> { from: 2026-04-01, to: 2026-04-30 }
  const m = String(monthStr).match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`Bad --month format (use YYYY-MM): ${monthStr}`);
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0)); // last day of month
  return { from, to };
}

(async () => {
  const monthArg = arg('month');
  const fromArg = arg('from');
  const toArg = arg('to');
  const clubsArg = arg('clubs');

  let from, to;
  if (monthArg) {
    ({ from, to } = monthBounds(monthArg));
  } else if (fromArg && toArg) {
    from = new Date(fromArg + 'T00:00:00Z');
    to = new Date(toArg + 'T00:00:00Z');
  } else {
    console.error('Need --month YYYY-MM, or --from YYYY-MM-DD --to YYYY-MM-DD');
    process.exit(1);
  }

  const clubFilter = clubsArg ? new Set(clubsArg.split(',').map((s) => s.trim())) : null;
  const clubs = LOCATIONS
    .map((l) => l.clubNumber)
    .filter(Boolean)
    .filter((c) => !clubFilter || clubFilter.has(c));

  console.log(`Pulling recurring services SOLD ${from.toISOString().slice(0,10)} -> ${to.toISOString().slice(0,10)} for ${clubs.length} club(s)`);

  let grand = 0;
  for (const club of clubs) {
    console.log(`\n=== Club ${club} ===`);
    const upserted = await syncRecurringCommissionsForClub(club, from, to);
    grand += upserted;
    console.log(`Club ${club}: ${upserted} services upserted.`);
  }
  console.log(`\nDone. Grand total: ${grand} recurring services across ${clubs.length} clubs.`);
})().catch((err) => {
  console.error('sync-payroll-recurring failed:', err);
  process.exit(1);
});
