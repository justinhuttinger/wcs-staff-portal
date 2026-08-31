// Weekly Day One data integrity check.
//
// Every check it runs exists because that failure actually happened, and in each
// case no report would have caught it: the numbers would simply have been wrong.
// Both were found only because somebody thought to ask on the day. This is that
// question, asked on a schedule.
//
// SILENT when clean, deliberately. A job that reports "all fine" every week is a
// job people stop opening, and then it is quiet at the exact moment it matters.
const cron = require('node-cron')
const { supabaseAdmin } = require('./supabase')
const { formatReport, failures } = require('../lib/dayOneIntegrity')

// Counting is one stable SQL function (migration 121) rather than strings built
// here, so there is no dynamic SQL and no table name assembled in JavaScript.
async function runChecks() {
  const { data, error } = await supabaseAdmin.rpc('day_one_integrity')
  if (error) throw new Error(`day_one_integrity(): ${error.message}`)
  return data || []
}

async function runOnce() {
  const rows = await runChecks()
  const bad = failures(rows)
  const text = formatReport(rows)

  if (!bad.length) {
    console.log('[dayOneIntegrity] all checks clean')
    return { ok: true, rows }
  }

  // The log is the durable record; the DM is a convenience on top of it.
  console.error('[dayOneIntegrity] FAILURES:\n' + text)

  const to = process.env.DAY_ONE_INTEGRITY_ALERT_EMAIL
  if (!to) {
    console.warn('[dayOneIntegrity] no DAY_ONE_INTEGRITY_ALERT_EMAIL set, logged only')
    return { ok: false, rows, alerted: false }
  }

  try {
    const { sendTicketDmAsSystem } = require('./googleChat')
    await sendTicketDmAsSystem({ targetEmail: to, text })
    console.log(`[dayOneIntegrity] alerted ${to}`)
    return { ok: false, rows, alerted: true }
  } catch (e) {
    // A Chat outage must not swallow the finding or fail the job.
    console.error('[dayOneIntegrity] could not send the alert:', e.message)
    return { ok: false, rows, alerted: false }
  }
}

function start() {
  if (process.env.DAY_ONE_INTEGRITY_ENABLED !== 'true') {
    console.log('[dayOneIntegrity] disabled (set DAY_ONE_INTEGRITY_ENABLED=true to enable)')
    return
  }
  // Monday 8am Pacific. A working morning, so whoever reads it can act on it,
  // rather than finding it stale having fired over the weekend.
  cron.schedule('0 8 * * 1', () => {
    runOnce().catch(err => console.error('[dayOneIntegrity] run failed:', err.message))
  }, { timezone: 'America/Los_Angeles' })
  console.log('[dayOneIntegrity] scheduled Mondays at 8am Pacific')
}

module.exports = { start, runOnce, runChecks }
