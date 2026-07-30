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

// Marks each class with is_new. A class is new when its type is flagged AND
// the flag is still active on that class's own local date — so a schedule
// spanning the expiry shows the badge only on the days it should.
function markNewClasses(classes, flags) {
  const byType = new Map((flags || []).map(f => [f.event_type_id, f]))
  return (classes || []).map(c => {
    const flag = byType.get(c.event_type_id)
    const day = String(c.event_timestamp_local || '').slice(0, 10)
    return { ...c, is_new: !!flag && !!day && isFlagActive(flag, day) }
  })
}

module.exports = { isFlagActive, activeFlagMap, markNewClasses }
