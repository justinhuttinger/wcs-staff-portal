// Aggregation for the NPS report. The maths is pure and the loading is
// separate, so every rule below is testable without a database.

let _db = null;
function getDb() {
  if (!_db) _db = require('./supabase').supabaseAdmin;
  return _db;
}

const PAGE_SIZE = 1000;

/**
 * The standard NPS split. Not an even one: a 6 is a detractor even though it
 * reads like a pass mark, which is the part people get wrong doing it by hand.
 */
function band(score) {
  const n = Number(score);
  if (n >= 9) return 'promoter';
  if (n >= 7) return 'passive';
  return 'detractor';
}

/**
 * Percent promoters minus percent detractors.
 *
 * Passives count toward the denominator but never the numerator, which is the
 * property that makes the number mean anything: indifference is not
 * endorsement, so a room full of 7s and 8s scores 0, not 100.
 *
 * With no responses the score is null rather than 0. Zero is a real and quite
 * bad result; reporting it for a club nobody answered from would invent a
 * finding out of an absence.
 */
function npsFromScores(scores) {
  const list = (scores || []).map(Number).filter(n => Number.isFinite(n));
  const n = list.length;
  if (n === 0) return { n: 0, promoters: 0, passives: 0, detractors: 0, nps: null };

  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const s of list) {
    const b = band(s);
    if (b === 'promoter') promoters++;
    else if (b === 'passive') passives++;
    else detractors++;
  }
  return {
    n, promoters, passives, detractors,
    nps: Math.round(((promoters - detractors) / n) * 100),
  };
}

