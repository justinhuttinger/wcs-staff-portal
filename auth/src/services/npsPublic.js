// Resolution and response writing for the public survey endpoints. All db
// access is injectable so the whole module tests offline.

const { validateSubmission } = require('./npsSchema');

// Lazy: services/supabase.js calls createClient() at import time, so a top
// level require would make every test need SUPABASE_URL.
let _db = null;
function getDb() {
  if (!_db) _db = require('./supabase').supabaseAdmin;
  return _db;
}

async function loadSurveyById(db, surveyId) {
  const { data } = await db.from('nps_surveys').select('*').eq('id', surveyId).maybeSingle();
  return data || null;
}

/**
 * Resolve an invite token for a given survey slug.
 *
 * `reason` is returned ONLY for a token that resolved but is unusable. An
 * unknown token returns reason null, so the route cannot accidentally tell a
 * prober which tokens exist.
 */
async function loadByToken({ db = getDb(), slug, token, now = new Date() }) {
  if (!token) return { ok: false, reason: null };

  const { data: invite } = await db.from('nps_invites').select('*').eq('token', token).maybeSingle();
  if (!invite) return { ok: false, reason: null };

  const survey = await loadSurveyById(db, invite.survey_id);
  if (!survey || survey.slug !== slug) return { ok: false, reason: null };

  if (invite.status === 'responded') return { ok: false, reason: 'answered' };
  if (invite.expires_at && Date.parse(invite.expires_at) < now.getTime()) {
    return { ok: false, reason: 'expired' };
  }

  // First open only. Re-stamping would destroy the open-to-response timing.
  if (!invite.opened_at) {
    await db.from('nps_invites')
      .update({ opened_at: now.toISOString(), status: 'opened' })
      .eq('id', invite.id);
  }

  const firstName = (invite.member_name || '').trim().split(/\s+/)[0] || null;
  return {
    ok: true,
    survey,
    invite,
    member: { first_name: firstName, club_number: invite.club_number },
  };
}

/** Resolve a walk-up QR key. No member identity exists on this path. */
async function loadByQr({ db = getDb(), slug, key }) {
  if (!key) return { ok: false, reason: null };

  const { data: qr } = await db.from('nps_club_qr').select('*')
    .eq('key', key).eq('active', true).maybeSingle();
  if (!qr) return { ok: false, reason: null };

  const survey = await loadSurveyById(db, qr.survey_id);
  if (!survey || survey.slug !== slug) return { ok: false, reason: null };

  return { ok: true, survey, clubNumber: qr.club_number };
}

module.exports = { loadByToken, loadByQr };
