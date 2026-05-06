#!/usr/bin/env node
/**
 * Backfill hourly check-in buckets from ABC for all configured clubs.
 *
 * Usage examples:
 *   node scripts/backfill-checkins.js --from 2026-04-01 --to 2026-05-06
 *   node scripts/backfill-checkins.js --from 2026-05-01T00:00:00Z --to 2026-05-06T20:00:00Z --clubs 30935,31599
 *   node scripts/backfill-checkins.js --days 30           # last 30 days through "now"
 *
 * Notes:
 *   - Hours are floored to UTC :00. Each hour fires one ABC call per club.
 *   - --sleep <ms> tunes politeness between calls (default 800ms).
 *   - Run from the ghl-sync/ directory so .env is loaded.
 */

require('dotenv').config();

const LOCATIONS = require('../src/config/locations');
const { backfillClub } = require('../src/abc/checkins');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

function parseDate(s) {
  if (!s) return null;
  // Accept "YYYY-MM-DD" or full ISO; treat short dates as UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00Z');
  const d = new Date(s);
  if (isNaN(d)) throw new Error(`Bad date: ${s}`);
  return d;
}

(async () => {
  const days = arg('days');
  const fromArg = arg('from');
  const toArg = arg('to');
  const clubsArg = arg('clubs');
  const sleepMs = parseInt(arg('sleep', '800'), 10);

  let from, to;
  if (days) {
    to = new Date();
    from = new Date(Date.now() - parseInt(days, 10) * 24 * 60 * 60 * 1000);
  } else {
    if (!fromArg || !toArg) {
      console.error('Need --from <date> and --to <date>, or --days <N>.');
      process.exit(1);
    }
    from = parseDate(fromArg);
    to = parseDate(toArg);
  }

  const clubFilter = clubsArg ? new Set(clubsArg.split(',').map(s => s.trim())) : null;
  const clubs = LOCATIONS
    .map(l => l.clubNumber)
    .filter(Boolean)
    .filter(c => !clubFilter || clubFilter.has(c));

  console.log(`Backfilling check-ins for ${clubs.length} club(s) from ${from.toISOString()} to ${to.toISOString()}`);

  for (const club of clubs) {
    console.log(`\n=== Club ${club} ===`);
    await backfillClub(club, from, to, sleepMs);
  }

  console.log('\nDone.');
})().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
