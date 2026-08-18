// Who the nightly job touched on a given day, and what happened to each one.
//
// This is an operations log, not a report: it exists to answer "did tonight's
// run do what I expected" while the system is being rolled out. It therefore
// shows dry-run and test rows too, clearly marked, because during a rollout
// those are exactly the rows you want to look at.

let _db = null;
function getDb() {
  if (!_db) _db = require('./supabase').supabaseAdmin;
  return _db;
}

const PAGE_SIZE = 1000;

const CLUB_NAMES = {
  30935: 'Salem', 31599: 'Keizer', 7655: 'Eugene', 31598: 'Springfield',
  31600: 'Clackamas', 31601: 'Milwaukie', 32073: 'Medford',
};

/**
 * One line per invite, newest first, with the outcome spelled out.
 *
 * `outcome` collapses status + the GHL result into the thing an operator
 * actually wants to know, because "status: sent, ghl_error: null, dry_run:
 * true" takes a moment to decode and "recorded only (dry run)" does not.
 */
function describe(invite) {
  if (invite.dry_run) return 'recorded only (dry run)';
  if (invite.ghl_error) return `failed: ${invite.ghl_error}`;
  if (invite.responded_at) return 'answered';
  if (invite.opened_at) return 'opened';
  if (invite.ghl_tag_applied_at) return 'tagged in GHL';
  if (invite.status === 'pending') return 'not sent yet';
  return invite.status;
}

function toRow(invite, surveyTitles) {
  return {
    id: invite.id,
    member_id: invite.member_id,
    member_name: invite.member_name,
    member_email: invite.member_email,
    club_number: invite.club_number,
    club_name: CLUB_NAMES[invite.club_number] || invite.club_number,
    survey_id: invite.survey_id,
    survey_title: surveyTitles.get(invite.survey_id) || invite.survey_id,
    trigger_date: invite.trigger_date,
    status: invite.status,
    outcome: describe(invite),
    tagged_at: invite.ghl_tag_applied_at,
    opened_at: invite.opened_at,
    responded_at: invite.responded_at,
    error: invite.ghl_error || null,
    dry_run: Boolean(invite.dry_run),
    is_test: Boolean(invite.is_test),
    created_at: invite.created_at,
  };
}

/**
 * Invites created on one Pacific day.
 *
 * Filtered on created_at rather than trigger_date: the question is "what did
 * the job do last night", and the back-window means a single run legitimately
 * creates invites carrying several different trigger dates.
 */
async function loadSentLog({ db = getDb(), date, surveyId = null }) {
  // Pacific day boundaries. -07:00 through most of the year; the offset is
  // carried explicitly so a run at 11pm Pacific is not filed under tomorrow.
  const from = `${date}T00:00:00-07:00`;
  const to = `${date}T23:59:59-07:00`;

  const invites = [];
  let offset = 0;
  for (;;) {
    let q = db.from('nps_invites')
      .select('*')
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: false });
    if (surveyId) q = q.eq('survey_id', surveyId);

    const { data, error } = await q.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`[NPS] failed to load nps_invites: ${error.message}`);
    if (!data || data.length === 0) break;
    invites.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const { data: surveys } = await db.from('nps_surveys').select('id, title, slug');
  const titles = new Map((surveys || []).map(s => [s.id, s.title || s.slug]));

  const rows = invites.map(i => toRow(i, titles));

  return {
    date,
    rows,
    summary: {
      total: rows.length,
      tagged: rows.filter(r => r.tagged_at && !r.dry_run).length,
      dry_run: rows.filter(r => r.dry_run).length,
      failed: rows.filter(r => r.error).length,
      opened: rows.filter(r => r.opened_at).length,
      answered: rows.filter(r => r.responded_at).length,
      tests: rows.filter(r => r.is_test).length,
    },
  };
}

module.exports = { loadSentLog, describe, CLUB_NAMES };
