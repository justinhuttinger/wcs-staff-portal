// Keeps open-ended facility series stocked with occurrences.
//
// A series with no end date cannot be stored as infinite rows, so it is written
// out to a rolling horizon and extended here each night. Without this an
// open-ended lap swim would quietly stop appearing on the board ~90 days after
// it was created, which is exactly the kind of silent expiry nobody notices
// until members do.
const cron = require('node-cron')
const { supabaseAdmin } = require('./supabase')
const { expandSeries } = require('../lib/groupXSeries')
const { OPEN_ENDED_HORIZON_DAYS } = require('../lib/scheduleTimes')
const { padDate, toIsoDate } = require('../lib/abcTime')

async function topUpOne(series, todayIso) {
  const target = padDate(todayIso, OPEN_ENDED_HORIZON_DAYS)
  const from = series.materialized_through
    ? padDate(series.materialized_through, 1)
    : series.starts_on
  if (from > target) return { series_id: series.id, added: 0 }

  const occurrences = expandSeries({
    weekdays: series.weekdays,
    start_time: String(series.start_time).slice(0, 5),
    starts_on: from,
    ends_on: target,
  })

  if (occurrences.length > 0) {
    const rows = occurrences.map(o => ({
      club_number: series.club_number,
      facility: series.facility,
      title: series.title,
      staff_name: series.staff_name,
      starts_at_local: o.timestamp_local,
      duration_minutes: series.duration_minutes,
      series_id: series.id,
      created_by: 'series-top-up',
    }))
    const { error } = await supabaseAdmin.from('facility_events').insert(rows)
    if (error) throw new Error(error.message)
  }

  await supabaseAdmin
    .from('facility_series')
    .update({ materialized_through: target })
    .eq('id', series.id)

  return { series_id: series.id, title: series.title, added: occurrences.length }
}

async function runTopUp() {
  const today = toIsoDate(new Date())
  const { data, error } = await supabaseAdmin
    .from('facility_series')
    .select('*')
    .is('canceled_at', null)
    .is('ends_on', null)          // open-ended only
    .limit(500)
  if (error) throw new Error(error.message)

  const results = []
  for (const s of data || []) {
    try {
      results.push(await topUpOne(s, today))
    } catch (err) {
      // One bad series must not stop the rest.
      console.error('[facilityTopUp] series', s.id, 'failed:', err.message)
      results.push({ series_id: s.id, added: 0, error: err.message })
    }
  }
  return results
}

function start() {
  if (process.env.FACILITY_TOPUP_DISABLED === '1') {
    console.log('[facilityTopUp] disabled via FACILITY_TOPUP_DISABLED=1')
    return
  }
  // Nightly at 3:10am Pacific (10:10 UTC).
  cron.schedule('10 10 * * *', () => {
    runTopUp().then(
      rs => {
        const added = rs.reduce((n, r) => n + (r.added || 0), 0)
        if (added > 0) console.log('[facilityTopUp] extended open series:', JSON.stringify(rs))
      },
      e => console.error('[facilityTopUp] nightly run failed:', e.message),
    )
  })
  console.log('[facilityTopUp] scheduled — nightly 3:10am PT')
}

module.exports = { start, runTopUp, topUpOne }
