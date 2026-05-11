/**
 * Attribution Enrichment
 *
 * The bulk sync uses GET /contacts/ which does NOT return attributionSource.
 * This module runs alongside the main sync using POST /contacts/search,
 * which DOES return both attributionSource and lastAttributionSource. It
 * only updates the two JSONB columns — does not touch any other fields —
 * so it's safe to run independently of the main contact upsert.
 *
 * Search endpoint paginates via { searchAfter: [ts, id] } returned in
 * `meta.searchAfter`. Page size matches the contacts sync (100).
 */

const axios = require('axios');
const supabase = require('../db/supabase');
const LOCATIONS = require('../config/locations');
const { sleep } = require('../ghl/client');

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
const PAGE_LIMIT = parseInt(process.env.CONTACTS_PAGE_SIZE) || 100;
const UPDATE_BATCH = 200;

async function searchPage(locationId, apiKey, searchAfter) {
  const body = {
    locationId,
    pageLimit: PAGE_LIMIT,
    sort: [{ field: 'dateAdded', direction: 'desc' }],
  };
  if (searchAfter) body.searchAfter = searchAfter;

  const res = await axios.post(`${BASE_URL}/contacts/search`, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
  return res.data;
}

function extractAttribution(rawContact) {
  // POST /contacts/search returns attributionSource as a flat object or null.
  // Treat empty objects / null URLs as null so we don't churn the DB row.
  const a = rawContact.attributionSource;
  const l = rawContact.lastAttributionSource;
  return {
    id: rawContact.id,
    attribution_source: a && Object.keys(a).length ? a : null,
    last_attribution_source: l && Object.keys(l).length ? l : null,
  };
}

async function flushUpdates(rows) {
  if (rows.length === 0) return 0;
  // Use upsert with onConflict on id — the row must already exist from the
  // main contacts sync; if for some reason it doesn't, we'd skip rather
  // than create a half-populated row, so use update() in a loop. To keep
  // it fast, batch by chunks and rely on PG's update by id list.
  // Supabase JS client doesn't have a true bulk-update, so we use upsert
  // with onConflict=id; rows that don't exist would get inserted with
  // mostly NULL fields, which we DON'T want. Therefore: do per-id update.
  // For 73k rows this is slow, so we chunk in parallel.
  let updated = 0;
  for (const row of rows) {
    const { error, count } = await supabase
      .from('ghl_contacts_v2')
      .update({
        attribution_source: row.attribution_source,
        last_attribution_source: row.last_attribution_source,
      }, { count: 'exact' })
      .eq('id', row.id);
    if (!error) updated += count || 0;
  }
  return updated;
}

async function enrichLocation(location, { maxPages = 2000 } = {}) {
  console.log(`[Attribution] Enriching ${location.name} (${location.id})`);
  const start = Date.now();
  let searchAfter = null;
  let totalScanned = 0;
  let totalWithAttr = 0;
  let totalUpdated = 0;

  for (let page = 1; page <= maxPages; page++) {
    let data;
    try {
      data = await searchPage(location.id, location.apiKey, searchAfter);
    } catch (err) {
      console.error(`[Attribution] ${location.name} page ${page} failed:`, err.response?.status, err.response?.data || err.message);
      break;
    }

    const contacts = data.contacts || [];
    if (contacts.length === 0) break;

    const rows = contacts.map(extractAttribution).filter(r => r.attribution_source || r.last_attribution_source);
    totalScanned += contacts.length;
    totalWithAttr += rows.length;

    const updated = await flushUpdates(rows);
    totalUpdated += updated;

    if (page % 10 === 0 || contacts.length < PAGE_LIMIT) {
      console.log(`[Attribution] ${location.name} page ${page}: scanned ${totalScanned}, with-attr ${totalWithAttr}, updated ${totalUpdated}`);
    }

    if (contacts.length < PAGE_LIMIT) break;

    const last = contacts[contacts.length - 1];
    // GHL search returns searchAfter on each contact (per-row cursor) and on meta
    searchAfter = last.searchAfter || (data.meta && data.meta.searchAfter);
    if (!searchAfter) break;

    await sleep(300);
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Attribution] ${location.name} done in ${duration}s: scanned ${totalScanned}, with-attr ${totalWithAttr}, updated ${totalUpdated}`);
  return { scanned: totalScanned, withAttr: totalWithAttr, updated: totalUpdated };
}

async function enrichAll() {
  console.log(`[Attribution] Enriching ${LOCATIONS.length} locations`);
  const start = Date.now();
  const results = {};
  for (const location of LOCATIONS) {
    try {
      results[location.slug] = await enrichLocation(location);
    } catch (err) {
      console.error(`[Attribution] ${location.name} failed:`, err.message);
      results[location.slug] = { error: err.message };
    }
  }
  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Attribution] All locations done in ${duration}s`);
  return results;
}

async function enrichForLocation(slug) {
  const location = LOCATIONS.find(l => l.slug === slug);
  if (!location) throw new Error(`Location not found: ${slug}`);
  return enrichLocation(location);
}

module.exports = { enrichAll, enrichForLocation, enrichLocation };
