#!/usr/bin/env node
/**
 * Build abc_member_checkin_months: per-member check-in counts per month.
 *
 * WHY THIS EXISTS
 *
 * abc_members stores only each member's LATEST check-in, so the conditional
 * membership rule ("an Active&Fit member counts only if they came in within 60
 * days") can be answered for today and for no other date. Applying today's
 * answer to last March would retroactively delete members who were genuinely
 * active then. This table gives the rule a past tense.
 *
 * It also yields true per-month unique members, which checkins_hourly cannot:
 * that table's buckets stop at the last sync tick of each hour and are never
 * revisited, so its totals run short.
 *
 * THE TWO ABC TRAPS THIS WALKS AROUND
 *
 *   1. /members/checkins/summaries rejects any checkInTimestampRange longer
 *      than 14 days — with an HTTP 200, an empty members array, and the
 *      complaint buried in status.message. A month-long range silently returns
 *      nothing. Hence month-aligned chunks of at most 14 days.
 *   2. The response carries per-member COUNTS for the range but no per-check-in
 *      dates, so month granularity is the finest this can reconstruct without
 *      one request per day.
 *
 * Usage:
 *   node scripts/backfill-member-checkin-months.js 2025-01 2026-08
 *   node scripts/backfill-member-checkin-months.js 2026-08 2026-08 --clubs 31599
 *   node scripts/backfill-member-checkin-months.js 2026-08 2026-08 --dry-run
 */

require('dotenv').config();
const axios = require('axios');

// Required lazily so --dry-run needs no database (and no Node 22+ runtime for
// the supabase client's native WebSocket).
let _supabase = null;
function db() {
  if (!_supabase) _supabase = require('../src/db/supabase');
  return _supabase;
}

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;

const CLUBS = ['30935', '31599', '7655', '31598', '31600', '31601', '32073'];
const MAX_CHUNK_DAYS = 14;   // ABC's hard limit on checkInTimestampRange
const PAGE_SIZE = 5000;
const MAX_PAGES = 50;
const PAUSE_MS = 400;
const UPSERT_BATCH = 1000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Month-aligned chunks of at most MAX_CHUNK_DAYS, so no chunk straddles a month.
 *
 * Clipped to `today`: a chunk lying entirely in the future is never requested.
 * ABC answers a future range with "No records found", and because a month is
 * written all-or-nothing (see backfillMonth), that single refusal threw away
 * every chunk already gathered — August 2026 was collected in full and then
 * discarded because its 29th-31st chunk had not happened yet.
 */
function chunksForMonth(year, month, today = new Date()) {
  const last = daysInMonth(year, month);
  const todayISO = today.toISOString().slice(0, 10);
  const out = [];
  for (let start = 1; start <= last; start += MAX_CHUNK_DAYS) {
    const startISO = iso(year, month, start);
    // The whole chunk is still ahead of us; nothing to collect yet.
    if (startISO > todayISO) break;
    const end = Math.min(start + MAX_CHUNK_DAYS - 1, last);
    const endISO = iso(year, month, end);
    out.push([startISO, endISO > todayISO ? todayISO : endISO]);
  }
  return out;
}

