// auth/src/services/meetingNotes/dates.js
// Calendar-correct date add for YYYY-MM-DD strings (anchored at UTC noon so DST
// never shifts a date across a day boundary). Used to find next week's meeting.
'use strict'

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  base.setUTCDate(base.getUTCDate() + n)
  const yyyy = base.getUTCFullYear()
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(base.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

module.exports = { addDays }
