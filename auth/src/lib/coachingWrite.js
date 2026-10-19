// auth/src/lib/coachingWrite.js
// Apply a planTreeDiff plan (lib/coachingPrograms.js) to the program tables.
// Takes the supabase client as an argument so the ordering can be tested
// without a database.
//
// Order matters: new days first (their new items need the ids), deletes last
// (an item moving off a deleted day has to move before the day cascades it).

const DAYS = 'memberapp_program_days'
const ITEMS = 'memberapp_program_items'

async function run(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

async function applyTreePlan(db, programId, plan) {
  const dayIdByIndex = new Map()
  if (plan.days.insert.length) {
    const rows = plan.days.insert.map(d => ({ ...d.row, program_id: programId }))
    const data = await run(db.from(DAYS).insert(rows).select('id, position'))
    // A day's position is its index in the tree, which is what day_index means.
    for (const d of data || []) dayIdByIndex.set(d.position, d.id)
  }
  if (plan.days.update.length) {
    const rows = plan.days.update.map(d => ({ id: d.id, program_id: programId, ...d.row }))
    await run(db.from(DAYS).upsert(rows, { onConflict: 'id' }))
  }

  const dayFor = (entry) => entry.row.day_id || entry.day_id || dayIdByIndex.get(entry.day_index)

  if (plan.items.insert.length) {
    const rows = plan.items.insert.map(i => ({ ...i.row, day_id: dayFor(i) }))
    if (rows.some(r => !r.day_id)) throw new Error('Could not place an exercise on its day')
    await run(db.from(ITEMS).insert(rows))
  }
  if (plan.items.update.length) {
    // Upsert on id = update in place. planTreeDiff only lets through ids that
    // belong to this program, so this cannot touch another program's rows.
    const rows = plan.items.update.map(i => ({ id: i.id, ...i.row, day_id: dayFor(i) }))
    if (rows.some(r => !r.day_id)) throw new Error('Could not place an exercise on its day')
    await run(db.from(ITEMS).upsert(rows, { onConflict: 'id' }))
  }
  if (plan.items.delete.length) {
    await run(db.from(ITEMS).delete().in('id', plan.items.delete))
  }
  if (plan.days.delete.length) {
    await run(db.from(DAYS).delete().in('id', plan.days.delete).eq('program_id', programId))
  }
}

module.exports = { applyTreePlan }