function monthRange(fromYm, toYm) {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  const out = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push([y, m]);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

async function fetchChunk(clubNumber, startDate, endDate) {
  const counts = new Map();
  let page = 1;
  while (page <= MAX_PAGES) {
    const res = await axios.get(`${ABC_BASE_URL}/${clubNumber}/members/checkins/summaries`, {
      params: {
        checkInTimestampRange: `${startDate} 00:00:00,${endDate} 23:59:59`,
        size: PAGE_SIZE,
        page,
      },
      headers: { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' },
      timeout: 120000,
    });

    const status = res.data?.status || {};
    const members = res.data?.members || [];

    // ABC answers a rejected request with 200 + an empty list, so an empty
    // response has to be read carefully. "No records found" is a real answer —
    // a club that had not opened yet genuinely has no check-ins — while
    // anything else alongside an empty list means the request was refused and
    // must not be recorded as a month of zero.
    if (members.length === 0) {
      const msg = (status.message || '').trim();
      const isEmpty = msg === '' || /^success$/i.test(msg) || /no records found/i.test(msg);
      if (!isEmpty) {
        throw new Error(`ABC rejected ${startDate}..${endDate}: ${msg}`);
      }
      break;
    }

    for (const m of members) {
      let n = 0;
      for (const c of (m.checkInCounts?.checkInCount || [])) {
        const v = parseInt(c.count, 10);
        if (!Number.isNaN(v)) n += v;
      }
      counts.set(m.memberId, (counts.get(m.memberId) || 0) + n);
    }

    const next = status.nextPage;
    if (!next || next === '' || next === String(page)) break;
    const parsed = parseInt(next, 10);
    if (Number.isNaN(parsed)) break;
    page = parsed;
    await sleep(PAUSE_MS);
  }
  return counts;
}

async function backfillMonth(clubNumber, year, month, dryRun) {
  const monthStart = iso(year, month, 1);
  const totals = new Map();

  for (const [s, e] of chunksForMonth(year, month)) {
    const counts = await fetchChunk(clubNumber, s, e);
    for (const [memberId, n] of counts) {
      totals.set(memberId, (totals.get(memberId) || 0) + n);
    }
    await sleep(PAUSE_MS);
  }

  const rows = [...totals.entries()].map(([member_id, checkins]) => ({
    club_number: clubNumber,
    member_id,
    month: monthStart,
    checkins,
    fetched_at: new Date().toISOString(),
  }));

  const visits = rows.reduce((a, r) => a + r.checkins, 0);
  if (dryRun) {
    console.log(`  ${clubNumber} ${monthStart}: ${rows.length} members, ${visits} check-ins (dry run)`);
    return { members: rows.length, visits, written: 0 };
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await db()
      .from('abc_member_checkin_months')
      .upsert(batch, { onConflict: 'club_number,member_id,month' });
    if (error) throw new Error(`upsert: ${error.message}`);
    written += batch.length;
  }
  console.log(`  ${clubNumber} ${monthStart}: ${rows.length} members, ${visits} check-ins, ${written} rows`);
  return { members: rows.length, visits, written };
}

async function main() {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    console.error('ABC_APP_ID and ABC_APP_KEY must be set');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const clubIdx = args.indexOf('--clubs');
  const clubs = clubIdx >= 0 ? args[clubIdx + 1].split(',') : CLUBS;
  const positional = args.filter((a, i) => !a.startsWith('--') && !(clubIdx >= 0 && i === clubIdx + 1));
  const fromYm = positional[0];
  const toYm = positional[1] || fromYm;

  if (!/^\d{4}-\d{2}$/.test(fromYm || '') || !/^\d{4}-\d{2}$/.test(toYm)) {
    console.error('Usage: backfill-member-checkin-months.js <from YYYY-MM> [to YYYY-MM] [--clubs a,b] [--dry-run]');
    process.exit(1);
  }

  const months = monthRange(fromYm, toYm);
  console.log(`${months.length} month(s) x ${clubs.length} club(s)${dryRun ? ' (dry run)' : ''}`);

  const summary = [];
  for (const [y, m] of months) {
    for (const club of clubs) {
      try {
        const r = await backfillMonth(club, y, m, dryRun);
        summary.push({ club, month: iso(y, m, 1), ...r });
      } catch (err) {
        console.error(`  ${club} ${iso(y, m, 1)} FAILED: ${err.message}`);
        summary.push({ club, month: iso(y, m, 1), members: 0, visits: 0, written: 0, error: err.message });
      }
    }
  }

  const failed = summary.filter(s => s.error);
  console.log(`\nDone. ${summary.length - failed.length} ok, ${failed.length} failed.`);
  console.log(`Members recorded: ${summary.reduce((a, s) => a + s.members, 0).toLocaleString()}`);
  console.log(`Check-ins recorded: ${summary.reduce((a, s) => a + s.visits, 0).toLocaleString()}`);
  if (failed.length) {
    console.table(failed);
    // A month is written all-or-nothing, because its total is the sum of its
    // chunks and a partial sum is a wrong number rather than a missing one. A
    // failure therefore leaves that month absent while its neighbours are
    // present, which nobody reading the table could detect. Print exactly what
    // to re-run, and exit non-zero so a scheduled run cannot report success.
    const months = [...new Set(failed.map(f => String(f.month).slice(0, 7)))].sort();
    const clubsFailed = [...new Set(failed.map(f => f.club))].sort();
    console.error('\nIncomplete. These months are NOT in the table and must be re-run:');
    console.error(`  node scripts/backfill-member-checkin-months.js ${months[0]} ${months[months.length - 1]} --clubs ${clubsFailed.join(',')}`);
    process.exitCode = 1;
  }
}

// Only when run directly — requiring this for its date helpers (or from a
// test) must not kick off a backfill against the live ABC API.
if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { chunksForMonth, monthRange, daysInMonth };
