#!/usr/bin/env node
/**
 * Fill abc_pt_services from ABC /members/recurringservices.
 *
 * This is the member-level PT history the penetration report needs.
 * abc_recurring_pt_services holds only currently-active recurring services
 * with no dates; this keeps every service ever sold, with its saleDate and
 * inactiveDate, so "was this person a PT client in March 2025" has an answer.
 *
 * ABC TRAPS THIS WALKS AROUND
 *
 *   1. saleTimestampRange is capped at 180 DAYS. A longer range returns HTTP
 *      200 with an empty list and the reason buried in status.message — the
 *      same silent-empty behaviour as activeStatus and checkInTimestampRange.
 *   2. A service is only returned by the range it was SOLD in, so a package
 *      sold years ago and cancelled last week will not appear under a recent
 *      saleTimestampRange. The scan therefore walks sale ranges from the start
 *      date forward, and additionally sweeps lastModifiedTimestampRange to
 *      pick up old services whose status changed recently.
 *   3. Paid in Full services always come back inactive with no inactiveDate.
 *      They are stored as-is; the report treats them separately rather than
 *      pretending an end date exists.
 *
 * Usage:
 *   node scripts/sync-pt-services.js 2024-01-01
 *   node scripts/sync-pt-services.js 2024-01-01 --clubs 31599 --dry-run
 */

require('dotenv').config();
const axios = require('axios');

let _supabase = null;
function db() {
  if (!_supabase) _supabase = require('../src/db/supabase');
  return _supabase;
}

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;

const CLUBS = ['30935', '31599', '7655', '31598', '31600', '31601', '32073'];
const MAX_RANGE_DAYS = 180;   // ABC's hard cap on saleTimestampRange
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const PAUSE_MS = 350;
const MAX_ATTEMPTS = 4;
const UPSERT_BATCH = 500;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const iso = (d) => d.toISOString().slice(0, 10);

function ranges(fromISO, toISO) {
  const out = [];
  let start = new Date(fromISO + 'T00:00:00Z');
  const end = new Date(toISO + 'T00:00:00Z');
  while (start <= end) {
    const stop = new Date(start);
    stop.setUTCDate(stop.getUTCDate() + MAX_RANGE_DAYS - 1);
    if (stop > end) stop.setTime(end.getTime());
    out.push([iso(start), iso(stop)]);
    start = new Date(stop);
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return out;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v) {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

function dateOnly(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function getWithRetry(clubNumber, paramName, range, page) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await axios.get(`${ABC_BASE_URL}/${clubNumber}/members/recurringservices`, {
        params: { [paramName]: range, size: PAGE_SIZE, page },
        headers: { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' },
        timeout: 120000,
      });
      const status = res.data?.status || {};
      const list = res.data?.recurringServices || [];
      // An empty list plus a non-success message means the request was
      // refused, not that the range is genuinely quiet.
      if (list.length === 0 && status.message && !/^success$/i.test(status.message.trim())
          && !/no records found/i.test(status.message)) {
        throw new Error(`ABC rejected ${paramName}=${range}: ${status.message.trim()}`);
      }
      return res.data;
    } catch (err) {
      lastErr = err;
      const code = err.response?.status;
      const retryable = !code || code >= 500 || err.code === 'ECONNABORTED';
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

async function scan(clubNumber, paramName, from, to, into) {
  for (const [a, b] of ranges(from, to)) {
    let page = 1;
    while (page <= MAX_PAGES) {
      const data = await getWithRetry(clubNumber, paramName, `${a},${b}`, page);
      const list = data?.recurringServices || [];
      if (list.length === 0) break;
      for (const s of list) into.set(s.recurringServiceId, s);
      const next = data?.status?.nextPage;
      if (!next || next === '' || next === String(page)) break;
      const parsed = parseInt(next, 10);
      if (Number.isNaN(parsed)) break;
      page = parsed;
      await sleep(PAUSE_MS);
    }
    await sleep(PAUSE_MS);
  }
}

function toRow(s, clubNumber) {
  const d = s.recurringServiceDates || {};
  return {
    recurring_service_id: s.recurringServiceId,
    club_number: clubNumber,
    member_id: s.memberId,
    member_name: [s.memberFirstName, s.memberLastName].filter(Boolean).join(' ') || null,
    agreement_number: s.agreementNumber || null,
    service_item: s.serviceItem || null,
    recurring_type_desc: s.recurringTypeDesc || null,
    status: s.recurringServiceStatus || null,
    sub_status: s.recurringServiceSubStatus || null,
    sale_date: dateOnly(d.saleDate),
    first_billing_date: dateOnly(d.firstBillingDate),
    next_billing_date: dateOnly(d.nextBillingDate),
    inactive_date: dateOnly(d.inactiveDate),
    deactivate_reason: d.deactivateReason || null,
    invoice_total: num(s.invoiceTotal),
    unit_price: num(s.unitPrice),
    number_billed: int(s.numberBilled),
    total_periods: int(s.totalPeriods),
    frequency: s.frequency || null,
    sales_person_id: s.salesPersonId || null,
    sales_person_name: [s.salesPersonFirstName, s.salesPersonLastName].filter(Boolean).join(' ') || null,
    trainer_id: s.serviceEmployeeId || null,
    trainer_name: [s.serviceEmployeeFirstName, s.serviceEmployeeLastName].filter(Boolean).join(' ') || null,
    campaign_name: s.campaignName || null,
    purchased_club: s.purchasedClub || null,
    synced_at: new Date().toISOString(),
  };
}

async function syncClub(clubNumber, from, to, dryRun) {
  const found = new Map();
  // Sold in the window...
  await scan(clubNumber, 'saleTimestampRange', from, to, found);
  // ...plus anything touched recently, which catches old services that only
  // just went inactive and would never show up under a sale range.
  await scan(clubNumber, 'lastModifiedTimestampRange', from, to, found);

  const rows = [...found.values()]
    .filter(s => s.memberId && s.recurringServiceId)
    .map(s => toRow(s, clubNumber));

  const pif = rows.filter(r => /paid in full/i.test(r.recurring_type_desc || '')).length;
  const withEnd = rows.filter(r => r.inactive_date).length;

  if (dryRun) {
    console.log(`  ${clubNumber}: ${rows.length} services (${pif} PIF, ${withEnd} with an end date) — dry run`);
    return { club: clubNumber, services: rows.length, written: 0 };
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await db()
      .from('abc_pt_services')
      .upsert(batch, { onConflict: 'recurring_service_id' });
    if (error) throw new Error(`upsert: ${error.message}`);
    written += batch.length;
  }
  console.log(`  ${clubNumber}: ${rows.length} services (${pif} PIF, ${withEnd} with an end date), ${written} rows`);
  return { club: clubNumber, services: rows.length, written };
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
  const from = positional[0];
  const to = positional[1] || new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '')) {
    console.error('Usage: sync-pt-services.js <from YYYY-MM-DD> [to YYYY-MM-DD] [--clubs a,b] [--dry-run]');
    process.exit(1);
  }

  console.log(`${clubs.length} club(s), ${from} -> ${to}${dryRun ? ' (dry run)' : ''}`);
  const summary = [];
  for (const club of clubs) {
    try {
      summary.push(await syncClub(club, from, to, dryRun));
    } catch (err) {
      console.error(`  ${club} FAILED: ${err.message}`);
      summary.push({ club, services: 0, written: 0, error: err.message });
    }
  }
  console.table(summary);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { ranges, toRow, dateOnly };
