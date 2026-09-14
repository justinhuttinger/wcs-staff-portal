// What "caught up" means, defined once.
//
// Kept out of the sync service and out of the route because three separate
// places need the same answer -- the sync stamps it on the row, the report
// rolls it up, and the tests check it -- and a second copy would be a second
// definition to drift.
//
// FOUR STATES, AND THE FOURTH IS THE POINT
//
//   complete     finished, whenever
//   overdue      past its due date and not finished
//   in_progress  started, not finished, still has time
//   not_started  assigned, untouched, still has time
//
// Overdue wins over progress: a course 71% done and a week late is late. The
// percentage is kept on the row so the report can still say "they were most of
// the way there", which is a different conversation with that person than
// "they never opened it".
//
// AN ASSIGNMENT WITH NO DUE DATE CAN NEVER BE OVERDUE. Operandio allows it --
// the one observation assignment in the data has dueAt null -- and the honest
// reading is that nobody has been told when to finish, so it sits in
// in_progress or not_started indefinitely rather than being counted against
// anyone. The report shows those separately.

const STATUSES = ['complete', 'overdue', 'in_progress', 'not_started']

/**
 * @param row   { dueAt, status: { completedAt, percentComplete } } as the API returns it
 * @param now   ms epoch, injected so the tests are not clock-dependent
 */
function assignmentStatus(row, now = Date.now()) {
  const st = (row && row.status) || {}
  if (st.completedAt) return 'complete'

  const due = row && row.dueAt ? Date.parse(row.dueAt) : null
  const hasDue = Number.isFinite(due)
  if (hasDue && due < now) return 'overdue'

  return Number(st.percentComplete) > 0 ? 'in_progress' : 'not_started'
}

/**
 * Is this person caught up right now?
 *
 * Nothing overdue. Someone with three untouched courses that are not due yet is
 * caught up -- they have not missed anything. Someone with one overdue course
 * is not, however much else they have finished.
 */
function isCaughtUp(assignments) {
  return (assignments || []).every(a => a.status !== 'overdue')
}

/**
 * Roll a set of assignment rows into the counts every view needs.
 *
 * `people` is passed separately rather than derived from the assignments,
 * because the number that matters most -- staff with nothing assigned at all --
 * cannot be derived from a list of assignments by definition.
 */
function rollUp(assignments, people = []) {
  const counts = { complete: 0, overdue: 0, in_progress: 0, not_started: 0 }
  const byPerson = new Map()
  for (const a of assignments || []) {
    if (counts[a.status] === undefined) counts[a.status] = 0
    counts[a.status] += 1
    if (!byPerson.has(a.user_id)) byPerson.set(a.user_id, [])
    byPerson.get(a.user_id).push(a)
  }

  const total = (assignments || []).length
  const decided = total - counts.not_started - counts.in_progress
  const peopleIds = (people || []).map(p => p.user_id)
  const unassigned = peopleIds.filter(id => !byPerson.has(id))
  const behind = peopleIds.filter(id => (byPerson.get(id) || []).some(a => a.status === 'overdue'))

  return {
    assignments: total,
    ...counts,
    // Of the work that has come due, how much was done. Assignments not yet due
    // are excluded from both halves -- counting them as failures would make the
    // number fall every time somebody assigns a course.
    percent_complete: decided > 0 ? Math.round((counts.complete / decided) * 1000) / 10 : null,
    people: peopleIds.length,
    people_with_assignments: peopleIds.length - unassigned.length,
    people_unassigned: unassigned.length,
    people_behind: behind.length,
    people_caught_up: peopleIds.length - unassigned.length - behind.length,
  }
}

module.exports = { STATUSES, assignmentStatus, isCaughtUp, rollUp }
