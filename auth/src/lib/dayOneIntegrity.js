// Presentation for the Day One integrity checks.
//
// The COUNTING lives in the day_one_integrity() SQL function (migration 121) so
// the service needs no dynamic SQL. What lives here is what a count MEANS: a
// human label, and the likeliest cause, so an alert points at a suspect instead
// of just a number.
//
// Every entry exists because that failure actually happened. The cause text is
// the diagnosis from the day it did.

const CHECK_META = {
  orphan_rows: {
    label: 'Booking rows with no GHL appointment id',
    why: 'GHL appointment merge fields stopped resolving, or orphan adoption is failing.',
  },
  phantom_calendars: {
    label: 'Rows from a calendar that is not a Day One calendar',
    why: 'A GHL workflow trigger is no longer scoped to the Day One calendar.',
  },
  recorded_without_outcome: {
    label: 'Marked as recorded but still scheduled with no outcome',
    why: 'Something set the recorded timestamp without recording a result. These are invisible to the trainer form.',
  },
  sale_without_attendance: {
    label: 'Sale result on a Day One that was not attended',
    why: 'A status write is overriding a recorded outcome.',
  },
  backfill_duplicates_live: {
    label: 'Backfilled row duplicating a live appointment',
    why: 'The backfill was re-run without its all-sources duplicate guard.',
  },
  duplicate_appointment_id: {
    label: 'Same GHL appointment stored twice',
    why: 'The unique index on ghl_appointment_id is missing or was dropped.',
  },
  missing_scheduled_date: {
    label: 'Row with no scheduled date',
    why: 'A writer bypassed the date fallback. These drop out of every report.',
  },
  repeated_reconciler_events: {
    label: 'Appointments logging the same change over and over',
    why: 'The history diff is running against GHL state instead of the row being written.',
  },
}

// Counted and reported, but never a failure: the data is correct, a human did
// not fill the form in.
const COVERAGE_KEY = 'passed_no_outcome_14d'

// Turn the function's rows into something worth reading.
// Returns null when nothing failed, because a check that says "all fine" every
// week is one people stop reading, and then it is silent at the moment it counts.
function formatReport(rows) {
  const byKey = {}
  for (const r of (rows || [])) byKey[r.key] = Number(r.count) || 0

  const failed = Object.keys(CHECK_META)
    .filter(k => byKey[k] > 0)
    .map(k => ({ key: k, count: byKey[k], ...CHECK_META[k] }))

  if (!failed.length) return null

  const lines = ['*Day One data integrity*', '']
  for (const f of failed) {
    lines.push(`• *${f.label}*: ${f.count}`)
    lines.push(`   likely cause: ${f.why}`)
  }

  const coverage = byKey[COVERAGE_KEY]
  if (coverage > 0) {
    lines.push('')
    lines.push(`Separately, ${coverage} Day One${coverage === 1 ? '' : 's'} in the last 14 days passed with no outcome recorded. That is a data-entry gap, not a fault.`)
  }
  return lines.join('\n')
}

// The failures alone, for callers that want the data rather than the message.
function failures(rows) {
  const out = []
  for (const r of (rows || [])) {
    const meta = CHECK_META[r.key]
    if (meta && Number(r.count) > 0) out.push({ key: r.key, count: Number(r.count), ...meta })
  }
  return out
}

module.exports = { CHECK_META, COVERAGE_KEY, formatReport, failures }
