#!/usr/bin/env node
// One-time SMS backfill.
//
//   node scripts/backfillSmsMessages.js                 # every location, 180 days
//   node scripts/backfillSmsMessages.js springfield     # one location
//   node scripts/backfillSmsMessages.js springfield 90  # one location, 90 days
//
// Reuses the normal sync with an explicit `sinceIso` instead of the watermark,
// so there is exactly one code path walking conversations. Idempotent: every
// write is an upsert keyed on the GHL message id, so re-running after an
// interruption resumes safely rather than duplicating.
//
// Expect roughly an hour across all seven locations at 180 days. Run it
// off-hours, one location at a time, so it does not compete with the scheduled
// syncs for GHL rate limit.

require('dotenv').config();
const LOCATIONS = require('../src/config/locations');
const { smsStatsSyncForLocation } = require('../src/sync/smsStatsSync');

const DEFAULT_DAYS = 180;

async function main() {
  const [slugArg, daysArg] = process.argv.slice(2);
  const days = Number(daysArg) > 0 ? Number(daysArg) : DEFAULT_DAYS;
  const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const targets = slugArg
    ? LOCATIONS.filter(l => l.slug === slugArg)
    : LOCATIONS;

  if (!targets.length) {
    console.error(`No location matches "${slugArg}". Known: ${LOCATIONS.map(l => l.slug).join(', ')}`);
    process.exit(1);
  }

  console.log(`[Backfill] ${targets.length} location(s), back to ${sinceIso}`);

  for (const loc of targets) {
    const t0 = Date.now();
    try {
      const r = await smsStatsSyncForLocation(loc, { sinceIso });
      console.log(`[Backfill] ${loc.name}: convos=${r.conversations} msgs=${r.messages} upserted=${r.upserted} templates=${r.templates} replies=${r.replies} errors=${r.errors} in ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (err) {
      console.error(`[Backfill] ${loc.name}: FAILED — ${err.message}`);
    }
  }

  console.log('[Backfill] Done.');
  process.exit(0);
}

main().catch(err => {
  console.error('[Backfill] Fatal:', err);
  process.exit(1);
});
