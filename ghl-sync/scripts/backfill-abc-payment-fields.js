#!/usr/bin/env node
/**
 * One-time backfill for the four agreement fields added in migration 123:
 * agreement_payment_method, agreement_term, is_primary_member, is_non_member.
 *
 * Why this exists: the regular sync pulls ACTIVE members in full every cycle,
 * so they populate on their own within one run. Inactive members are only
 * re-pulled when their lastModifiedTimestamp falls inside a short window, so a
 * member who joined and cancelled months ago would keep null forever — and
 * those rows still belong in a historical "% on ACH" for the month they joined.
 * Leaving them null would quietly bias the number toward whoever is still
 * active today.
 *
 * Only ever writes the four new columns. It does not touch anything else on the
 * row, so it cannot clobber a value the live sync owns.
 *
 * Usage:
 *   node scripts/backfill-abc-payment-fields.js            # every club
 *   node scripts/backfill-abc-payment-fields.js 31601      # one club
 *   node scripts/backfill-abc-payment-fields.js --dry-run
 */

require('dotenv').config();
const { fetchAllABCMembers } = require('../src/abc/client');

// Required lazily so --dry-run needs no database connection at all: the dry run
// is a read-only look at what ABC returns, and demanding Supabase credentials
// (and a Node 22+ runtime, which the client needs for native WebSocket) just to
// print a histogram would make the safe mode the hard one to run.
let _supabase = null;
function db() {
  if (!_supabase) _supabase = require('../src/db/supabase');
  return _supabase;
}

const CLUBS = ['30935', '31599', '7655', '31598', '31600', '31601', '32073'];
const BATCH = 250;

function toBool(v) {
  if (v === undefined || v === null) return null;
  return v === 'true' || v === true;
}

async function collectRows(clubNumber) {
  const rows = [];
  // Both passes. "inactive" is the one the incremental sync under-covers, but
  // pulling active too costs little and makes the club complete in one run.
  // NOTE: ABC expects active|inactive|all here, NOT true|false — a bad value
  // returns 0 members with a 200 and an "Invalid value" message in status.
  for (const activeStatus of ['active', 'inactive']) {
    const members = await fetchAllABCMembers(clubNumber, { activeStatus });
    console.log(`[${clubNumber}/${activeStatus}] ${members.length} members`);
    for (const m of members) {
      const a = m.agreement || {};
      rows.push({
        member_id: m.memberId,
        club_number: clubNumber,
        agreement_payment_method: a.agreementPaymentMethod || null,
        agreement_term: a.term || null,
        is_primary_member: toBool(a.isPrimaryMember),
        is_non_member: toBool(a.isNonMember),
      });
    }
  }
  return rows;
}

async function backfillClub(clubNumber, dryRun) {
  const rows = await collectRows(clubNumber);

  if (dryRun) {
    const methods = {};
    for (const r of rows) {
      const k = r.agreement_payment_method || '(null)';
      methods[k] = (methods[k] || 0) + 1;
    }
    console.log(`[${clubNumber}] DRY RUN — ${rows.length} rows`, methods);
    return { club: clubNumber, rows: rows.length, updated: 0 };
  }

  // Update rather than upsert: a partial upsert would fail every NOT NULL
  // column on any member_id not already in the table, and inventing
  // half-populated member rows is not this script's job.
  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(r =>
      db()
        .from('abc_members')
        .update({
          agreement_payment_method: r.agreement_payment_method,
          agreement_term: r.agreement_term,
          is_primary_member: r.is_primary_member,
          is_non_member: r.is_non_member,
        })
        .eq('member_id', r.member_id)
        .eq('club_number', r.club_number)
        .select('id')
    ));
    for (const { data, error } of results) {
      if (error) {
        console.error(`[${clubNumber}] update error:`, error.message);
        continue;
      }
      updated += (data || []).length;
    }
    process.stdout.write(`\r[${clubNumber}] updated ${updated}/${rows.length}`);
  }
  process.stdout.write('\n');
  return { club: clubNumber, rows: rows.length, updated };
}

async function main() {
  if (!process.env.ABC_APP_ID || !process.env.ABC_APP_KEY) {
    console.error('ABC_APP_ID and ABC_APP_KEY must be set');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.filter(a => !a.startsWith('--'));
  const clubs = only.length > 0 ? only : CLUBS;

  const summary = [];
  for (const club of clubs) {
    try {
      summary.push(await backfillClub(club, dryRun));
    } catch (err) {
      console.error(`[${club}] failed:`, err.message);
      summary.push({ club, rows: 0, updated: 0, error: err.message });
    }
  }
  console.table(summary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
