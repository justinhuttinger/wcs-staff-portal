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

/**
 * Write one response and its score rows.
 *
 * Resolution reuses loadByToken/loadByQr so the submit path enforces exactly
 * the same expiry, already-answered and slug rules the render path does. A
 * separate check here would drift and let a dead link still post.
 */
async function submitResponse({
  db = getDb(), slug, token, key, answers, now = new Date(), ipHash = null, userAgent = null,
}) {
  const ctx = token
    ? await loadByToken({ db, slug, token, now })
    : await loadByQr({ db, slug, key });
  if (!ctx.ok) return { ok: false, status: 404, reason: ctx.reason };

  const { survey } = ctx;
  const invited = Boolean(token);
  const invite = ctx.invite || null;

  const v = validateSubmission(survey.schema || [], answers);
  if (!v.ok) return { ok: false, status: 400, errors: v.errors };

  const isTest = invited ? Boolean(invite.is_test) : false;
  const clubNumber = invited ? invite.club_number : ctx.clubNumber;
  const submittedAt = now.toISOString();
  // Denormalised for report speed, per the parent spec.
  const npsScore = v.scores.find(s => s.metric_key === 'nps')?.score ?? null;

  const { data: response, error } = await db.from('nps_responses').upsert({
    invite_id: invited ? invite.id : null,
    survey_id: survey.id,
    member_id: invited ? invite.member_id : null,
    club_number: clubNumber,
    source: invited ? 'invited' : 'walkup',
    nps_score: npsScore,
    answers: v.cleaned,
    contact_name: v.cleaned.q_contact_name || null,
    contact_email: v.cleaned.q_contact_email || null,
    ip_hash: ipHash,
    user_agent: userAgent,
    submitted_at: submittedAt,
    is_test: isTest,
  }, { onConflict: 'invite_id' }).select().maybeSingle();
  if (error) throw new Error(`[NPS] failed to write nps_responses: ${error.message}`);

  if (v.scores.length) {
    const { error: scoreErr } = await db.from('nps_response_scores').insert(
      v.scores.map(s => ({
        response_id: response.id,
        survey_id: survey.id,
        metric_key: s.metric_key,
        score: s.score,
        club_number: clubNumber,
        source: invited ? 'invited' : 'walkup',
        submitted_at: submittedAt,
        is_test: isTest,
      })),
    );
    if (scoreErr) throw new Error(`[NPS] failed to write nps_response_scores: ${scoreErr.message}`);
  }

  if (invited) {
    await db.from('nps_invites')
      .update({ status: 'responded', responded_at: submittedAt })
      .eq('id', invite.id);
  }

  return { ok: true, status: 200, responseId: response.id };
}

/**
 * Record the score a member clicked straight from the invite email.
 *
 * Written immediately rather than held in the browser so an abandoned survey
 * still yields its NPS score. Safe to call repeatedly: the response row is
 * keyed on invite_id, so a reload overwrites rather than duplicates.
 *
 * A malformed score is ignored, never thrown. It arrives from a URL that an
 * email client may have rewritten, and a bad ?s must not stop the survey from
 * rendering.
 */
async function recordPreScore({ db = getDb(), slug, token, score, now = new Date() }) {
  const n = Number(score);
  if (!Number.isInteger(n) || n < 0 || n > 10) return;

  const ctx = await loadByToken({ db, slug, token, now });
  if (!ctx.ok) return;

  const { survey, invite } = ctx;
  const npsQuestion = (survey.schema || []).find(q => q.type === 'nps');
  if (!npsQuestion) return;

  const submittedAt = now.toISOString();
  const isTest = Boolean(invite.is_test);

  const { data: response, error } = await db.from('nps_responses').upsert({
    invite_id: invite.id,
    survey_id: survey.id,
    member_id: invite.member_id,
    club_number: invite.club_number,
    source: 'invited',
    nps_score: n,
    answers: { [npsQuestion.id]: n },
    contact_name: null,
    contact_email: null,
    ip_hash: null,
    user_agent: null,
    submitted_at: submittedAt,
    is_test: isTest,
  }, { onConflict: 'invite_id' }).select().maybeSingle();
  if (error) throw new Error(`[NPS] failed to pre-record response: ${error.message}`);

  await db.from('nps_response_scores').insert({
    response_id: response.id,
    survey_id: survey.id,
    metric_key: npsQuestion.metric_key,
    score: n,
    club_number: invite.club_number,
    source: 'invited',
    submitted_at: submittedAt,
    is_test: isTest,
  });
}

module.exports = { loadByToken, loadByQr, submitResponse, recordPreScore };
