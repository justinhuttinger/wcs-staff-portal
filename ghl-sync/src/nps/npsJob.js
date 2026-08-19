const { selectCohort } = require('./npsCohort');
const { buildInvite } = require('./npsInvites');
const { isJobTrigger } = require('./npsTriggers');
const { buildContactIndex, matchContact } = require('../abc/contactIndex');
const { get: ghlGet, put: ghlPut, sleep: ghlSleep } = require('../ghl/client');
const DEFAULT_LOCATIONS = require('../config/locations');
const { surveyUrl } = require('./npsInvites');

// Lazy so this module can be required in tests with no SUPABASE_URL set —
// db/supabase.js calls createClient() eagerly at import time.
let _defaultDb = null;
function getDefaultDb() {
  if (!_defaultDb) _defaultDb = require('../db/supabase');
  return _defaultDb;
}

const PAGE_SIZE = 1000;

async function loadActiveSurveys({ db }) {
  const { data, error } = await db
    .from('nps_surveys')
    .select('*')
    .eq('status', 'active')
    .range(0, PAGE_SIZE - 1);
  if (error) throw new Error(`[NPS] failed to load nps_surveys: ${error.message}`);
  return (data || []).filter(s => isJobTrigger(s.trigger_type));
}

/**
 * Insert tonight's invites, skipping anyone who already has one.
 *
 * This cannot use ON CONFLICT. Migration 109 made the idempotency index
 * PARTIAL (`where not is_test`) so manual test fires can repeat, and Postgres
 * will not match a partial unique index to an ON CONFLICT target unless the
 * same predicate is restated — which PostgREST has no way to express. The
 * upsert therefore failed outright with "no unique or exclusion constraint
 * matching the ON CONFLICT specification" and every survey aborted.
 *
 * So the duplicate check is explicit: read the keys that already exist, drop
 * them, insert the rest. The index still stands as the last line of defence
 * against a race, and a 23505 from it is treated as "somebody else got there
 * first" rather than an error.
 */
async function insertInvites({ db, rows }) {
  if (!rows.length) return [];

  const keyOf = r => `${r.survey_id}|${r.member_id}|${r.trigger_date}`;

  const { data: existing, error: readErr } = await db
    .from('nps_invites')
    .select('survey_id, member_id, trigger_date')
    .in('survey_id', [...new Set(rows.map(r => r.survey_id))])
    .in('member_id', [...new Set(rows.map(r => r.member_id))])
    .in('trigger_date', [...new Set(rows.map(r => r.trigger_date))]);
  if (readErr) throw new Error(`[NPS] failed to read nps_invites: ${readErr.message}`);

  const taken = new Set((existing || []).map(keyOf));
  const fresh = rows.filter(r => !taken.has(keyOf(r)));
  if (!fresh.length) return [];

  const { data, error } = await db.from('nps_invites').insert(fresh).select();
  if (error) {
    // 23505 is the partial unique index doing its job under a race. Nothing
    // was double-sent, so treat it as nothing new rather than a failure.
    if (error.code === '23505') return [];
    throw new Error(`[NPS] failed to insert nps_invites: ${error.message}`);
  }
  return data || [];
}

/**
 * Write the survey URL to each invited member's GHL contact, then add the tag
 * that fires the sending workflow.
 *
 * Member->contact matching reuses ../abc/contactIndex, the same matcher the
 * lapsed-tagging job and reconcile.js use. Do not reinvent it: it handles the
 * ABC member-id custom field, email, phone and name fallbacks in a defined
 * precedence order.
 */
