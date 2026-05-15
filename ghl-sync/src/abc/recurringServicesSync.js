/**
 * Sync PT recurring services from ABC into the abc_recurring_services table.
 *
 * Phase 3 step 1 of the portal perf rework. This module populates the table
 * but does NOT change any consumer behavior — the /reports/* routes still
 * fetch live ABC. A follow-up PR will migrate them to read from this table
 * behind a feature flag.
 *
 * The fetch logic mirrors the consumer code in auth/src/routes/deactivatedPT.js
 * and ptNewClients.js: 180-day chunks (the largest range ABC's filter accepts),
 * paginated up to 25 pages of 200, PT-only filter applied at sync time.
 *
 * Both `saleTimestampRange` and `lastModifiedTimestampRange` are queried so we
 * capture services SOLD in the window AND services MODIFIED in the window
 * (deactivations on old contracts). Same dedup-by-id approach the consumer
 * uses.
 */
// axios and supabase are lazy-required inside the functions that use them so
// the pure helpers below (transformService, isPT, etc.) can be unit-tested
// without dragging in HTTP / DB deps.

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;
const PAGE_SIZE = 200;
const MAX_PAGES_PER_CHUNK = 25;
const UPSERT_BATCH = 500;
const DEFAULT_HISTORY_START = '2020-01-01';

// Date fields ABC uses to express "this service is no longer active". Ordered
// by preference — first non-null wins. Sale/billing/start fields are excluded
// because they describe the contract at its origin, not its end.
const TERMINATION_FIELDS = [
  'cancellationDate', 'cancellationTimestamp',
  'cancelDate', 'cancelTimestamp', 'cancelledDate',
  'terminationDate', 'terminationTimestamp', 'terminatedDate',
  'endDate', 'endTimestamp', 'enddate',
  'deactivationDate', 'deactivationTimestamp', 'deactivatedDate',
  'expirationDate', 'expirationTimestamp', 'expiresOn',
  'statusDate', 'statusTimestamp', 'statusChangedDate', 'statusChangeDate',
  'freezeDate', 'frozenDate', 'freezeStartDate',
  'lastBillingDate',
];

function isPT(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('CONSULT')) return false;
  return n.includes('PT') || n.includes('TRAIN') || n.includes('PARTNER') ||
    n.includes('SMALL GROUP') || n.includes('ONLINE') || n.includes('CHALLENGE');
}

