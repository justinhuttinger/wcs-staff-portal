#!/usr/bin/env node
/**
 * ABC reconciler duplicate cleanup script.
 *
 * Background: between 2026-05-17 and 2026-05-18, the ABC reconciler's
 * Supabase contact cache (ghl_contacts_v2) was eventually consistent
 * enough that the matcher fell through to the create branch for
 * contacts that already existed in GHL. ~239 duplicate contacts were
 * created across 7 clubs, each tagged 'sale'. The reconciler fix is in
 * fix/abc-reconciler-dedupe-guard; this script cleans up the existing
 * mess.
 *
 * For each contact that the reconciler created (applied=true in
 * abc_sync_run_log) since --since:
 *   1. Find the older sibling in ghl_contacts_v2 (same location, same
 *      lowercased "first last", different id, older synced/created
 *      date) — that's the surviving contact with history.
 *   2. Snapshot the duplicate into deleted_contacts_archive.
 *   3. Copy the new contact's abc_member_id custom field onto the older
 *      contact so the next reconcile cycle links cleanly (best effort
 *      — failures are logged, not fatal).
 *   4. DELETE the duplicate via GHL API.
 *   5. Record the deletion in contact_deletion_log.
 *
 * Idempotent: contacts already missing from ghl_contacts_v2 are
 * skipped, and the contact_deletion_log records prevent re-deletion.
 *
 * Usage:
 *   node scripts/abc-reconciler-dedupe.js --dry-run
 *   node scripts/abc-reconciler-dedupe.js --dry-run --since="2026-05-17 12:00:00+00"
 *   node scripts/abc-reconciler-dedupe.js --dry-run --location=milwaukie
 *   node scripts/abc-reconciler-dedupe.js --dry-run --limit=5
 *   node scripts/abc-reconciler-dedupe.js --apply
 */

require('dotenv').config();
const { supabaseAdmin } = require('../src/services/supabase');
const { getLocationBySlug, getLocationByClubCode } = require('../src/config/ghlLocations');

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const RATE_LIMIT_MS = 350;
const TRIGGERED_BY = 'abc_reconciler_dedupe';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const DRY_RUN = !args.apply;
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const LOCATION_FILTER = args.location ? String(args.location).toLowerCase() : null;
const SINCE = args.since || '2026-05-17 00:00:00+00';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


async function fetchReconcilerCreates() {
  const PAGE_SIZE = 500;
  const out = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let q = supabaseAdmin
      .from('abc_sync_run_log')
      .select('run_id, run_at, club_number, club_name, ghl_contact_id, ghl_contact_name, ghl_contact_email, abc_member_id, detail')
      .eq('action', 'create_contact')
      .eq('applied', true)
      .gte('run_at', SINCE)
      .not('ghl_contact_id', 'is', null)
      .order('run_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (LOCATION_FILTER) {
      const filterLoc = getLocationBySlug(LOCATION_FILTER);
      if (!filterLoc) throw new Error(`Unknown location slug: ${LOCATION_FILTER}`);
      q = q.eq('club_number', filterLoc.clubCode);
    }
    const { data, error } = await q;
    if (error) throw new Error(`Failed to load reconciler creates: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (LIMIT && out.length >= LIMIT) return out.slice(0, LIMIT);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

async function fetchContact(id) {
  const { data, error } = await supabaseAdmin
    .from('ghl_contacts_v2')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load contact ${id}: ${error.message}`);
  return data;
}

