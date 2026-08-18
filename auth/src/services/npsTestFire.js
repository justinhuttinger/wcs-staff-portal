const DEFAULT_LOCATIONS = require('../config/ghlLocations');
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

const PAGE_SIZE = 1000;

async function loadContacts(db, locationId) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db.from('ghl_contacts_v2')
      .select('id, email, phone, first_name, last_name, tags, custom_fields')
      .eq('location_id', locationId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`[NPS] failed to load ghl_contacts_v2: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
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
  locations = DEFAULT_LOCATIONS, ghlFetchFn = ghlFetch,
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

  // NOTE: auth's config calls this clubCode; ghl-sync calls the same field
  // clubNumber. Reading the wrong one yields undefined and matches nothing.
  const location = locations.find(l => l.clubCode === member.club_number);
  if (!location) {
    return { ok: false, status: 400, error: `no GHL location configured for club ${member.club_number}` };
  }

  const contacts = await loadContacts(db, location.id);
  const email = String(member.email).toLowerCase().trim();
  const contact = contacts.find(c => (c.email || '').toLowerCase().trim() === email);
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
    await ghlFetchFn(`/contacts/${contact.id}`, location.apiKey, {
      method: 'PUT',
      body: JSON.stringify({ customFields: [{ key: survey.ghl_field_key, field_value: url }] }),
    });

    const live = await ghlFetchFn(`/contacts/${contact.id}`, location.apiKey, { method: 'GET' });
    const existing = live?.contact?.tags ?? contact.tags ?? [];
    if (!existing.includes(survey.ghl_tag)) {
      await ghlFetchFn(`/contacts/${contact.id}`, location.apiKey, {
        method: 'PUT',
        body: JSON.stringify({ tags: [...existing, survey.ghl_tag] }),
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

module.exports = { testFire };
