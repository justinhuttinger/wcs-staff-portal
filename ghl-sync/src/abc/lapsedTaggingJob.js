const crypto = require('crypto');
const { get: ghlGet, put: ghlPut, sleep: ghlSleep } = require('../ghl/client');
const LOCATIONS = require('../config/locations');
const { daysSince, selectTier, diffTags, isEligible, LAPSED_TAGS } = require('./lapsedTagging');
const { loadExcludedTypes } = require('./lapsedConfig');
const { buildContactIndex, matchContact } = require('./contactIndex');

// Lazy-load the default Supabase client so this module (and its tests) can
// be required without real SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY env vars —
// db/supabase.js calls createClient() eagerly at import time. Callers that
// inject their own `db` (e.g. tests, or a future caller with a different
// client) never touch this.
let _defaultDb = null;
function getDefaultDb() {
  if (!_defaultDb) _defaultDb = require('../db/supabase');
  return _defaultDb;
}

const MEMBER_SELECT = [
  'member_id', 'club_number', 'email', 'primary_phone', 'mobile_phone',
  'first_name', 'last_name', 'is_active', 'member_status', 'membership_type',
  'last_check_in_timestamp', 'sign_date', 'begin_date', 'since_date',
].join(', ');

/**
 * Nightly lapsed check-in tagging pass for one GHL location.
 *
 * Mirrors reconcile.js's member→contact matching (via the shared
 * contactIndex.js) but only ever writes the `lapsed-*` tags — it never
 * touches any other tag or custom field. Dependency-injectable (`db`, `put`,
 * `now`, `sleepFn`) so it can run fully offline in tests.
 */
