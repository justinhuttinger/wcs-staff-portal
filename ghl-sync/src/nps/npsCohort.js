const { cohortFilters, targetDates, pacificToday, addDays } = require('./npsTriggers');

// Lazy so this module can be required in tests with no SUPABASE_URL set —
// db/supabase.js calls createClient() eagerly at import time.
let _defaultDb = null;
function getDefaultDb() {
  if (!_defaultDb) _defaultDb = require('../db/supabase');
  return _defaultDb;
}

const MEMBER_SELECT = [
  'member_id', 'club_number', 'email', 'first_name', 'last_name',
  'is_active', 'member_status', 'member_status_date',
  'begin_date', 'sign_date', 'since_date', 'membership_type',
].join(', ');

const PAGE_SIZE = 1000;

// Supabase caps .select() at 1000 rows by default. Every member read paginates
// or large clubs are silently truncated.
async function loadMembersFor({ db, filters, audienceFilter = {} }) {
  const rows = [];
  let from = 0;
  for (;;) {
    let q = db.from('abc_members').select(MEMBER_SELECT);
    if (filters.beginDate) q = q.eq('begin_date', filters.beginDate);
    if (filters.memberStatus) q = q.eq('member_status', filters.memberStatus);
    if (filters.memberStatusDate) q = q.eq('member_status_date', filters.memberStatusDate);
    if (filters.requireActive) q = q.eq('is_active', true);
    const clubs = audienceFilter.club_numbers;
    if (Array.isArray(clubs) && clubs.length) q = q.in('club_number', clubs);

    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`[NPS] failed to load abc_members: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

// Global suppression: any invite for this member, from ANY survey, inside the
// cooldown. Surveying someone twice in a month is how a feedback programme
// teaches members to ignore it.
async function loadCooldownMemberIds({ db, cooldownDays, now }) {
  const since = addDays(pacificToday(now), -Math.max(0, Number(cooldownDays) || 0));
  const ids = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from('nps_invites')
      .select('member_id, created_at')
      .gte('created_at', `${since}T00:00:00Z`)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`[NPS] failed to load nps_invites: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) ids.add(r.member_id);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return ids;
}

function hasEmail(member) {
  return Boolean(member.email && String(member.email).trim());
}

/**
 * Candidate invites for one survey across its send window.
 * Returns at most one candidate per member even if two window days match.
 */
async function selectCohort({ db = getDefaultDb(), survey, now = new Date() }) {
  const today = pacificToday(now);
  const dates = targetDates(today, survey.send_window_days);
  const cooldownIds = await loadCooldownMemberIds({
    db, cooldownDays: survey.resend_cooldown_days, now,
  });

  const candidates = [];
  const seen = new Set();
  const skipped = { noEmail: 0, cooldown: 0 };

  for (const targetDate of dates) {
    const filters = cohortFilters(survey, targetDate);
    const members = await loadMembersFor({
      db, filters, audienceFilter: survey.audience_filter || {},
    });
    for (const member of members) {
      if (seen.has(member.member_id)) continue;
      if (!hasEmail(member)) { seen.add(member.member_id); skipped.noEmail++; continue; }
      if (cooldownIds.has(member.member_id)) { seen.add(member.member_id); skipped.cooldown++; continue; }
      seen.add(member.member_id);
      candidates.push({ member, targetDate });
    }
  }

  return { candidates, skipped };
}

module.exports = {
  MEMBER_SELECT, loadMembersFor, loadCooldownMemberIds, selectCohort,
};
