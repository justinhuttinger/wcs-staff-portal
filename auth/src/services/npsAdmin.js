// Admin-side survey, metric and QR-key management. All db access is injectable
// so the whole module tests offline.

const crypto = require('crypto');
const { validateSchema } = require('./npsSchema');

let _db = null;
function getDb() {
  if (!_db) _db = require('./supabase').supabaseAdmin;
  return _db;
}

const TRIGGER_TYPES = ['tenure_days', 'tenure_months', 'status_change', 'walkup'];
const STATUSES = ['draft', 'active', 'paused'];

// The slug is the public address: survey.westcoaststrength.com/{slug}. It is
// read off a poster and typed by hand, so it stays short and unambiguous. This
// is why NPS surveys do not get the random suffix forms slugs carry.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

function toSlug(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Same generator as the invite token. Both are opaque credentials that live in
// public: one in an inbox, one on a wall.
function opaqueKey() {
  return crypto.randomBytes(24).toString('base64url');
}

async function activeMetricKeys(db) {
  const { data } = await db.from('nps_metrics').select('key, active').eq('active', true).order('key');
  return (data || []).map(m => m.key);
}

async function slugTaken(db, slug) {
  const { data } = await db.from('nps_surveys').select('id, slug').eq('slug', slug).maybeSingle();
  return Boolean(data);
}

/**
 * A trigger rule that does not carry the field its type needs is not a
 * half-finished survey, it is a survey that will silently select nobody. The
 * cohort job cannot tell the difference, so the check lives here.
 */
function validateTrigger({ trigger_type, trigger_value, trigger_status }) {
  if (!TRIGGER_TYPES.includes(trigger_type)) {
    return `trigger_type must be one of ${TRIGGER_TYPES.join(', ')}`;
  }
  if (trigger_type === 'tenure_days' || trigger_type === 'tenure_months') {
    if (!Number.isInteger(Number(trigger_value)) || Number(trigger_value) <= 0) {
      return `${trigger_type} needs a positive integer trigger_value`;
    }
  }
  if (trigger_type === 'status_change' && !String(trigger_status || '').trim()) {
    return 'status_change needs a trigger_status, e.g. Cancelled';
  }
  return null;
}

/**
 * A tag with no field key is the dangerous half: the job would tag the contact,
 * the workflow would fire, and the email would go out pointing at nothing.
 */
function validateGhlPair(tag, fieldKey) {
  const hasTag = Boolean(String(tag || '').trim());
  const hasField = Boolean(String(fieldKey || '').trim());
  if (hasTag && !hasField) return 'ghl_tag needs a matching ghl_field_key';
  if (hasField && !hasTag) return 'ghl_field_key needs a matching ghl_tag';
  return null;
}

async function listSurveys({ db = getDb() } = {}) {
  const { data, error } = await db.from('nps_surveys').select('*').order('created_at');
  if (error) throw new Error(`[NPS] failed to list surveys: ${error.message}`);
  return data || [];
}

async function getSurvey({ db = getDb(), id }) {
  const { data } = await db.from('nps_surveys').select('*').eq('id', id).maybeSingle();
  return data || null;
}

async function createSurvey({ db = getDb(), input = {} }) {
  const title = String(input.title || '').trim();
  if (!title) return { ok: false, status: 400, error: 'title is required' };

  const slug = String(input.slug || toSlug(title)).trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return { ok: false, status: 400, error: 'slug must be lowercase letters, numbers and hyphens, 2-40 characters' };
  }
  if (await slugTaken(db, slug)) {
    return { ok: false, status: 409, error: `the slug ${slug} is already in use` };
  }

  const triggerError = validateTrigger(input);
  if (triggerError) return { ok: false, status: 400, error: triggerError };

  const ghlError = validateGhlPair(input.ghl_tag, input.ghl_field_key);
  if (ghlError) return { ok: false, status: 400, error: ghlError };

  const schema = Array.isArray(input.schema) ? input.schema : [];
  const v = validateSchema(schema, { metricKeys: await activeMetricKeys(db) });
  if (!v.ok) return { ok: false, status: 400, error: v.error };

  const isTenure = input.trigger_type === 'tenure_days' || input.trigger_type === 'tenure_months';

  // Whole row: a partial insert would fail the NOT NULL columns.
  const row = {
    slug,
    title,
    intro: input.intro ? String(input.intro) : null,
    schema,
    status: STATUSES.includes(input.status) ? input.status : 'draft',
    trigger_type: input.trigger_type,
    trigger_value: isTenure ? Number(input.trigger_value) : null,
    trigger_status: input.trigger_type === 'status_change' ? String(input.trigger_status).trim() : null,
    audience_filter: input.audience_filter && typeof input.audience_filter === 'object' ? input.audience_filter : {},
    send_window_days: Number.isInteger(Number(input.send_window_days)) ? Number(input.send_window_days) : 3,
    resend_cooldown_days: Number.isInteger(Number(input.resend_cooldown_days)) ? Number(input.resend_cooldown_days) : 60,
    ghl_tag: input.ghl_tag ? String(input.ghl_tag).trim() : null,
    ghl_field_key: input.ghl_field_key ? String(input.ghl_field_key).trim() : null,
    expires_days: Number.isInteger(Number(input.expires_days)) ? Number(input.expires_days) : 30,
  };

  const { data, error } = await db.from('nps_surveys').insert(row).select().maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, status: 200, survey: data };
}