async function applyGhlForInvites(survey, invites, options = {}) {
  const {
    db = getDefaultDb(),
    now = new Date(),
    locations = DEFAULT_LOCATIONS,
    get: getFn = ghlGet,
    put: putFn = ghlPut,
    sleepFn = ghlSleep,
    baseUrl = process.env.NPS_SURVEY_BASE_URL || 'https://survey.westcoaststrength.com',
  } = options;

  const result = { tagged: 0, errors: [] };
  if (!survey.ghl_tag || !survey.ghl_field_key) {
    result.errors.push(`survey ${survey.slug} has no ghl_tag/ghl_field_key configured`);
    return result;
  }

  // Group the night's invites by club so each location's contacts load once.
  const byClub = new Map();
  for (const inv of invites) {
    if (!byClub.has(inv.club_number)) byClub.set(inv.club_number, []);
    byClub.get(inv.club_number).push(inv);
  }

  for (const [clubNumber, clubInvites] of byClub) {
    const location = locations.find(l => l.clubNumber === clubNumber);
    if (!location) {
      result.errors.push(`no GHL location configured for club ${clubNumber}`);
      continue;
    }

    const contacts = [];
    let from = 0;
    for (;;) {
      const { data, error } = await db
        .from('ghl_contacts_v2')
        .select('id, email, phone, first_name, last_name, tags, custom_fields')
        .eq('location_id', location.id)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`[NPS] failed to load ghl_contacts_v2: ${error.message}`);
      if (!data || data.length === 0) break;
      contacts.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    const { data: fieldDefs } = await db
      .from('ghl_custom_field_defs')
      .select('id, field_key')
      .eq('location_id', location.id)
      .eq('field_key', 'contact.abc_member_id')
      .limit(1);

    const index = buildContactIndex(contacts, fieldDefs || []);

    // One lookup per location per run, not per member.
    const fieldId = await resolveSurveyFieldId(db, location, survey.ghl_field_key);
    if (!fieldId) {
      result.errors.push(`no GHL custom field ${survey.ghl_field_key} in ${location.name}`);
    }

    for (const inv of clubInvites) {
      const match = matchContact(index, {
        member_id: inv.member_id,
        email: inv.member_email,
        primary_phone: null,
        mobile_phone: null,
        first_name: (inv.member_name || '').split(' ')[0] || null,
        last_name: (inv.member_name || '').split(' ').slice(1).join(' ') || null,
      });
      if (!match) {
        result.errors.push(`no GHL contact for member ${inv.member_id}`);
        await db.from('nps_invites')
          .update({ status: 'failed', ghl_error: 'no_ghl_contact' })
          .eq('id', inv.id);
        continue;
      }

      const url = surveyUrl(baseUrl, survey.slug, inv.token);
      try {
        // Field FIRST, and addressed by ID.
        //
        // GHL answers 200 to { key, field_value } and silently discards it;
        // only { id, value } persists. Getting this wrong is the single worst
        // failure this job has, because the tag below fires the workflow: the
        // member would receive a real email containing an empty link.
        if (!fieldId) {
          throw new Error(`no GHL custom field ${survey.ghl_field_key} in ${location.name}`);
        }
        await putFn(`/contacts/${match.contact.id}`, {
          customFields: [{ id: fieldId, value: url }],
        }, location.apiKey);

        // Re-read for two reasons: to confirm the URL actually stored, and so
        // the tag write is a read-modify-write against live tags rather than
        // clobbering tags added since the last sync.
        const live = await getFn(`/contacts/${match.contact.id}`, {}, location.apiKey);
        const stored = (live?.contact?.customFields || []).find(f => f.id === fieldId);
        if (!stored || String(stored.value || '') !== url) {
          throw new Error('GHL did not store the survey URL; not tagging, so no email goes out with a dead link');
        }

        const existing = live?.contact?.tags ?? match.contact.tags ?? [];
        if (!existing.includes(survey.ghl_tag)) {
          await putFn(`/contacts/${match.contact.id}`, {
            tags: [...existing, survey.ghl_tag],
          }, location.apiKey);
        }

        await db.from('nps_invites').update({
          status: 'sent',
          ghl_contact_id: match.contact.id,
          sent_at: now.toISOString(),
          ghl_tag_applied_at: now.toISOString(),
          ghl_error: null,
        }).eq('id', inv.id);

        result.tagged++;
        await sleepFn(200);
      } catch (err) {
        // One member's failure must never abort the night.
        result.errors.push(`member ${inv.member_id}: ${err.message}`);
        await db.from('nps_invites')
          .update({ status: 'failed', ghl_error: err.message })
          .eq('id', inv.id);
      }
    }
  }

  return result;
}

async function runNpsSurvey(survey, options = {}) {
  const {
    db = getDefaultDb(),
    dryRun = true,
    now = new Date(),
  } = options;

  const { candidates, skipped } = await selectCohort({ db, survey, now });

  const rows = candidates.map(({ member, targetDate }) =>
    buildInvite({ survey, member, targetDate, now, dryRun }));

  const created = await insertInvites({ db, rows });

  const summary = {
    slug: survey.slug,
    evaluated: candidates.length,
    created: created.length,
    skipped: { ...skipped, duplicate: rows.length - created.length },
    tagged: 0,
    errors: [],
  };

  if (!dryRun && created.length) {
    const ghl = await applyGhlForInvites(survey, created, { ...options, db, now });
    summary.tagged = ghl.tagged;
    summary.errors = ghl.errors;
  }

  return summary;
}

async function runNpsAll(options = {}) {
  const { db = getDefaultDb() } = options;
  const surveys = await loadActiveSurveys({ db });
  const results = [];
  for (const survey of surveys) {
    try {
      results.push(await runNpsSurvey(survey, { ...options, db }));
    } catch (err) {
      // One broken survey must never stop the others.
      console.error(`[NPS] survey ${survey.slug} failed:`, err.message);
      results.push({
        slug: survey.slug, evaluated: 0, created: 0,
        skipped: { noEmail: 0, cooldown: 0, notMember: 0, duplicate: 0 },
        tagged: 0, errors: [err.message],
      });
    }
  }
  return { surveys: results };
}

/**
 * The GHL custom field id for a survey's field key in one location.
 *
 * Reads the cached defs first, falls back to asking GHL, since a field created
 * after the last sync would otherwise look missing and stall the whole club.
 */
async function resolveSurveyFieldId(db, location, fieldKey) {
  if (!fieldKey) return null;

  const { data: cached } = await db.from('ghl_custom_field_defs')
    .select('id, field_key')
    .eq('location_id', location.id)
    .eq('field_key', fieldKey)
    .limit(1);
  if (cached && cached.length) return cached[0].id;

  const { fetchCustomFields } = require('../ghl/customFields');
  const fresh = await fetchCustomFields(location.id, location.apiKey);
  return fresh.find(f => f.field_key === fieldKey)?.id || null;
}

module.exports = {
  loadActiveSurveys, insertInvites, applyGhlForInvites, runNpsSurvey, runNpsAll,
  resolveSurveyFieldId,
};