// Find the older sibling: same location, same lowercased name, different id.
// If multiple exist we pick the one with the oldest created_at_ghl — that's
// the one most likely to carry real history (notes, opportunities). Filter
// at the DB layer with ilike; PostgREST silently caps responses at 1000
// rows so a client-side filter would miss siblings on large locations.
async function findOlderSibling(newContact) {
  if (!newContact?.first_name && !newContact?.last_name) return null;
  const firstRaw = (newContact.first_name || '').trim();
  const lastRaw = (newContact.last_name || '').trim();
  if (!firstRaw && !lastRaw) return null;
  // ilike pattern escape — these names come from GHL so % / _ / \ are
  // extremely unlikely, but escape anyway to keep the match exact.
  const esc = (s) => s.replace(/([\\%_])/g, '\\$1');
  let q = supabaseAdmin
    .from('ghl_contacts_v2')
    .select('id, first_name, last_name, email, phone, tags, custom_fields, created_at_ghl')
    .eq('location_id', newContact.location_id)
    .neq('id', newContact.id)
    .order('created_at_ghl', { ascending: true, nullsFirst: true })
    .limit(50);
  if (firstRaw) q = q.ilike('first_name', esc(firstRaw));
  if (lastRaw) q = q.ilike('last_name', esc(lastRaw));
  const { data, error } = await q;
  if (error) throw new Error(`sibling lookup failed: ${error.message}`);
  if (!data || data.length === 0) return null;
  return data[0];
}

async function getAbcMemberIdFieldId(locationId) {
  const { data, error } = await supabaseAdmin
    .from('ghl_custom_field_defs')
    .select('id')
    .eq('location_id', locationId)
    .eq('field_key', 'contact.abc_member_id')
    .maybeSingle();
  if (error) throw new Error(`field def lookup failed: ${error.message}`);
  return data?.id || null;
}

async function archiveContact(snapshot, locationSlug) {
  const row = {
    ghl_contact_id: snapshot.id,
    location_slug: locationSlug,
    email: snapshot.email,
    phone: snapshot.phone,
    first_name: snapshot.first_name,
    last_name: snapshot.last_name,
    tags: snapshot.tags,
    custom_fields: snapshot.custom_fields,
    contact_snapshot: snapshot,
    archived_by: TRIGGERED_BY,
  };
  const { data, error } = await supabaseAdmin
    .from('deleted_contacts_archive')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`archive insert failed for ${snapshot.id}: ${error.message}`);
  return data.id;
}