/**
 * Patch a survey, refusing a stale edit.
 *
 * knownUpdatedAt is the copy the caller was looking at. Two people editing the
 * question list is the case that matters: last-write-wins would silently drop
 * whichever set of questions lost the race.
 */
async function updateSurvey({ db = getDb(), id, patch = {}, knownUpdatedAt }) {
  const survey = await getSurvey({ db, id });
  if (!survey) return { ok: false, status: 404, error: 'survey not found' };
  if (!knownUpdatedAt) return { ok: false, status: 400, error: 'knownUpdatedAt is required' };
  if (String(survey.updated_at) !== String(knownUpdatedAt)) {
    return { ok: false, status: 409, error: 'this survey changed since you loaded it; reload and reapply' };
  }

  const next = { ...survey, ...patch };

  if (patch.slug !== undefined) {
    const slug = String(patch.slug).trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      return { ok: false, status: 400, error: 'slug must be lowercase letters, numbers and hyphens, 2-40 characters' };
    }
    if (slug !== survey.slug && await slugTaken(db, slug)) {
      return { ok: false, status: 409, error: `the slug ${slug} is already in use` };
    }
    patch.slug = slug;
  }

  if (patch.trigger_type !== undefined || patch.trigger_value !== undefined || patch.trigger_status !== undefined) {
    const triggerError = validateTrigger(next);
    if (triggerError) return { ok: false, status: 400, error: triggerError };
  }

  if (patch.ghl_tag !== undefined || patch.ghl_field_key !== undefined) {
    const ghlError = validateGhlPair(next.ghl_tag, next.ghl_field_key);
    if (ghlError) return { ok: false, status: 400, error: ghlError };
  }

  if (patch.schema !== undefined) {
    const v = validateSchema(patch.schema, { metricKeys: await activeMetricKeys(db) });
    if (!v.ok) return { ok: false, status: 400, error: v.error };
  }

  if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
    return { ok: false, status: 400, error: `status must be one of ${STATUSES.join(', ')}` };
  }

  const { data, error } = await db.from('nps_surveys')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, status: 200, survey: data };
}

/**
 * Delete a survey only while nothing depends on it.
 *
 * nps_responses cascades from nps_surveys, so deleting a survey that has been
 * answered would take the answers with it. Refuse instead: pause it.
 */
