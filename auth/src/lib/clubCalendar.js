// No-login club calendar for the WCS ABC "See Calendar" button: the club's
// upcoming tours and Day Ones, read-only. It is reachable with the launcher
// key only (the same device trust as /telephony/pending), so it carries as
// little as possible: first name + last initial, time, type, staff, status.
// No emails, phones, contact ids or notes (Justin, 2026-09-29).

// Names come from GHL as typed ("samantha"), so capitalise the first letter.
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s

// "Justin", "Huttinger" -> "Justin H."; a lone name stays as it is.
function shortName(first, last) {
  const f = cap(String(first || '').trim())
  const l = String(last || '').trim()
  if (f && l) return `${f} ${l[0].toUpperCase()}.`
  if (f || l) return f || l
  return ''
}

// "Justin Huttinger" -> "Justin H." (GHL event titles / contactName).
function shortFromFull(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  return shortName(parts[0], parts.slice(1).join(' '))
}

// GHL calendar events -> calendar entries. `contacts` maps contactId ->
// { first_name, last_name } (ghl_contacts_v2); `users` maps GHL user id -> name.
function toEntries(events, type, contacts = {}, users = {}) {
  return (events || [])
    .filter(e => e && (e.startTime || e.start))
    .map(e => {
      const c = contacts[e.contactId] || {}
      const status = String(e.appointmentStatus || e.status || 'confirmed').toLowerCase()
      return {
        id: e.id,
        type,
        start: e.startTime || e.start,
        end: e.endTime || e.end || null,
        name: shortName(c.first_name, c.last_name) || shortFromFull(e.contactName) || type,
        staff: (users[e.assignedUserId] || '').trim() || null,
        status,
      }
    })
}

// Cancelled / deleted appointments aren't worth a front-desk glance.
const HIDDEN_STATUSES = new Set(['cancelled', 'canceled', 'invalid', 'deleted'])

function buildClubCalendar(entries) {
  return entries
    .filter(e => !HIDDEN_STATUSES.has(e.status))
    .sort((a, b) => new Date(a.start) - new Date(b.start))
}

module.exports = { shortName, shortFromFull, toEntries, buildClubCalendar }
