// Shared by the staff route (PUT /group-x/classes/:eventId/attendance) and the
// login-free link (/public/group-x-attendance), so both write the exact same row.

const MAX_HEADCOUNT = 500

// Returns { headcount } or { error } with a message fit for a 400.
function parseHeadcount(value) {
  const s = String(value ?? '').trim()
  if (!/^\d+$/.test(s)) return { error: 'headcount must be a whole number, zero or more' }
  const headcount = parseInt(s, 10)
  if (headcount > MAX_HEADCOUNT) return { error: 'headcount looks wrong, check the number' }
  return { headcount }
}

// Whole row. A partial upsert fails NOT NULL columns even when the row already
// exists, which has broken syncs in this codebase before.
function attendanceRow({ clubNumber, eventId, cls, headcount, notes, recordedBy }) {
  return {
    club_number: String(clubNumber),
    abc_event_id: String(eventId),
    series_id: cls.series_id || null,
    event_timestamp: cls.event_timestamp,
    event_timestamp_local: cls.event_timestamp_local,
    event_type_id: cls.event_type_id,
    class_name: cls.class_name,
    employee_id: cls.employee_id || null,
    instructor_name: cls.instructor_name || null,
    max_attendees: cls.max_attendees ?? null,
    headcount,
    notes: notes || null,
    recorded_by: recordedBy || 'unknown',
    recorded_at: new Date().toISOString(),
  }
}

// YYYY-MM-DD minus n days, as calendar arithmetic (no timezone involved).
function isoMinusDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

module.exports = { MAX_HEADCOUNT, parseHeadcount, attendanceRow, isoMinusDays }
