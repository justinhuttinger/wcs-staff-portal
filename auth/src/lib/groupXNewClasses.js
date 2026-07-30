// "New class" badge logic.
//
// A flag marks a class OFFERING as new at one club until a date. Pure helpers
// here; the Supabase read lives in the routes.

// A flag is active on a given club-local day when that day is on or before
// show_until. Compared as YYYY-MM-DD strings so there is no timezone in play:
// "new until Sept 30" means through Sept 30 in the gym, not 30 Sept UTC.
function isFlagActive(flag, onDate) {
  if (!flag || !flag.show_until) return false
  return String(onDate) <= String(flag.show_until)
}

// Index active flags by event_type_id for a given day.
function activeFlagMap(flags, onDate) {
  const map = new Map()
  for (const f of flags || []) {
    if (isFlagActive(f, onDate)) map.set(f.event_type_id, f)
  }
  return map
}

// Marks each class with is_new.
//
// Two independent sources, because they answer different questions:
//   typeFlags  — this whole class offering is new (StrongHer just launched)
//   eventFlags — this particular session is new (Yoga already runs Friday and
//                we just added a Saturday one; only Saturday should be badged)
//
// A class is new if EITHER applies and is still active on that class's own
// local date, so a schedule spanning an expiry badges only the days it should.
function markNewClasses(classes, typeFlags, eventFlags) {
  const byType = new Map((typeFlags || []).map(f => [f.event_type_id, f]))
  const byEvent = new Map((eventFlags || []).map(f => [f.abc_event_id, f]))

  return (classes || []).map(c => {
    const day = String(c.event_timestamp_local || '').slice(0, 10)
    if (!day) return { ...c, is_new: false, new_source: null }

    const eventFlag = byEvent.get(c.event_id)
    if (isFlagActive(eventFlag, day)) return { ...c, is_new: true, new_source: 'session' }

    const typeFlag = byType.get(c.event_type_id)
    if (isFlagActive(typeFlag, day)) return { ...c, is_new: true, new_source: 'class' }

    return { ...c, is_new: false, new_source: null }
  })
}

module.exports = { isFlagActive, activeFlagMap, markNewClasses }
