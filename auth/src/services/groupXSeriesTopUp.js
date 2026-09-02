// Keeps open-ended Group X series stocked with classes.
//
// Mirrors facilitySeriesTopUp, with one important difference: these
// occurrences are real writes to the ABC calendar, not rows in our own table.
// So the job is deliberately conservative — sequential creates, a cap per run,
// and every failure logged rather than retried in a loop.
//
// Without it, a class set to run "every Tuesday until further notice" would
// silently stop appearing once its written horizon ran out.
const cron = require('node-cron')
const { supabaseAdmin } = require('./supabase')
const abc = require('./abcGroupX')
const { expandSeries } = require('../lib/groupXSeries')
const { OPEN_ENDED_HORIZON_DAYS } = require('../lib/scheduleTimes')
const { padDate, toIsoDate } = require('../lib/abcTime')
const { recordSeriesEvents } = require('../lib/groupXSeriesLink')

// A single night should never fire hundreds of ABC writes. The horizon is
// topped up incrementally, so a backlog clears over a few nights rather than
// in one burst against a rate-limited API.
const MAX_CREATES_PER_RUN = 60

async function topUpOne(series, todayIso, budget) {
  const target = padDate(todayIso, OPEN_ENDED_HORIZON_DAYS)
  const from = series.materialized_through
    ? padDate(series.materialized_through, 1)
    : series.starts_on
  if (from > target) return { series_id: series.id, created: 0, failed: 0 }

  const occurrences = expandSeries({
    weekdays: series.weekdays,
    start_time: String(series.start_time).slice(0, 5),
    starts_on: from,
    ends_on: target,
  }).slice(0, budget)

  let created = 0
  let failed = 0
  let lastDate = series.materialized_through
  const results = []

  for (const occ of occurrences) {
    const r = await abc.createClass(series.club_number, {
      event_type_id: series.event_type_id,
      employee_id: series.employee_id,
      event_timestamp_local: occ.timestamp_local,
      training_level_id: series.training_level_id || null,
    })
    results.push({ date: occ.date, ok: r.ok, event_id: r.event_id, error: r.error })
    if (r.ok) {
      created++
      lastDate = occ.date
    } else {
      failed++
      console.error('[groupXTopUp] create failed', series.id, occ.date, r.error)
      // Stop at the first failure so materialized_through never runs past a
      // gap. Next run resumes from here rather than skipping the missing date.
      break
    }
  }

  // Top-ups create real occurrences of the series, so they link like any other.
  await recordSeriesEvents(series.club_number, series.id, results)

  if (lastDate && lastDate !== series.materialized_through) {
    await supabaseAdmin
      .from('group_x_series')
      .update({ materialized_through: lastDate })
      .eq('id', series.id)
  }

  return { series_id: series.id, class_name: series.class_name, created, failed }
}

async function runTopUp() {
  const today = toIsoDate(new Date())
  const { data, error } = await supabaseAdmin
    .from('group_x_series')
    .select('*')
    .is('canceled_at', null)
    .is('ends_on', null)          // open-ended only
    .limit(200)
  if (error) throw new Error(error.message)

  let budget = MAX_CREATES_PER_RUN
  const results = []
  for (const s of data || []) {
    if (budget <= 0) break
    try {
      const r = await topUpOne(s, today, budget)
      budget -= r.created
      results.push(r)
    } catch (err) {
      console.error('[groupXTopUp] series', s.id, 'failed:', err.message)
      results.push({ series_id: s.id, created: 0, failed: 0, error: err.message })
    }
  }
  return results
}

function start() {
  if (process.env.GROUPX_TOPUP_DISABLED === '1') {
    console.log('[groupXTopUp] disabled via GROUPX_TOPUP_DISABLED=1')
    return
  }
  // Nightly at 3:25am Pacific (10:25 UTC), after the facility top-up.
  cron.schedule('25 10 * * *', () => {
    runTopUp().then(
      rs => {
        const made = rs.reduce((n, r) => n + (r.created || 0), 0)
        if (made > 0) console.log('[groupXTopUp] extended open series:', JSON.stringify(rs))
      },
      e => console.error('[groupXTopUp] nightly run failed:', e.message),
    )
  })
  console.log('[groupXTopUp] scheduled — nightly 3:25am PT')
}

module.exports = { start, runTopUp, topUpOne, MAX_CREATES_PER_RUN }
