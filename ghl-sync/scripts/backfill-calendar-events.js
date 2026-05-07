#!/usr/bin/env node
/**
 * Backfill abc_calendar_events from ABC for a date range and clubs.
 *
 * Usage:
 *   node scripts/backfill-calendar-events.js --from 2026-01-01 --to 2026-05-07
 *   node scripts/backfill-calendar-events.js --from 2026-01-01 --to 2026-05-07 --clubs 30935,31599
 *   node scripts/backfill-calendar-events.js --days 30
 */
require('dotenv').config();
const LOCATIONS = require('../src/config/locations');
const { syncCalendarEventsForClub } = require('../src/abc/calendarEvents');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

function parseDate(s) {
  if (!s) return null;
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
  const sleepMs = parseInt(arg('sleep', '100'), 10);

  let from, to;
  if (days) {
    to = new Date();
    from = new Date(Date.now() - parseInt(days, 10) * 86400000);
  } else {
    if (!fromArg || !toArg) {
      console.error('Need --from <date> and --to <date>, or --days <N>.');
      process.exit(1);
    }
    from = parseDate(fromArg);
    to = parseDate(toArg);
  }

  const clubFilter = clubsArg ? new Set(clubsArg.split(',').map((s) => s.trim())) : null;
  const clubs = LOCATIONS
    .map((l) => l.clubNumber)
    .filter(Boolean)
    .filter((c) => !clubFilter || clubFilter.has(c));

  console.log(`Backfilling calendar events for ${clubs.length} club(s) from ${from.toISOString().slice(0,10)} to ${to.toISOString().slice(0,10)}`);

  for (const club of clubs) {
    console.log(`\n=== Club ${club} ===`);
    const upserted = await syncCalendarEventsForClub(club, from, to, ['completed', 'canceled-charge'], sleepMs);
    console.log(`Club ${club} done: ${upserted} appointments upserted.`);
  }

  console.log('\nAll done.');
})().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
