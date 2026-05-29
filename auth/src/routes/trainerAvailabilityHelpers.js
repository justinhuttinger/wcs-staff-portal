// Pure, dependency-free helpers for the trainer-availability route.
// Kept separate so they can be unit-tested without loading express/supabase.

// GHL's PUT /calendars/:id does NOT cleanly partial-merge: nested config (openHours,
// notifications, teamMembers detail) is preserved when omitted, but these top-level
// booking-config SCALARS revert to GHL's defaults (slotDuration -> 30 mins) if not
// re-sent. So a priority-only change must echo them back from the fresh read.
const CONFIG_SCALAR_KEYS = [
  'slotDuration', 'slotDurationUnit',
  'slotInterval', 'slotIntervalUnit',
  'slotBuffer', 'slotBufferUnit',
  'appoinmentPerSlot', 'appoinmentPerDay',
  'autoConfirm', 'eventType', 'eventColor', 'eventTitle', 'calendarType', 'name',
]

// Build the PUT body for a priority change: the full teamMembers array with only the
// target user's priority mutated, plus the booking-config scalars preserved from `cal`.
// Deliberately omits nested fields (openHours, notifications, locationConfigurations) --
// GHL preserves those on omission, and re-sending them is what corrupted the earlier
// full-object approach.
function buildPriorityUpdateBody(cal, userId, priority) {
  const current = Array.isArray(cal.teamMembers) ? cal.teamMembers : []
  const currentNorm = current.map(m => (typeof m === 'string' ? { userId: m } : { ...m }))
  const updated = currentNorm.map(m => (m.userId === userId ? { ...m, priority } : m))
  const body = { teamMembers: updated }
  for (const k of CONFIG_SCALAR_KEYS) {
    if (cal[k] !== undefined) body[k] = cal[k]
  }
  return body
}

module.exports = { CONFIG_SCALAR_KEYS, buildPriorityUpdateBody }
