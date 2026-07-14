// Compute Pacific-calendar-day differences. ABC strings are Pacific local.
// We reduce each date to a Pacific Y-M-D and diff at UTC-midnight to avoid
// DST-hour drift (matches the pattern used elsewhere for ABC dates).
const PACIFIC = 'America/Los_Angeles'

function pacificYMD(date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date) // "YYYY-MM-DD"
  return p
}

function parseAbcPacificDate(text) {
  if (!text || typeof text !== 'string') return null
  const t = text.trim()
  if (!t) return null
  // Accept "YYYY-MM-DD" or full timestamps ("YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DD HH:mm:ss")
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  // Anchor at UTC midnight of that calendar day for stable day math.
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
}

function daysSince(activityDateText, joinDateText, nowPacific) {
  const activity = parseAbcPacificDate(activityDateText) || parseAbcPacificDate(joinDateText)
  if (!activity) return null
  const todayYMD = pacificYMD(nowPacific)
  const today = new Date(`${todayYMD}T00:00:00Z`)
  const ms = today.getTime() - activity.getTime()
  return Math.floor(ms / 86400000)
}

function selectTier(days) {
  if (days == null) return null
  if (days >= 30) return 'lapsed-30d'
  if (days >= 21) return 'lapsed-21d'
  if (days >= 10) return 'lapsed-10d'
  return null
}

module.exports = { parseAbcPacificDate, daysSince, selectTier }
