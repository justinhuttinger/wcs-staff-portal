// Auto cross-location lead cleanup.
//
// Runs after each delta sync. Reads the v_cross_location_deletion_candidates
// view (same one the one-off backlog script uses), then for each candidate:
//   1. snapshots the full contact into deleted_contacts_archive
//   2. calls GHL DELETE /contacts/{id} with the lead-side location's key
//   3. writes contact_deletion_log with status/response/error
//
// The view itself enforces the strict criteria (no sale tag on lead, sale
// tag on member elsewhere, ABC member record at member-side, not already
// deleted), so we don't repeat that logic here.
//
// Kill switch: set env CROSS_LOC_CLEANUP_DISABLED=1 to make this a no-op
// without redeploying. After 2026-05-18's cacheWarmer incident, every
// recurring task in this codebase needs that escape hatch.
//
// Grace period: env CROSS_LOC_CLEANUP_GRACE_HOURS (default 0). When set,
// candidates whose member-side `updated_at_ghl` is younger than the grace
// window are skipped this cycle. Useful if you want a buffer for human
// review of false positives, but the strict view criteria (sale tag +
// ABC member record) make false positives unlikely. The one-off backlog
// run had 0 false positives across 1,039 deletions.

const supabase = require('../db/supabase');
const LOCATIONS = require('../config/locations');

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const RATE_LIMIT_MS = 200;            // 5 req/sec, well under GHL limits
const PAGE_SIZE = 500;                // PostgREST max-rows defaults to 1000
const MAX_DELETES_PER_CYCLE = 200;    // hard cap so a runaway cycle can't fan out forever

const sleep = ms => new Promise(r => setTimeout(r, ms));
const locBySlug = slug => LOCATIONS.find(l => l.slug === slug) || null;

