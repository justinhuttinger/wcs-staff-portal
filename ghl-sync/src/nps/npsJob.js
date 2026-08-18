const { selectCohort } = require('./npsCohort');
const { buildInvite } = require('./npsInvites');
const { isJobTrigger } = require('./npsTriggers');

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
 * Insert invite rows, letting the unique index absorb anything already sent.
 * ignoreDuplicates means .select() returns ONLY the rows actually inserted,
 * which is exactly the "what is new tonight" list the caller wants.
 */
async function insertInvites({ db, rows }) {
  if (!rows.length) return [];
  const { data, error } = await db
    .from('nps_invites')
    .upsert(rows, { onConflict: 'survey_id,member_id,trigger_date', ignoreDuplicates: true })
    .select();
  if (error) throw new Error(`[NPS] failed to insert nps_invites: ${error.message}`);
  return data || [];
}

/** Filled in by Task 7. Dry runs never reach it. */
async function applyGhlForInvites() {
  return { tagged: 0, errors: [] };
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
        skipped: { noEmail: 0, cooldown: 0, duplicate: 0 },
        tagged: 0, errors: [err.message],
      });
    }
  }
  return { surveys: results };
}

module.exports = {
  loadActiveSurveys, insertInvites, applyGhlForInvites, runNpsSurvey, runNpsAll,
};
