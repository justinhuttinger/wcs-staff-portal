const { LOCATIONS: DEFAULT_LOCATIONS } = require('../config/ghlLocations');
const { ghlFetch } = require('./ghlClient');

let _db = null;
function getDb() {
  if (!_db) _db = require('./supabase').supabaseAdmin;
  return _db;
}

// Required lazily and from ghl-sync on purpose.
//
// Token generation and invite row construction MUST NOT fork: two
// implementations of a security token is how one of them ends up predictable.
// Both modules are dependency-free (npsInvites imports only node:crypto,
// npsTriggers imports nothing), so auth can load them across the service
// boundary without inheriting ghl-sync's node_modules. The require is inside
// the function so a path problem degrades to this one endpoint failing rather
// than crashing auth at boot.
function shared() {
  const { buildInvite, surveyUrl } = require('../../../ghl-sync/src/nps/npsInvites');
  const { pacificToday, addDays } = require('../../../ghl-sync/src/nps/npsTriggers');
  return { buildInvite, surveyUrl, pacificToday, addDays };
}

/**
 * Fire one chosen member through one chosen survey, for real.
 *
 * This deliberately does not call selectCohort: cohort selection is exactly
 * what is being bypassed, because the member has already been chosen. With
 * force it also bypasses the cooldown, and writes is_test so the partial
 * unique index lets it repeat and the report never sees it.
 */