async function fetchCandidates(limit) {
  const out = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('v_cross_location_deletion_candidates')
      .select('*')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchCandidates failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (out.length >= limit) return out.slice(0, limit);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

async function fetchSnapshot(contactId) {
  const { data, error } = await supabase
    .from('ghl_contacts_v2')
    .select('*')
    .eq('id', contactId)
    .maybeSingle();
  if (error) throw new Error(`snapshot fetch failed for ${contactId}: ${error.message}`);
  return data;
}

// Grace period check uses the member-side GHL contact's updated_at_ghl as a
// proxy for "when did the sale tag fire" — usually within seconds of each
// other. If the sale-side record is younger than graceHours, skip this
// cycle. Returns true if the candidate is OK to delete.
async function passesGracePeriod(candidate, graceMs) {
  if (!graceMs) return true;
  const { data, error } = await supabase
    .from('ghl_contacts_v2')
    .select('updated_at_ghl, location_id')
    .eq('email', candidate.email)
    .order('updated_at_ghl', { ascending: false })
    .limit(10);
  if (error) return false; // fail-closed: never delete when we can't verify
  const memberRow = (data || []).find(r => r.location_id !== candidate.lead_location_id);
  if (!memberRow || !memberRow.updated_at_ghl) return false;
  const memberAge = Date.now() - new Date(memberRow.updated_at_ghl).getTime();
  return memberAge >= graceMs;
}

async function archiveContact(snapshot, leadLocationSlug) {
  // location_id intentionally null (see auth-side script for rationale).
  const { data, error } = await supabase
    .from('deleted_contacts_archive')
    .insert({
      ghl_contact_id: snapshot.id,
      location_slug: leadLocationSlug,
      email: snapshot.email,
      phone: snapshot.phone,
      first_name: snapshot.first_name,
      last_name: snapshot.last_name,
      tags: snapshot.tags,
      custom_fields: snapshot.custom_fields,
      contact_snapshot: snapshot,
      archived_by: 'ghl_sync_auto',
    })
    .select('id')
    .single();
  if (error) throw new Error(`archive insert failed for ${snapshot.id}: ${error.message}`);
  return data.id;
}

async function deleteContactInGhl(contactId, apiKey) {
  const res = await fetch(`${BASE_URL}/contacts/${contactId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: API_VERSION,
      Accept: 'application/json',
    },
  });
  const text = await res.text().catch(() => '');
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  return { status: res.status, ok: res.ok, body };
}

async function logDeletion(payload) {
  const { error } = await supabase.from('contact_deletion_log').insert(payload);
  if (error) console.error(`[crossLocCleanup] log insert failed for ${payload.ghl_contact_id}: ${error.message}`);
}

async function crossLocCleanup({ log = console } = {}) {
  if (process.env.CROSS_LOC_CLEANUP_DISABLED === '1') {
    log.log('[crossLocCleanup] disabled via CROSS_LOC_CLEANUP_DISABLED=1, skipping');
    return { skipped: 'disabled', deleted: 0, failed: 0, grace_held: 0 };
  }

  const graceHours = parseFloat(process.env.CROSS_LOC_CLEANUP_GRACE_HOURS || '0');
  const graceMs = Number.isFinite(graceHours) && graceHours > 0 ? graceHours * 3600 * 1000 : 0;

  let candidates;
  try {
    candidates = await fetchCandidates(MAX_DELETES_PER_CYCLE);
  } catch (e) {
    log.error('[crossLocCleanup] candidate fetch failed:', e.message);
    return { error: e.message, deleted: 0, failed: 0, grace_held: 0 };
  }

  if (candidates.length === 0) {
    log.log('[crossLocCleanup] no candidates this cycle');
    return { deleted: 0, failed: 0, grace_held: 0 };
  }
  log.log(`[crossLocCleanup] ${candidates.length} candidate(s) (grace=${graceHours}h, cap=${MAX_DELETES_PER_CYCLE})`);

  let deleted = 0;
  let failed = 0;
  let graceHeld = 0;
  let skipped = 0;

  for (const c of candidates) {
    const leadLoc = locBySlug(c.lead_location_slug);
    if (!leadLoc) {
      skipped++;
      log.warn(`[crossLocCleanup] skip ${c.lead_ghl_contact_id}: no API key for ${c.lead_location_slug}`);
      continue;
    }

    if (graceMs > 0) {
      const ok = await passesGracePeriod(c, graceMs);
      if (!ok) {
        graceHeld++;
        continue;
      }
    }

    let snapshot;
    try {
      snapshot = await fetchSnapshot(c.lead_ghl_contact_id);
    } catch (e) {
      failed++;
      log.error(`[crossLocCleanup] snapshot ${c.lead_ghl_contact_id}: ${e.message}`);
      continue;
    }
    if (!snapshot) {
      skipped++;
      continue;
    }

    let archiveId;
    try {
      archiveId = await archiveContact(snapshot, c.lead_location_slug);
    } catch (e) {
      failed++;
      log.error(`[crossLocCleanup] archive ${c.lead_ghl_contact_id}: ${e.message}`);
      continue;
    }

    let apiResult, apiErr;
    try {
      apiResult = await deleteContactInGhl(c.lead_ghl_contact_id, leadLoc.apiKey);
    } catch (e) {
      apiErr = e.message;
    }

    await logDeletion({
      ghl_contact_id: c.lead_ghl_contact_id,
      lead_location_slug: c.lead_location_slug,
      member_location_slug: c.member_location_slug,
      email: c.email,
      triggered_by: 'ghl_sync_auto',
      archive_id: archiveId,
      ghl_api_status: apiResult ? apiResult.status : null,
      ghl_api_response: apiResult ? apiResult.body : null,
      error_message: apiErr || null,
    });

    if (apiResult && apiResult.ok) deleted++;
    else failed++;

    await sleep(RATE_LIMIT_MS);
  }

  log.log(`[crossLocCleanup] cycle done — ${deleted} deleted, ${graceHeld} grace-held, ${skipped} skipped, ${failed} failed`);
  return { deleted, graceHeld, skipped, failed };
}

module.exports = { crossLocCleanup };