async function runLapsedTaggingForLocation(location, options = {}) {
  const {
    dryRun = true,
    db = getDefaultDb(),
    now = new Date(),
    get: getFn = ghlGet,
    put: putFn = ghlPut,
    sleepFn = ghlSleep,
  } = options;

  const { id: locationId, name: locationName, clubNumber, apiKey } = location;
  const runId = crypto.randomUUID();

  const excludedTypes = await loadExcludedTypes(db);

  // Paginate past Supabase's 1000-row default — mirrors reconcile.js's
  // .range() loop for these same two tables (abc_members, ghl_contacts_v2)
  // so large clubs (~3k active members) aren't silently truncated.
  const PAGE_SIZE = 1000;

  const members = [];
  let mFrom = 0;
  while (true) {
    const { data: mPage, error: memberErr } = await db
      .from('abc_members')
      .select(MEMBER_SELECT)
      .eq('club_number', clubNumber)
      .eq('is_active', true)
      .eq('member_status', 'Active')
      .range(mFrom, mFrom + PAGE_SIZE - 1);
    if (memberErr) throw new Error(`[LapsedTagging] ${locationName}: failed to load abc_members: ${memberErr.message}`);
    if (!mPage || mPage.length === 0) break;
    members.push(...mPage);
    if (mPage.length < PAGE_SIZE) break;
    mFrom += PAGE_SIZE;
  }

  const contacts = [];
  let cFrom = 0;
  while (true) {
    const { data: cPage, error: contactErr } = await db
      .from('ghl_contacts_v2')
      .select('id, email, phone, first_name, last_name, tags, custom_fields')
      .eq('location_id', locationId)
      .range(cFrom, cFrom + PAGE_SIZE - 1);
    if (contactErr) throw new Error(`[LapsedTagging] ${locationName}: failed to load ghl_contacts_v2: ${contactErr.message}`);
    if (!cPage || cPage.length === 0) break;
    contacts.push(...cPage);
    if (cPage.length < PAGE_SIZE) break;
    cFrom += PAGE_SIZE;
  }

  const { data: fieldDefs, error: fieldErr } = await db
    .from('ghl_custom_field_defs')
    .select('id, field_key')
    .eq('location_id', locationId)
    .eq('field_key', 'contact.abc_member_id')
    .limit(1);
  if (fieldErr) throw new Error(`[LapsedTagging] ${locationName}: failed to load ghl_custom_field_defs: ${fieldErr.message}`);

  const contactIndex = buildContactIndex(contacts || [], fieldDefs || []);

  const summary = {
    evaluated: 0,
    matched: 0,
    tagged: 0,
    cleared: 0,
    noMatch: 0,
    byTier: Object.fromEntries(LAPSED_TAGS.map(t => [t, 0])),
  };
  const logEntries = [];

  for (const member of (members || [])) {
    summary.evaluated++;

    if (!isEligible(member, excludedTypes)) continue;

    // First non-blank of sign_date/begin_date/since_date — matches the auth
    // dashboard's resolveActivityDate, which falls through empty-string and
    // blank values (not just null/undefined) across all three fields.
    const join = [member.sign_date, member.begin_date, member.since_date]
      .find(v => v && String(v).trim()) || null;
    const days = daysSince(member.last_check_in_timestamp, join, now);
    const tier = selectTier(days);

    const match = matchContact(contactIndex, {
      member_id: member.member_id,
      email: member.email,
      primary_phone: member.primary_phone,
      mobile_phone: member.mobile_phone,
      first_name: member.first_name,
      last_name: member.last_name,
    });
    if (!match) {
      summary.noMatch++;
      continue;
    }
    summary.matched++;

    // Cheap first pass against the cached tag list — decides whether a live
    // GET (and possible write) is even worth spending rate budget on. A
    // no-op here means we skip the member entirely, no GET/PUT attempted.
    const cachedDiff = diffTags(match.contact.tags, tier);
    if (!cachedDiff.changed) continue;

    const contactName = `${match.contact.first_name || ''} ${match.contact.last_name || ''}`.trim();
    const baseLog = {
      run_id: runId, club_number: clubNumber, club_name: locationName, dry_run: dryRun,
      ghl_contact_id: match.contact.id, ghl_contact_name: contactName, ghl_contact_email: match.contact.email,
      abc_member_id: member.member_id,
    };

    if (dryRun) {
      // Dry run never GETs or PUTs — count the intended change and log it
      // against the cached diff, same as before.
      if (tier) {
        summary.tagged++;
        summary.byTier[tier] = (summary.byTier[tier] || 0) + 1;
      } else {
        summary.cleared++;
      }
      for (const tag of cachedDiff.added) {
        logEntries.push({
          ...baseLog, action: 'add_tag',
          detail: { tag, match_method: match.matchMethod, note: 'dry_run' },
          applied: false, error: null,
        });
      }
      for (const tag of cachedDiff.removed) {
        logEntries.push({
          ...baseLog, action: 'remove_tag',
          detail: { tag, match_method: match.matchMethod, note: 'dry_run' },
          applied: false, error: null,
        });
      }
      continue;
    }

    // Real run: GET the live contact so the freshest tags are the
    // read-modify-write base — avoids clobbering tags added since the last
    // sync. Only fetched here (cachedDiff already said a change looks
    // likely), never for members with no plausible change.
    const contactLogEntries = [];
    try {
      const live = await getFn(`/contacts/${match.contact.id}`, {}, apiKey);
      const freshTags = live?.contact?.tags ?? match.contact.tags;
      const diff = diffTags(freshTags, tier);
      if (!diff.changed) continue; // fresh state already matches desired — skip the write

      for (const tag of diff.added) {
        const entry = {
          ...baseLog, action: 'add_tag',
          detail: { tag, match_method: match.matchMethod },
          applied: false, error: null,
        };
        contactLogEntries.push(entry);
        logEntries.push(entry);
      }
      for (const tag of diff.removed) {
        const entry = {
          ...baseLog, action: 'remove_tag',
          detail: { tag, match_method: match.matchMethod },
          applied: false, error: null,
        };
        contactLogEntries.push(entry);
        logEntries.push(entry);
      }

      await putFn(`/contacts/${match.contact.id}`, { tags: diff.tags }, apiKey);
      for (const entry of contactLogEntries) entry.applied = true;
      // Only count as tagged/cleared once the write actually succeeds.
      if (tier) {
        summary.tagged++;
        summary.byTier[tier] = (summary.byTier[tier] || 0) + 1;
      } else {
        summary.cleared++;
      }
      await sleepFn(650);
    } catch (err) {
      const errDetail = err.response?.data?.message || err.response?.data || err.message;
      const errMsg = typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail);
      for (const entry of contactLogEntries) entry.error = errMsg;
      console.error(`[LapsedTagging] ${locationName}: failed to tag ${contactName}: ${errMsg}`);
    }
  }

  if (logEntries.length > 0) {
    const { error: logErr } = await db.from('abc_sync_run_log').insert(logEntries);
    if (logErr) console.error(`[LapsedTagging] ${locationName}: failed to write run log: ${logErr.message}`);
  }

  console.log(`[LapsedTagging] ${locationName}: ${JSON.stringify(summary)}`);
  return summary;
}

/**
 * Run the lapsed-tagging pass across every configured location.
 */
async function runLapsedTaggingAll(options = {}) {
  const { dryRun = true } = options;
  const summaries = [];
  for (const location of LOCATIONS) {
    try {
      const summary = await runLapsedTaggingForLocation(location, { dryRun });
      summaries.push({ location: location.name, ...summary });
    } catch (err) {
      console.error(`[LapsedTagging] ${location.name}: run failed: ${err.message}`);
      summaries.push({ location: location.name, error: err.message });
    }
  }
  return summaries;
}

module.exports = { runLapsedTaggingForLocation, runLapsedTaggingAll };