async function testFire({
  db = getDb(), slug, memberId, force = true, now = new Date(),
  locations = DEFAULT_LOCATIONS, ghlFetchFn = ghlFetch, fieldIdResolver = null,
  baseUrl = process.env.NPS_SURVEY_BASE_URL || 'https://survey.westcoaststrength.com',
}) {
  const { buildInvite, surveyUrl, pacificToday, addDays } = shared();

  const { data: survey } = await db.from('nps_surveys').select('*').eq('slug', slug).maybeSingle();
  if (!survey) return { ok: false, status: 404, error: `no survey with slug ${slug}` };
  if (!survey.ghl_tag || !survey.ghl_field_key) {
    return { ok: false, status: 400, error: `survey ${slug} has no ghl_tag/ghl_field_key configured` };
  }

  const { data: member } = await db.from('abc_members').select('*').eq('member_id', memberId).maybeSingle();
  if (!member) return { ok: false, status: 404, error: `no member with id ${memberId}` };
  if (!member.email) return { ok: false, status: 400, error: `member ${memberId} has no email` };

  const today = pacificToday(now);

  if (!force) {
    const since = addDays(today, -Math.max(0, Number(survey.resend_cooldown_days) || 0));
    const { data: recent } = await db.from('nps_invites')
      .select('member_id, created_at')
      .eq('member_id', memberId)
      .gte('created_at', `${since}T00:00:00Z`)
      .limit(1);
    if (recent && recent.length) {
      return {
        ok: false,
        status: 409,
        error: `member ${memberId} is inside the ${survey.resend_cooldown_days}-day cooldown; pass force to override`,
      };
    }
  }

  // Two traps live on this one line, both from ghl-sync and auth having
  // parallel-but-different location configs:
  //   1. auth exports an OBJECT ({ LOCATIONS, ... }); ghl-sync exports the
  //      array directly. Requiring the module whole gives you something with
  //      no .find.
  //   2. auth calls the field clubCode; ghl-sync calls it clubNumber.
  const list = Array.isArray(locations) ? locations : (locations?.LOCATIONS || []);
  const location = list.find(l => l.clubCode === member.club_number);
  if (!location) {
    return { ok: false, status: 400, error: `no GHL location configured for club ${member.club_number}` };
  }

  // Resolve the contact LIVE rather than from ghl_contacts_v2.
  //
  // The mirror goes stale: a contact deleted in GHL keeps its row here, and
  // writing to that id returns "Contact not found". This member has 22 cached
  // rows on one email across locations, so picking one from the cache was
  // picking a coin flip. /contacts/search/duplicate is what reconcile.js uses
  // and it answers with whatever GHL believes right now.
  const email = String(member.email).toLowerCase().trim();
  let contact = null;
  try {
    const found = await ghlFetchFn(
      `/contacts/search/duplicate?locationId=${encodeURIComponent(location.id)}&email=${encodeURIComponent(email)}`,
      location.apiKey,
      { method: 'GET' },
    );
    contact = found?.contact || null;
  } catch (err) {
    return { ok: false, status: 502, error: `GHL lookup failed for ${member.email}: ${err.message}` };
  }
  if (!contact) {
    return { ok: false, status: 404, error: `no GHL contact for ${member.email} in ${location.name}` };
  }

  const row = buildInvite({ survey, member, targetDate: today, now, dryRun: false });
  row.is_test = true;
  row.ghl_contact_id = contact.id;

  const { data: invite, error: insErr } = await db.from('nps_invites').insert(row).select().maybeSingle();
  if (insErr) throw new Error(`[NPS] failed to insert test invite: ${insErr.message}`);

  const url = surveyUrl(baseUrl, survey.slug, row.token);
  const ghl = { tagged: 0, errors: [] };

  try {
    // Field FIRST. The workflow triggers on the tag, so tagging before the URL
    // exists sends an email with an empty link. npsJob.test.js pins the same
    // ordering on the ghl-sync side; both must fail if either flips.
    // The custom field must be addressed by ID, not by key.
    //
    // GHL answers 200 to {key, field_value} and silently discards it. Verified
    // against a live contact: the key form does not stick, the id form does.
    // A silent no-op here is the worst kind of failure, because the tag write
    // below fires the workflow and the email would carry an empty link.
    //
    // ghlFetch stringifies `body` itself, so it takes an object, not a string.
    const fieldId = await resolveFieldId(location, survey.ghl_field_key, fieldIdResolver);
    if (!fieldId) {
      throw new Error(`no GHL custom field ${survey.ghl_field_key} in ${location.name}; create it before sending`);
    }

    await ghlFetchFn(`/contacts/${contact.id}`, location.apiKey, {
      method: 'PUT',
      body: { customFields: [{ id: fieldId, value: url }] },
    });

    // Read back before tagging. Writing the field first only protects the
    // workflow if the write actually happened, and this API can accept a write
    // it never performs.
    const live = await ghlFetchFn(`/contacts/${contact.id}`, location.apiKey, { method: 'GET' });
    const stored = (live?.contact?.customFields || []).find(f => f.id === fieldId);
    if (!stored || String(stored.value || '') !== url) {
      throw new Error('GHL accepted the survey URL but did not store it; not tagging, so no email goes out with a dead link');
    }

    const existing = live?.contact?.tags ?? contact.tags ?? [];
    if (!existing.includes(survey.ghl_tag)) {
      await ghlFetchFn(`/contacts/${contact.id}`, location.apiKey, {
        method: 'PUT',
        body: { tags: [...existing, survey.ghl_tag] },
      });
    }

    await db.from('nps_invites').update({
      status: 'sent',
      sent_at: now.toISOString(),
      ghl_tag_applied_at: now.toISOString(),
      ghl_error: null,
    }).eq('id', invite.id);

    ghl.tagged = 1;
  } catch (err) {
    ghl.errors.push(err.message);
    await db.from('nps_invites')
      .update({ status: 'failed', ghl_error: err.message })
      .eq('id', invite.id);
  }

  return {
    ok: true,
    status: 200,
    invite: { id: invite.id, token: row.token, trigger_date: today, is_test: true },
    contact: { id: contact.id, email: contact.email, location: location.name },
    url,
    ghl,
  };
}

/**
 * Custom field id for a location. Injectable so tests need no Supabase, and
 * required lazily because ghlCustomFields pulls in the Supabase client at
 * import time.
 */
async function resolveFieldId(location, fieldKey, resolver = null) {
  const fn = resolver || require('./ghlCustomFields').getFieldId;
  return fn(location.id, location.apiKey, fieldKey);
}

module.exports = { testFire, resolveFieldId };
