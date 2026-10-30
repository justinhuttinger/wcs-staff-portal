// Rules for the monthly club memo (routes/memos.js). Pure, so they can be tested
// without a database.

// Short text for the iPad lock screen image. Provisional: the real limit comes
// from a readability check on an iPad when the image is built.
const LOCK_SCREEN_MAX = 280
const BODY_MAX = 20000

// 'YYYY-MM' or 'YYYY-MM-DD' -> first of that month, else null.
function monthKey(value) {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(typeof value === 'string' ? value : '')
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return `${m[1]}-${m[2]}-01`
}

// The club's newest started memo, unless that memo has ended. Deliberately does
// not fall back to an older one: ending a memo must not resurrect last month's.
function pickLiveMemo(rows, now = new Date()) {
  const t = now.getTime()
  const started = (rows || [])
    .filter(r => r.status === 'published' && r.starts_at && new Date(r.starts_at).getTime() <= t)
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))
  const newest = started[0]
  if (!newest) return null
  if (newest.ends_at && new Date(newest.ends_at).getTime() <= t) return null
  return newest
}

function clubStatus(row, liveId, now = new Date()) {
  if (!row) return 'not_started'
  if (row.status !== 'published') return 'draft'
  const t = now.getTime()
  if (new Date(row.starts_at).getTime() > t) return 'scheduled'
  if (row.ends_at && new Date(row.ends_at).getTime() <= t) return 'ended'
  return row.id === liveId ? 'live' : 'replaced'
}

// A missing start means "show now"; a missing end means "until the next one".
function parseDates(body, now = new Date()) {
  const start = body?.starts_at ? new Date(body.starts_at) : now
  if (isNaN(start.getTime())) return { error: 'Invalid start date' }
  let ends_at = null
  if (body?.ends_at) {
    const end = new Date(body.ends_at)
    if (isNaN(end.getTime())) return { error: 'Invalid end date' }
    if (end.getTime() <= start.getTime()) return { error: 'End date must be after the start date' }
    ends_at = end.toISOString()
  }
  return { starts_at: start.toISOString(), ends_at }
}

// scope = the caller's club slugs; null = every club.
function canEditClub(scope, slug) {
  return scope === null || (scope || []).includes(slug)
}

function canPublish(edition) {
  return edition?.status === 'ready'
}

function cleanText(value, max = BODY_MAX) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

module.exports = {
  LOCK_SCREEN_MAX, BODY_MAX, monthKey, pickLiveMemo, clubStatus, parseDates, canEditClub, canPublish, cleanText,
}
