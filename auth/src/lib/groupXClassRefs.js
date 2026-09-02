// Re-pointing our own tables when an edit replaces an ABC class.
//
// ABC has no event-update endpoint, so editing a class is a create followed by
// a cancel, and the ABC event id changes. Everything in our own DB keyed on
// that id is orphaned unless it is moved to the new id in the same step.
const { supabaseAdmin } = require('../services/supabase')

// Every table keyed on an ABC event id, EXCEPT class_seed_log (migration 097)
// -- deliberately excluded, not forgotten.
//
// class_seed_log records which member accounts were enrolled into a class, so
// a night's seeding can be undone later. The edit deletes the old ABC class,
// so those enrolments are gone with it; there is nothing left to "follow" the
// class to its new id. Worse, re-pointing those rows at the new event id would
// make the seeder believe the new class is already seeded and skip it. Leaving
// the rows keyed to the dead id preserves them as history without breaking the
// next seed run.
//
// Attendance is included for completeness even though editing is restricted to
// future classes, which have no headcount: if a row somehow exists, losing it
// silently would be the worst outcome here.
const REF_TABLES = [
  { table: 'group_x_new_class_events', column: 'abc_event_id', errorKey: 'badge_error' },
  { table: 'group_x_series_events', column: 'abc_event_id', errorKey: 'link_error' },
  { table: 'group_x_class_attendance', column: 'abc_event_id', errorKey: 'attendance_error' },
]

// Extra columns that denormalise data the edit itself changes. Without these,
// group_x_series_events would carry the class forward under its OLD
// occurrence date, and a renamed class's badge would keep its old name.
function extraUpdatesFor(table, date, className) {
  if (table === 'group_x_series_events' && date) return { event_date: date }
  if (table === 'group_x_new_class_events' && className) return { class_name: className }
  return {}
}

// Best-effort, exactly like the badge write on POST /classes: the class exists
// in ABC either way (the create already succeeded by the time this runs), and
// failing the whole edit over a bookkeeping move would be worse than a
// bookkeeping row left pointing at a class that no longer exists. Logs and
// returns error strings; never throws.
async function moveClassRefs(clubNumber, oldEventId, newEventId, date, className) {
  const result = { badge_error: null, link_error: null, attendance_error: null }
  for (const { table, errorKey } of REF_TABLES) {
    try {
      const { error } = await supabaseAdmin
        .from(table)
        .update({ abc_event_id: String(newEventId), ...extraUpdatesFor(table, date, className) })
        .eq('club_number', String(clubNumber))
        .eq('abc_event_id', String(oldEventId))
      if (error) {
        console.error(`[groupX] could not move ${table} to new event id:`, error.message)
        result[errorKey] = error.message
      }
    } catch (err) {
      console.error(`[groupX] could not move ${table} to new event id:`, err.message)
      result[errorKey] = err.message
    }
  }
  return result
}

module.exports = { REF_TABLES, moveClassRefs }
