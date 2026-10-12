#!/usr/bin/env node
/**
 * One-time backfill of home addresses (migration 236) for INACTIVE members, so
 * the Member Map's Cancelled filter can plot people who left before the
 * address columns existed.
 *
 * Why this exists: the sync pulls active members in full every cycle, so they
 * filled on their own. Inactive members are only re-pulled when modified in
 * the last 90 days (ABC_INACTIVE_SINCE_DAYS), so anyone who cancelled earlier
 * would never get an address. Pulls inactive members modified in the last two
 * years: the Member Map's Cancelled / New Members horizon (migration 237).
 *
 * Only ever writes the five address columns, and only on rows already in
 * abc_members (update, not upsert), so it cannot clobber a value the live sync
 * owns or invent half-populated member rows.
 *
 * Usage:
 *   node scripts/backfill-abc-inactive-addresses.js            # every club
 *   node scripts/backfill-abc-inactive-addresses.js 31601      # one club
 *   node scripts/backfill-abc-inactive-addresses.js --dry-run
 */

require('dotenv').config();
const { fetchAllABCMembers } = require('../src/abc/client');

let _supabase = null;
function db() {
  if (!_supabase) _supabase = require('../src/db/supabase');
  return _supabase;
}

const CLUBS = require('../src/config/clubs.json').clubs.filter(c => c.active).map(c => c.clubNumber);
const BATCH = 250;
const HORIZON_DAYS = 730;

async function backfillClub(clubNumber, dryRun) {
  const since = new Date(Date.now() - HORIZON_DAYS * 86400000).toISOString().slice(0, 10);
  const members = await fetchAllABCMembers(clubNumber, { activeStatus: 'inactive', lastModifiedSince: since });
  const rows = members
    .map(m => {
      const p = m.personal || {};
      return {
        member_id: m.memberId,
        address_line1: p.addressLine1 || null,
        address_line2: p.addressLine2 || null,
        city: p.city || null,
        state: p.state || null,
        postal_code: p.postalCode || null,
      };
    })
    .filter(r => r.address_line1);
  console.log(`[${clubNumber}] ${members.length} inactive since ${since}, ${rows.length} with an address`);
  if (dryRun) return { club: clubNumber, rows: rows.length, updated: 0 };

  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(({ member_id, ...address }) =>
      db().from('abc_members').update(address)
        .eq('member_id', member_id).eq('club_number', clubNumber)
    ));
    for (const r of results) {
      if (r.error) console.error(`[${clubNumber}] update error:`, r.error.message);
      else updated++;
    }
  }
  console.log(`[${clubNumber}] updated ${updated}`);
  return { club: clubNumber, rows: rows.length, updated };
}

(async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.filter(a => !a.startsWith('--'));
  const clubs = only.length ? only : CLUBS;
  const out = [];
  for (const c of clubs) out.push(await backfillClub(c, dryRun));
  console.log(JSON.stringify(out));
})().catch(err => { console.error(err); process.exit(1); });