async function deleteSurvey({ db = getDb(), id }) {
  const survey = await getSurvey({ db, id });
  if (!survey) return { ok: false, status: 404, error: 'survey not found' };

  const { data: responses } = await db.from('nps_responses').select('id').eq('survey_id', id).limit(1);
  if (responses && responses.length) {
    return {
      ok: false,
      status: 409,
      error: 'this survey has responses; pause it instead of deleting, or the responses go with it',
    };
  }

  const { error } = await db.from('nps_surveys').delete().eq('id', id);
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, status: 200 };
}

async function listQrKeys({ db = getDb(), surveyId }) {
  const { data } = await db.from('nps_club_qr').select('*').eq('survey_id', surveyId).order('club_number');
  return data || [];
}

async function createQrKey({ db = getDb(), surveyId, clubNumber }) {
  const survey = await getSurvey({ db, id: surveyId });
  if (!survey) return { ok: false, status: 404, error: 'survey not found' };
  if (!String(clubNumber || '').trim()) return { ok: false, status: 400, error: 'clubNumber is required' };

  // One active code per gym per survey. Two live codes for the same wall make
  // rotation meaningless: retiring one leaves the other working, so a poster
  // you thought you had killed keeps collecting.
  const { data: existing } = await db.from('nps_club_qr')
    .select('id, key')
    .eq('survey_id', surveyId)
    .eq('club_number', String(clubNumber).trim())
    .eq('active', true)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: 'that gym already has a live code for this survey; rotate it instead of adding a second',
    };
  }

  const row = {
    club_number: String(clubNumber).trim(),
    key: opaqueKey(),
    survey_id: surveyId,
    active: true,
  };
  const { data, error } = await db.from('nps_club_qr').insert(row).select().maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, status: 200, qr: data };
}

/**
 * Rotate a poster key: deactivate the old one, issue a new one.
 *
 * Not an in-place key swap. The old key must stop working at the moment of
 * rotation, and the old row stays as a record of what was on the wall.
 */
async function rotateQrKey({ db = getDb(), id }) {
  const { data: existing } = await db.from('nps_club_qr').select('*').eq('id', id).maybeSingle();
  if (!existing) return { ok: false, status: 404, error: 'QR key not found' };

  await db.from('nps_club_qr')
    .update({ active: false, rotated_at: new Date().toISOString() })
    .eq('id', id);

  const row = {
    club_number: existing.club_number,
    key: opaqueKey(),
    survey_id: existing.survey_id,
    active: true,
  };
  const { data, error } = await db.from('nps_club_qr').insert(row).select().maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, status: 200, qr: data };
}

async function listMetrics({ db = getDb() } = {}) {
  const { data } = await db.from('nps_metrics').select('*').order('key');
  return data || [];
}

async function createMetric({ db = getDb(), key, label, description }) {
  const k = String(key || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(k)) {
    return { ok: false, status: 400, error: 'key must be lowercase letters, numbers and underscores' };
  }
  if (!String(label || '').trim()) return { ok: false, status: 400, error: 'label is required' };

  const { data: existing } = await db.from('nps_metrics').select('id').eq('key', k).maybeSingle();
  if (existing) return { ok: false, status: 409, error: `the metric ${k} already exists` };

  const { data, error } = await db.from('nps_metrics')
    .insert({ key: k, label: String(label).trim(), description: description || null, active: true })
    .select().maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, status: 200, metric: data };
}

/**
 * Retire a metric rather than deleting it.
 *
 * Every nps_response_scores row is keyed to it by string. Deleting the row
 * would orphan that history with nothing to join back to, and the report would
 * quietly lose a series.
 */
async function setMetricActive({ db = getDb(), id, active }) {
  const { data, error } = await db.from('nps_metrics')
    .update({ active: Boolean(active) })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, status: 200, metric: data };
}

module.exports = {
  listSurveys, getSurvey, createSurvey, updateSurvey, deleteSurvey,
  listQrKeys, createQrKey, rotateQrKey,
  listMetrics, createMetric, setMetricActive,
  toSlug, SLUG_RE, TRIGGER_TYPES, STATUSES,
};
