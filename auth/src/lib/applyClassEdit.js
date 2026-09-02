// Orchestrates PUT /group-x/classes/:eventId: create the replacement class in
// ABC, cancel the original, then move our own DB references to the new id.
//
// Pulled out of the route handler so the ordering can be exercised with
// fakes. This is the only code path in the portal that deletes a real,
// currently-scheduled class as a normal part of succeeding, and the ordering
// that makes it safe -- create before cancel -- lived only inside an Express
// handler that nothing calls in a test. A silent reorder here would delete a
// class off a live gym schedule with no test failing to catch it.
//
// createClass, cancelClass and moveRefs are injected so this stays a plain
// function: no ABC client, no Supabase client, no Express req/res.

// Past classes are not editable. A past class is never deleted, so a logged
// headcount can never be lost to a rebuild. Checked before any ABC call is
// made, so the guard is provable without a network double: pass a fake that
// throws for createClass/cancelClass and confirm a past date never reaches it.
async function applyClassEdit({ createClass, cancelClass, moveRefs }, params) {
  const {
    clubNumber, oldEventId, eventTypeId, employeeId, eventTimestampLocal,
    trainingLevelId, date, className, isPast,
  } = params

  if (isPast) return { kind: 'past' }

  // CREATE RUNS FIRST, deliberately. If the create fails we still have the
  // original class; if the cancel fails we have a duplicate, which is visible
  // and fixable. The reverse order risks deleting a class and failing to
  // recreate it, leaving a hole nobody notices until members turn up.
  const created = await createClass(clubNumber, {
    event_type_id: eventTypeId,
    employee_id: employeeId,
    event_timestamp_local: eventTimestampLocal,
    training_level_id: trainingLevelId || null,
  })
  // ABC rejected it. Nothing has changed yet -- the original class is
  // untouched -- so cancel must never run on this branch.
  if (!created.ok) return { kind: 'create_failed', error: created.error, http: created.http }

  const canceled = await cancelClass(clubNumber, oldEventId)
  if (!canceled.ok) {
    // The new class exists in ABC. Report that plainly with its id rather
    // than a bare failure, which would have staff create it a second time.
    return { kind: 'cancel_failed', eventId: created.event_id, error: canceled.error, http: canceled.http }
  }

  // Carry what was keyed to the old id across to the new one. Best-effort,
  // like badging on create: the class exists either way, and a bookkeeping
  // failure here must not be reported as an edit failure.
  const moved = await moveRefs(clubNumber, oldEventId, created.event_id, date, className)
  return { kind: 'ok', eventId: created.event_id, moved }
}

module.exports = { applyClassEdit }