function isPIF(svc) {
  return (svc.recurringTypeDesc || '').toLowerCase().includes('paid in full');
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dateChunks(startISO, endISO) {
  const out = [];
  const final = new Date(endISO + 'T23:59:59');
  let cur = new Date(startISO + 'T00:00:00');
  while (cur <= final) {
    const chunkEnd = new Date(cur);
    chunkEnd.setDate(chunkEnd.getDate() + 179);
    if (chunkEnd > final) chunkEnd.setTime(final.getTime());
    out.push(`${fmtDate(cur)},${fmtDate(chunkEnd)}`);
    cur = new Date(chunkEnd);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// Best-effort cancel date: walk the recognized termination fields on the
// nested recurringServiceDates blob and on the top-level row.
function detectCancelDate(svc) {
  const dates = svc.recurringServiceDates || {};
  for (const f of TERMINATION_FIELDS) {
    const v = dates[f] ?? svc[f];
    if (v) return String(v).slice(0, 10);
  }
  return null;
}

// Normalize ISO datetime / YYYY-MM-DD to YYYY-MM-DD for date columns.
function toDateString(v) {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Normalize ABC timestamp into something Postgres timestamptz will accept.
// ABC returns strings like "2026-05-15 09:11:55" — assume Pacific local time
// to match the rest of the abc_* tables' convention.
function toTimestamp(v) {
  if (!v) return null;
  return String(v);
}

function transformService(svc, clubNumber) {
  const dates = svc.recurringServiceDates || {};
  const firstName = (svc.serviceEmployeeFirstName || '').trim();
  const lastName = (svc.serviceEmployeeLastName || '').trim();
  const employeeName = `${firstName} ${lastName}`.trim() || null;

  return {
    recurring_service_id: svc.recurringServiceId,
    club_number: clubNumber,

    member_id: svc.memberId || null,
    member_first_name: svc.memberFirstName || null,
    member_last_name: svc.memberLastName || null,

    service_item: svc.serviceItem || null,
    service_plan_id: svc.recurringServicePlanId || svc.servicePlanId || null,
    service_plan_name: svc.recurringServicePlanName || null,
    recurring_type_desc: svc.recurringTypeDesc || null,
    is_pif: isPIF(svc),

    invoice_total: svc.invoiceTotal != null && svc.invoiceTotal !== ''
      ? Number(String(svc.invoiceTotal).replace(/[$,]/g, '')) || 0
      : null,
    total_periods: svc.totalPeriods != null ? parseInt(svc.totalPeriods, 10) || null : null,

    sale_date: toDateString(dates.saleDate),
    start_date: toDateString(dates.startDate),
    next_billing_date: toDateString(dates.nextBillingDate),
    cancel_date: detectCancelDate(svc),

    status: (svc.recurringServiceStatus || '').toLowerCase() || null,

    service_employee_id: svc.serviceEmployeeId || null,
    service_employee_name: employeeName,

    last_modified_timestamp: toTimestamp(svc.lastModifiedTimestamp),

    last_synced_at: new Date().toISOString(),
    raw: svc,
  };
}

async function abcGet(clubNumber, params) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }
  const axios = require('axios');
  // Build query manually so commas in date ranges aren't URL-encoded — ABC's
  // gateway treats encoded commas differently.
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const url = `${ABC_BASE_URL}/${clubNumber}/members/recurringservices?${qs}`;
  const res = await axios.get(url, {
    headers: { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' },
    timeout: 60000,
  });
  return res.data?.recurringServices || [];
}

async function fetchAllPTRecurringServices(clubNumber, paramName, startISO, endISO) {
  const seen = new Set();
  const all = [];
  for (const range of dateChunks(startISO, endISO)) {
    let page = 1;
    while (page <= MAX_PAGES_PER_CHUNK) {
      const svcs = await abcGet(clubNumber, { [paramName]: range, size: PAGE_SIZE, page });
      for (const s of svcs) {
        const id = s.recurringServiceId;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        if (!isPT(s.serviceItem)) continue;
        all.push(s);
      }
      if (svcs.length < PAGE_SIZE) break;
      page++;
    }
  }
  return all;
}

async function upsertBatch(rows) {
  if (rows.length === 0) return 0;
  const supabase = require('../db/supabase');
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase
      .from('abc_recurring_services')
      .upsert(batch, { onConflict: 'club_number,recurring_service_id' });
    if (error) throw new Error(`abc_recurring_services upsert failed: ${error.message}`);
    upserted += batch.length;
  }
  return upserted;
}

/**
 * Sync PT recurring services for a single club. INTERNAL — does NOT take the
 * running lock. Call syncRecurringServicesForClub for the public, locked entry.
 *
 * @param {string} clubNumber
 * @param {object} [opts]
 * @param {string} [opts.startDate]  YYYY-MM-DD lower bound (default 2020-01-01)
 * @param {string} [opts.endDate]    YYYY-MM-DD upper bound (default today)
 * @param {number} [opts.sinceDays]  shorthand: only look at the last N days
 *                                   (overrides startDate/endDate)
 */
async function _syncForClubInternal(clubNumber, opts = {}) {
  const today = new Date();
  let startISO;
  let endISO;
  if (opts.sinceDays) {
    const since = new Date(today);
    since.setDate(since.getDate() - opts.sinceDays);
    startISO = fmtDate(since);
    endISO = fmtDate(today);
  } else {
    startISO = opts.startDate || DEFAULT_HISTORY_START;
    endISO = opts.endDate || fmtDate(today);
  }

  console.log(`[RS Sync] club ${clubNumber}: pulling ${startISO} → ${endISO}`);

  // Hit both ranges so we capture services SOLD in window AND services MODIFIED
  // in window (cancellations on old contracts wouldn't show up under saleRange).
  const [saleRows, modRows] = await Promise.all([
    fetchAllPTRecurringServices(clubNumber, 'saleTimestampRange', startISO, endISO),
    fetchAllPTRecurringServices(clubNumber, 'lastModifiedTimestampRange', startISO, endISO),
  ]);

  const seen = new Set();
  const merged = [];
  for (const s of [...saleRows, ...modRows]) {
    const id = s.recurringServiceId;
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(transformService(s, clubNumber));
  }

  const upserted = await upsertBatch(merged);
  console.log(`[RS Sync] club ${clubNumber}: ${merged.length} unique PT services, ${upserted} upserted`);
  return { club_number: clubNumber, fetched: merged.length, upserted };
}

// Module-level running flag — shared between the HTTP trigger (in index.js)
// and the scheduler so concurrent triggers can't double-run. Both entry
// points should consult isRsSyncRunning() before invoking sync*.
let rsSyncRunning = false;
function isRsSyncRunning() { return rsSyncRunning; }

async function syncRecurringServices(locations, opts = {}) {
  if (rsSyncRunning) {
    console.log('[RS Sync] Already running — skipping this cycle');
    return null;
  }
  rsSyncRunning = true;
  try {
    const results = [];
    for (const loc of locations) {
      if (!loc.clubNumber) continue;
      try {
        const r = await _syncForClubInternal(loc.clubNumber, opts);
        results.push({ ...r, club_name: loc.name });
      } catch (err) {
        console.error(`[RS Sync] club ${loc.clubNumber} (${loc.name}) failed:`, err.message);
        results.push({ club_number: loc.clubNumber, club_name: loc.name, error: err.message });
      }
    }
    return results;
  } finally {
    rsSyncRunning = false;
  }
}

// Public wrapper: takes the running lock around the single-club sync. Used
// by the per-location HTTP endpoint. The locations-walking version above
// calls _syncForClubInternal directly so it can hold the lock for the whole
// multi-club pass.
async function syncRecurringServicesForClub(clubNumber, opts = {}) {
  if (rsSyncRunning) {
    console.log('[RS Sync] Already running — skipping this cycle');
    return null;
  }
  rsSyncRunning = true;
  try {
    return await _syncForClubInternal(clubNumber, opts);
  } finally {
    rsSyncRunning = false;
  }
}

module.exports = {
  syncRecurringServices,
  syncRecurringServicesForClub,
  isRsSyncRunning,
  // Exported for testing
  transformService,
  detectCancelDate,
  isPT,
  isPIF,
  dateChunks,
  toDateString,
};
