const crypto = require('crypto');

// 24 random bytes -> 32 base64url chars. The token is the ONLY credential
// protecting a member's survey, so it must not be guessable or sequential.
function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function tenureDays(beginDate, targetDate) {
  if (!beginDate) return null;
  const ms = Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${beginDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86400000);
}

// A complete nps_invites row. Whole rows only — a partial upsert would fail the
// NOT NULL columns.
function buildInvite({ survey, member, targetDate, now = new Date(), dryRun = true }) {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
  const expiresAt = new Date(
    Date.parse(now.toISOString()) + (Number(survey.expires_days) || 30) * 86400000,
  ).toISOString();

  return {
    survey_id: survey.id,
    token: generateToken(),
    member_id: member.member_id,
    club_number: member.club_number,
    ghl_contact_id: null,
    // Snapshots. The member may cancel, change email, or change name before
    // they get round to answering.
    member_email: member.email,
    member_name: name || null,
    tenure_days: tenureDays(member.begin_date, targetDate),
    trigger_date: targetDate,
    status: 'pending',
    sent_at: null,
    ghl_tag_applied_at: null,
    ghl_error: null,
    opened_at: null,
    responded_at: null,
    expires_at: expiresAt,
    dry_run: dryRun,
  };
}

function surveyUrl(baseUrl, slug, token) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${slug}?t=${token}`;
}

module.exports = { generateToken, tenureDays, buildInvite, surveyUrl };