function averageOf(scores) {
  const list = (scores || []).map(Number).filter(n => Number.isFinite(n));
  if (list.length === 0) return { n: 0, average: null };
  const sum = list.reduce((a, b) => a + b, 0);
  return { n: list.length, average: Math.round((sum / list.length) * 10) / 10 };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Roll score rows up by club and by metric.
 *
 * Invited and walk-up are kept apart by default and only combined when asked
 * for. Walk-up is self-selected and skews to the extremes (the member who just
 * had a great session, or the one who just found a rack broken); invited is a
 * roughly random cohort sample. Blending them silently means company NPS moves
 * when a poster gets hung nearer the door, and someone spends a month chasing a
 * trend that is an artifact of poster placement.
 *
 * Clubs and metrics with no responses are omitted entirely rather than shown as
 * an empty row, per the house convention.
 */
function aggregate({ scoreRows = [], combineSources = false } = {}) {
  // A single leaked test row moves a club's number, so this filter is the
  // first thing that happens and nothing downstream re-checks it.
  const rows = scoreRows.filter(r => !r.is_test);

  const clubs = new Map();
  const metrics = new Map();
  const overall = { invited: [], walkup: [] };

  for (const r of rows) {
    const source = r.source === 'walkup' ? 'walkup' : 'invited';

    if (r.metric_key === 'nps') {
      if (!clubs.has(r.club_number)) clubs.set(r.club_number, { invited: [], walkup: [] });
      clubs.get(r.club_number)[source].push(r.score);
      overall[source].push(r.score);
    }

    if (!metrics.has(r.metric_key)) metrics.set(r.metric_key, { invited: [], walkup: [] });
    metrics.get(r.metric_key)[source].push(r.score);
  }

  const byClub = [...clubs.entries()].map(([club_number, s]) => {
    const entry = {
      club_number,
      invited: npsFromScores(s.invited),
      walkup: npsFromScores(s.walkup),
    };
    if (combineSources) entry.combined = npsFromScores([...s.invited, ...s.walkup]);
    return entry;
  }).sort((a, b) => a.club_number.localeCompare(b.club_number));

  const byMetric = [...metrics.entries()].map(([metric_key, s]) => {
    const entry = {
      metric_key,
      invited: averageOf(s.invited),
      walkup: averageOf(s.walkup),
    };
    if (combineSources) entry.combined = averageOf([...s.invited, ...s.walkup]);
    return entry;
  }).sort((a, b) => a.metric_key.localeCompare(b.metric_key));

  const overallOut = {
    invited: npsFromScores(overall.invited),
    walkup: npsFromScores(overall.walkup),
  };
  if (combineSources) overallOut.combined = npsFromScores([...overall.invited, ...overall.walkup]);

  return { byClub, byMetric, overall: overallOut };
}

/**
 * Sent / opened / answered per survey.
 *
 * `sent` counts invites that actually reached someone. A failed invite never
 * arrived, so counting it in the denominator would report a response-rate
 * problem when what actually happened was a delivery problem, and those get
 * fixed in completely different places.
 *
 * Dry runs and test fires are excluded outright: neither was ever sent.
 */
function responseRates({ inviteRows = [] } = {}) {
  const real = inviteRows.filter(r => !r.is_test && !r.dry_run);
  const bySurvey = new Map();

  for (const r of real) {
    if (!bySurvey.has(r.survey_id)) {
      bySurvey.set(r.survey_id, { survey_id: r.survey_id, sent: 0, opened: 0, responded: 0 });
    }
    const s = bySurvey.get(r.survey_id);
    if (['sent', 'opened', 'responded'].includes(r.status)) s.sent++;
    if (r.opened_at) s.opened++;
    if (r.responded_at) s.responded++;
  }

  return [...bySurvey.values()].map(s => ({
    ...s,
    response_rate: s.sent > 0 ? round1((s.responded / s.sent) * 100) : null,
    open_rate: s.sent > 0 ? round1((s.opened / s.sent) * 100) : null,
  }));
}

async function loadAll(db, table, select, applyFilters) {
  const rows = [];
  let from = 0;
  for (;;) {
    let q = db.from(table).select(select);
    q = applyFilters(q);
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`[NPS] failed to load ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

/**
 * Everything the report needs for one date range.
 *
 * is_test is filtered in the query as well as in aggregate(). Belt and braces
 * on purpose: the comment feed does not go through aggregate() at all, so a
 * single filter in one place would let test answers through to the one view
 * where a human reads them word for word.
 */
async function loadReport({
  db = getDb(), startDate, endDate, clubNumbers = [], surveyIds = [], combineSources = false,
}) {
  const startTs = `${startDate}T00:00:00Z`;
  const endTs = `${endDate}T23:59:59Z`;

  const scoreRows = await loadAll(
    db, 'nps_response_scores',
    'survey_id, metric_key, score, club_number, source, submitted_at, is_test',
    (q) => {
      let out = q.eq('is_test', false).gte('submitted_at', startTs).lte('submitted_at', endTs);
      if (clubNumbers.length) out = out.in('club_number', clubNumbers);
      if (surveyIds.length) out = out.in('survey_id', surveyIds);
      return out;
    },
  );

  const inviteRows = await loadAll(
    db, 'nps_invites',
    'survey_id, status, opened_at, responded_at, is_test, dry_run, created_at',
    (q) => {
      let out = q.eq('is_test', false).eq('dry_run', false)
        .gte('created_at', startTs).lte('created_at', endTs);
      if (surveyIds.length) out = out.in('survey_id', surveyIds);
      return out;
    },
  );

  const commentRows = await loadAll(
    db, 'nps_responses',
    'id, survey_id, club_number, source, nps_score, answers, contact_name, contact_email, submitted_at, is_test',
    (q) => {
      let out = q.eq('is_test', false).gte('submitted_at', startTs).lte('submitted_at', endTs);
      if (clubNumbers.length) out = out.in('club_number', clubNumbers);
      if (surveyIds.length) out = out.in('survey_id', surveyIds);
      return out;
    },
  );

  // Titles so the response-rate table names surveys instead of printing uuids.
  const { data: surveyRows } = await db.from('nps_surveys').select('id, slug, title');
  const titles = new Map((surveyRows || []).map(r => [r.id, r.title || r.slug]));

  return {
    ...aggregate({ scoreRows, combineSources }),
    responseRates: responseRates({ inviteRows })
      .map(r => ({ ...r, survey_title: titles.get(r.survey_id) || r.survey_id })),
    comments: buildComments(commentRows)
      .map(c => ({ ...c, survey_title: titles.get(c.survey_id) || c.survey_id })),
  };
}

/**
 * Free-text answers, newest first, with the score that came with them.
 *
 * The band travels with each comment because a 3 and a 9 saying "the squat
 * racks are always busy" are different problems: one is a complaint, the other
 * is a compliment about how busy the gym is.
 */
function buildComments(responseRows = []) {
  const out = [];
  for (const r of responseRows.filter(x => !x.is_test)) {
    const answers = r.answers && typeof r.answers === 'object' ? r.answers : {};
    for (const [questionId, value] of Object.entries(answers)) {
      if (typeof value !== 'string') continue;
      const text = value.trim();
      if (!text) continue;
      out.push({
        response_id: r.id,
        survey_id: r.survey_id,
        club_number: r.club_number,
        source: r.source,
        question_id: questionId,
        text,
        nps_score: r.nps_score,
        band: r.nps_score == null ? null : band(r.nps_score),
        contact_name: r.contact_name || null,
        contact_email: r.contact_email || null,
        submitted_at: r.submitted_at,
      });
    }
  }
  return out.sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
}

module.exports = {
  band, npsFromScores, aggregate, responseRates, buildComments, loadReport,
};
