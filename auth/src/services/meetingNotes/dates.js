// auth/src/services/meetingNotes/dates.js
// Calendar-correct date add for YYYY-MM-DD strings (anchored at UTC noon so DST
// never shifts a date across a day boundary). Used to find next week's meeting.
'use strict'

// Today's date (YYYY-MM-DD) in Pacific.
function todayPacific(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (t) => parts.find((p) => p.type === t).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  base.setUTCDate(base.getUTCDate() + n)
  const yyyy = base.getUTCFullYear()
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(base.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

module.exports = { addDays, todayPacific }
