const crypto = require('crypto');
const axios = require('axios');
const { put: ghlPut, sleep: ghlSleep } = require('../ghl/client');
const LOCATIONS = require('../config/locations');
const { transformABCMember } = require('./client');
const { memberDetailUpdates } = require('./memberDetailFields');
const { pacificDaysBack } = require('./checkinDays');

// Check-in fields for people ABC does NOT count as members (trial and tour
// prospects). The member pull is joinStatus=member only, so they never get an
// abc_members row and reconcile never writes their Last Check-In / Total
// Check-Ins. They are deliberately kept out of abc_members (every headcount
// reads it), so this job finds them the other way round:
//
//   abc_member_checkin_days   who checked in lately (the check-in report
//                             includes prospects)
//   minus abc_members         drop real members, reconcile owns those
//   -> GHL contact            by the abc_member_id the kiosk stamped
//   -> ABC GET member         the report only has counts; the exact last
//                             check-in timestamp and lifetime total live here
const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const PAGE_SIZE = 1000;
const ID_CHUNK = 100;
const CHECKIN_FIELD_KEYS = ['contact.last_checkin', 'contact.last_checkin_time', 'contact.total_checkins'];

let _defaultDb = null;
function getDefaultDb() {
  if (!_defaultDb) _defaultDb = require('../db/supabase');
  return _defaultDb;
}

function defaultAbcGet(url) {
  return axios.get(url, {
    headers: { app_id: process.env.ABC_APP_ID, app_key: process.env.ABC_APP_KEY, Accept: 'application/json' },
    timeout: 60000,
  });
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function runProspectCheckinsForLocation(location, options = {}) {
  const {
    dryRun = false,
    days = 4,
    db = getDefaultDb(),
    now = new Date(),
    abcGet = defaultAbcGet,
    put: putFn = ghlPut,
    sleepFn = ghlSleep,
  } = options;

  const { id: locationId, name: locationName, clubNumber, apiKey } = location;
  const runId = crypto.randomUUID();
  const summary = { checkedIn: 0, nonMembers: 0, matched: 0, updated: 0, unchanged: 0, errors: 0 };

  // 1. Everyone who checked in at this club in the window.
  const since = pacificDaysBack(days, now)[0];
  const ids = new Set();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('abc_member_checkin_days')
      .select('member_id')
      .eq('club_number', clubNumber)
      .gte('day', since)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`[ProspectCheckins] ${locationName}: failed to load abc_member_checkin_days: ${error.message}`);
    for (const r of data || []) ids.add(r.member_id);
    if (!data || data.length < PAGE_SIZE) break;
  }
  summary.checkedIn = ids.size;

  // 2. Drop real members.
  for (const chunk of chunks([...ids], ID_CHUNK)) {
    const { data, error } = await db.from('abc_members').select('member_id').in('member_id', chunk);
    if (error) throw new Error(`[ProspectCheckins] ${locationName}: failed to load abc_members: ${error.message}`);
    for (const r of data || []) ids.delete(r.member_id);
  }
  summary.nonMembers = ids.size;
  if (ids.size === 0) return summary;

  // 3. Their GHL contacts, by the stamped abc_member_id.
  const { data: fieldDefs, error: fieldErr } = await db
    .from('ghl_custom_field_defs')
    .select('id, field_key')
    .eq('location_id', locationId)
    .in('field_key', ['contact.abc_member_id', ...CHECKIN_FIELD_KEYS]);
  if (fieldErr) throw new Error(`[ProspectCheckins] ${locationName}: failed to load ghl_custom_field_defs: ${fieldErr.message}`);
  const fieldKeyToId = Object.fromEntries((fieldDefs || []).map(fd => [fd.field_key, fd.id]));
  const memberIdFieldId = fieldKeyToId['contact.abc_member_id'];
  delete fieldKeyToId['contact.abc_member_id'];
  if (!memberIdFieldId || Object.keys(fieldKeyToId).length === 0) return summary;

  const contacts = [];
  for (const chunk of chunks([...ids], ID_CHUNK)) {
    const { data, error } = await db
      .from('ghl_contacts_v2')
      .select('id, email, first_name, last_name, custom_fields')
      .eq('location_id', locationId)
      .in(`custom_fields->>${memberIdFieldId}`, chunk);
    if (error) throw new Error(`[ProspectCheckins] ${locationName}: failed to load ghl_contacts_v2: ${error.message}`);
    contacts.push(...(data || []));
  }
  summary.matched = contacts.length;

  // 4. Exact last check-in + lifetime total from ABC, written only when changed.
  const logEntries = [];
  for (const contact of contacts) {
    const memberId = contact.custom_fields[memberIdFieldId];
    const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
    try {
      const res = await abcGet(`${ABC_BASE_URL}/${clubNumber}/members/${memberId}`);
      const raw = (res.data && res.data.members && res.data.members[0]) || null;
      await sleepFn(300);
      if (!raw) continue;
      const updates = memberDetailUpdates(transformABCMember(raw, clubNumber), contact.custom_fields, fieldKeyToId);
      if (Object.keys(updates).length === 0) { summary.unchanged++; continue; }

      const entries = Object.entries(updates).map(([fieldId, value]) => ({
        run_id: runId, club_number: clubNumber, club_name: locationName, dry_run: dryRun,
        ghl_contact_id: contact.id, ghl_contact_name: contactName, ghl_contact_email: contact.email,
        abc_member_id: memberId, action: 'update_field',
        detail: {
          field: Object.keys(fieldKeyToId).find(k => fieldKeyToId[k] === fieldId),
          from: contact.custom_fields[fieldId] || null, to: value, match_method: 'prospect_checkin',
        },
        applied: false, error: null,
      }));
      logEntries.push(...entries);
      summary.updated++;
      if (dryRun) continue;

      try {
        await putFn(`/contacts/${contact.id}`, {
          customFields: Object.entries(updates).map(([id, value]) => ({ id, value })),
        }, apiKey);
        for (const e of entries) e.applied = true;
        await sleepFn(650);
      } catch (err) {
        summary.updated--;
        summary.errors++;
        const d = err.response?.data?.message || err.response?.data || err.message;
        const msg = typeof d === 'string' ? d : JSON.stringify(d);
        for (const e of entries) e.error = msg;
        console.error(`[ProspectCheckins] ${locationName}: failed to update ${contactName}: ${msg}`);
      }
    } catch (err) {
      summary.errors++;
      console.error(`[ProspectCheckins] ${locationName}: ABC lookup failed for ${memberId}: ${err.message}`);
    }
  }

  for (const batch of chunks(logEntries, 500)) {
    const { error } = await db.from('abc_sync_run_log').insert(batch);
    if (error) console.error(`[ProspectCheckins] ${locationName}: run log insert failed: ${error.message}`);
  }
  return summary;
}

async function runProspectCheckinsAll(options = {}) {
  const results = {};
  for (const location of LOCATIONS) {
    if (!location.clubNumber) continue;
    try {
      results[location.name] = await runProspectCheckinsForLocation(location, options);
      console.log(`[ProspectCheckins] ${location.name}${options.dryRun ? ' (dry run)' : ''}:`, JSON.stringify(results[location.name]));
    } catch (err) {
      results[location.name] = { error: err.message };
      console.error(err.message);
    }
  }
  return results;
}

module.exports = { runProspectCheckinsForLocation, runProspectCheckinsAll };