async function copyAbcMemberIdToSibling(siblingId, abcMemberId, abcFieldId, apiKey) {
  if (!abcFieldId || !abcMemberId) return { skipped: true };
  const res = await fetch(`${BASE_URL}/contacts/${siblingId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      customFields: [{ id: abcFieldId, value: abcMemberId }],
    }),
  });
  return { status: res.status, ok: res.ok };
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

async function logDeletion({ ghlContactId, locationSlug, archiveId, status, body, error }) {
  const row = {
    ghl_contact_id: ghlContactId,
    lead_location_slug: locationSlug,
    member_location_slug: locationSlug,
    email: null,
    triggered_by: TRIGGERED_BY,
    archive_id: archiveId,
    ghl_api_status: status,
    ghl_api_response: body,
    error_message: error || null,
  };
  const { error: insertErr } = await supabaseAdmin.from('contact_deletion_log').insert(row);
  if (insertErr) console.error(`[log] failed to write deletion log for ${ghlContactId}: ${insertErr.message}`);
}

async function alreadyDeleted(contactId) {
  const { data, error } = await supabaseAdmin
    .from('contact_deletion_log')
    .select('id, ghl_api_status')
    .eq('ghl_contact_id', contactId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return false;
  if (!data) return false;
  return data.ghl_api_status >= 200 && data.ghl_api_status < 300;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }

  const creates = await fetchReconcilerCreates();
  console.log(`[dedupe] ${creates.length} reconciler create(s) since ${SINCE}${LOCATION_FILTER ? ` for ${LOCATION_FILTER}` : ''}${LIMIT ? ` (limit ${LIMIT})` : ''}`);
  console.log(`[dedupe] mode: ${DRY_RUN ? 'DRY RUN — no writes' : 'LIVE — duplicates will be deleted'}`);
  if (creates.length === 0) {
    console.log('[dedupe] nothing to do, exiting');
    return;
  }

  let planned = 0;
  let skippedNoSibling = 0;
  let skippedAlreadyDeleted = 0;
  let skippedMissing = 0;
  let deleted = 0;
  let failed = 0;

  const abcFieldIdCache = new Map();

  for (const row of creates) {
    const location = getLocationByClubCode(row.club_number);
    if (!location?.apiKey) {
      console.warn(`[skip] ${row.ghl_contact_id}: no API key for club ${row.club_number}`);
      skippedMissing++;
      continue;
    }
    const slug = location.slug;

    if (await alreadyDeleted(row.ghl_contact_id)) {
      skippedAlreadyDeleted++;
      continue;
    }

    const newContact = await fetchContact(row.ghl_contact_id);
    if (!newContact) {
      // Contact already gone from our mirror — likely deleted manually
      // already. Don't try to delete again.
      skippedMissing++;
      continue;
    }

    const sibling = await findOlderSibling(newContact);
    if (!sibling) {
      // No older sibling means this contact was a genuine new create — keep
      // it. (This catches false positives in the runaway create event.)
      console.log(`[keep ] ${row.ghl_contact_id} ${row.ghl_contact_name} — no older sibling at ${slug}`);
      skippedNoSibling++;
      continue;
    }

    planned++;
    const line = `${row.ghl_contact_name} (${slug}) — DELETE new=${row.ghl_contact_id} KEEP old=${sibling.id} (created ${sibling.created_at_ghl})`;

    if (DRY_RUN) {
      console.log(`[plan ] ${line}`);
      continue;
    }

    // Live path
    console.log(`[apply] ${line}`);

    let archiveId;
    try {
      archiveId = await archiveContact(newContact, slug);
    } catch (e) {
      console.error(`[error] archive ${row.ghl_contact_id}: ${e.message}`);
      failed++;
      continue;
    }

    // Best-effort: copy abc_member_id from new → old so reconciler can match
    if (row.abc_member_id) {
      if (!abcFieldIdCache.has(location.id)) {
        try {
          abcFieldIdCache.set(location.id, await getAbcMemberIdFieldId(location.id));
        } catch (e) {
          console.warn(`[warn ] field-def lookup failed for ${slug}: ${e.message}`);
          abcFieldIdCache.set(location.id, null);
        }
      }
      const abcFieldId = abcFieldIdCache.get(location.id);
      if (abcFieldId) {
        try {
          const copy = await copyAbcMemberIdToSibling(sibling.id, row.abc_member_id, abcFieldId, location.apiKey);
          if (!copy.ok && !copy.skipped) {
            console.warn(`[warn ] copy abc_member_id → ${sibling.id} returned ${copy.status}`);
          }
          await sleep(RATE_LIMIT_MS);
        } catch (e) {
          console.warn(`[warn ] copy abc_member_id → ${sibling.id} failed: ${e.message}`);
        }
      }
    }

    let apiResult;
    let apiErr;
    try {
      apiResult = await deleteContactInGhl(row.ghl_contact_id, location.apiKey);
    } catch (e) {
      apiErr = e.message;
    }

    await logDeletion({
      ghlContactId: row.ghl_contact_id,
      locationSlug: slug,
      archiveId,
      status: apiResult?.status ?? null,
      body: apiResult?.body ?? null,
      error: apiErr,
    });

    if (apiResult?.ok) {
      deleted++;
    } else {
      failed++;
      console.error(`[error] delete ${row.ghl_contact_id} returned ${apiResult?.status} ${apiErr || JSON.stringify(apiResult?.body)}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  console.log('');
  console.log('[dedupe] === summary ===');
  console.log(`[dedupe] planned:                ${planned}`);
  console.log(`[dedupe] skipped (no sibling):   ${skippedNoSibling}`);
  console.log(`[dedupe] skipped (already gone): ${skippedAlreadyDeleted + skippedMissing}`);
  if (!DRY_RUN) {
    console.log(`[dedupe] deleted:                ${deleted}`);
    console.log(`[dedupe] failed:                 ${failed}`);
  }
}

main().catch((err) => {
  console.error('[dedupe] fatal:', err);
  process.exit(1);
});
