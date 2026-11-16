// Columns for the deliverables grid: the task's clubs (or one club-less
// column), plus any club that still holds something after it was removed
// from the task, so a received item never disappears. Tested.
export function gridColumns(taskClubs, deliverables) {
  const cols = (taskClubs.length ? taskClubs : [null]).map(club => ({ club, removed: false }))
  const seen = new Set(cols.map(c => c.club))
  for (const d of deliverables) {
    for (const s of d.slots || []) {
      const club = s.club ?? null
      if (!seen.has(club) && (s.items || []).length) { cols.push({ club, removed: true }); seen.add(club) }
    }
  }
  return cols
}
