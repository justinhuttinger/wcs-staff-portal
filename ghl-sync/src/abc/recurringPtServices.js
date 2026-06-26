/**
 * Sync ACTIVE recurring PT agreements from ABC into abc_recurring_pt_services.
 *
 * ABC's /members/recurringservices can only be paged by a sale/lastModified
 * date range, so finding all active agreements means scanning 2020->today per
 * club over both ranges. That is too slow to run on every PT Projections report
 * load (and times out for Eugene), so this runs once daily in the background and
 * the report just reads the table.
 *
 * Per club: scan -> dedupe -> keep active + non-PIF + PT -> upsert rows ->
 * delete that club's rows not touched this run (no longer active). Each club is
 * independent so one club failing never wipes another.
 */
const axios = require('axios');
const supabase = require('../db/supabase');
const { isActivePT, toRow } = require('./recurringPtRow');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;
const PAGE_SIZE = 200;

// ABC club list (clubNumber drives the API; GHL keys are irrelevant here, so we
// do NOT use config/locations which filters on GHL credentials).
const CLUBS = [
  { slug: 'salem', clubNumber: '30935', name: 'Salem' },
  { slug: 'keizer', clubNumber: '31599', name: 'Keizer' },
  { slug: 'eugene', clubNumber: '7655', name: 'Eugene' },
  { slug: 'springfield', clubNumber: '31598', name: 'Springfield' },
  { slug: 'clackamas', clubNumber: '31600', name: 'Clackamas' },
  { slug: 'milwaukie', clubNumber: '31601', name: 'Milwaukie' },
  { slug: 'medford', clubNumber: '32073', name: 'Medford' },
];

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dateRanges() {
  const ranges = [];
  let start = new Date('2020-01-01');
  const today = new Date();
  while (start < today) {
    const end = new Date(start);
    end.setDate(end.getDate() + 179);
    if (end > today) end.setTime(today.getTime());
    ranges.push(`${fmtDate(start)},${fmtDate(end)}`);
    start.setDate(start.getDate() + 180);
  }
  return ranges;
}

async function abcGet(path, params, attempt = 0) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const url = `${ABC_BASE_URL}${path}?${qs}`;
  try {
    const res = await axios.get(url, {
      headers: { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' },
      timeout: 60000,
    });
    return res.data?.recurringServices || [];
  } catch (err) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      return abcGet(path, params, attempt + 1);
    }
    throw err;
  }
}

async function fetchActiveForClub(clubNumber) {
  const seen = new Set();
  const out = [];
  for (const paramName of ['saleTimestampRange', 'lastModifiedTimestampRange']) {
    for (const range of dateRanges()) {
      let page = 1;
      while (page <= 15) {
        const svcs = await abcGet(`/${clubNumber}/members/recurringservices`, {
          [paramName]: range, size: PAGE_SIZE, page,
        });
        for (const s of svcs) {
          if (seen.has(s.recurringServiceId)) continue;
          seen.add(s.recurringServiceId);
          if (isActivePT(s)) out.push(s);
        }
        if (svcs.length < PAGE_SIZE) break;
        page++;
      }
    }
  }
  return out;
}

async function syncClub(club, runStartIso) {
  const svcs = await fetchActiveForClub(club.clubNumber);
  const rows = svcs.map((s) => toRow(s, club));
  // Stamp synced_at on every upserted row to THIS run's start. The column's
  // DEFAULT now() only fires on INSERT, not on the ON CONFLICT UPDATE path, so
  // without this an existing row keeps its original (stale) synced_at — and the
  // delete-stale step below (synced_at < runStartIso) then wipes the entire
  // active set on every run after the first. Stamping = runStartIso means rows
  // touched this run survive (not < runStartIso) and only genuinely-stale rows
  // (no longer active, never refreshed) are deleted.
  for (const r of rows) r.synced_at = runStartIso;
  if (rows.length) {
    // Upsert in chunks to stay well under payload limits.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase
        .from('abc_recurring_pt_services')
        .upsert(chunk, { onConflict: 'club_number,recurring_service_id' });
      if (error) throw new Error(`upsert: ${error.message}`);
    }
  }
  // Delete rows for this club not refreshed this run (no longer active).
  const { error: delErr } = await supabase
    .from('abc_recurring_pt_services')
    .delete()
    .eq('club_number', club.clubNumber)
    .lt('synced_at', runStartIso);
  if (delErr) throw new Error(`delete-stale: ${delErr.message}`);
  return rows.length;
}

async function syncRecurringPtServices() {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }
  const runStartIso = new Date().toISOString();
  const results = [];
  for (const club of CLUBS) {
    try {
      const count = await syncClub(club, runStartIso);
      console.log(`[RecurringPT] ${club.name}: ${count} active PT agreements synced`);
      results.push({ club: club.name, ok: true, count });
    } catch (err) {
      console.error(`[RecurringPT] ${club.name} failed: ${err.message}`);
      results.push({ club: club.name, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = { syncRecurringPtServices, toRow, isActivePT, CLUBS };
