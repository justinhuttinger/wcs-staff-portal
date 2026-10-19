// auth/src/lib/coachingWrite.js
// Apply a planTreeDiff plan (lib/coachingPrograms.js) to the program tables.
// Takes the supabase client as an argument so the ordering can be tested
// without a database.
//
// There is no transaction across these calls, so the order is chosen so that
// stopping at any step leaves a tree that still reads sensibly and that the
// next save of the same payload finishes:
//   1. insert new days, then their new items (additions first)
//   2. update kept days, then kept items (moves onto new days need their ids)
//   3. delete removed items, then removed days (last, so an item moving off a
//      deleted day has moved before the day cascades it)
// A thrown error carries `partial: true` when an earlier step already wrote.

const DAYS = 'memberapp_program_days'
const ITEMS = 'memberapp_program_items'

async function run(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

async function applyTreePlan(db, programId, plan) {
  let wrote = false
  const step = async (query) => {
    const data = await run(query)
    wrote = true
    return data
  }

  try {
    const dayIdByIndex = new Map()
    if (plan.days.insert.length) {
      const rows = plan.days.insert.map(d => ({ ...d.row, program_id: programId }))
      const data = await step(db.from(DAYS).insert(rows).select('id, position'))
      // Insert returns rows in the order sent, so match by that order, never
      // by position (copies of old rows can share one).
      if (!Array.isArray(data) || data.length !== rows.length) {
        throw new Error('Could not match the new days to their exercises')
      }
      plan.days.insert.forEach((d, k) => dayIdByIndex.set(d.day_index, data[k].id))
    }

    const dayFor = (entry) => entry.row.day_id || entry.day_id || dayIdByIndex.get(entry.day_index)
    const placed = (rows) => {
      if (rows.some(r => !r.day_id)) throw new Error('Could not place an exercise on its day')
      return rows
    }

    if (plan.items.insert.length) {
      const rows = placed(plan.items.insert.map(i => ({ ...i.row, day_id: dayFor(i) })))
      await step(db.from(ITEMS).insert(rows))
    }
    if (plan.days.update.length) {
      const rows = plan.days.update.map(d => ({ id: d.id, program_id: programId, ...d.row }))
      await step(db.from(DAYS).upsert(rows, { onConflict: 'id' }))
    }
    if (plan.items.update.length) {
      // Upsert on id = update in place. planTreeDiff only lets through ids that
      // belong to this program, so this cannot touch another program's rows.
      const rows = placed(plan.items.update.map(i => ({ id: i.id, ...i.row, day_id: dayFor(i) })))
      await step(db.from(ITEMS).upsert(rows, { onConflict: 'id' }))
    }
    if (plan.items.delete.length) {
      await step(db.from(ITEMS).delete().in('id', plan.items.delete))
    }
    if (plan.days.delete.length) {
      await step(db.from(DAYS).delete().in('id', plan.days.delete).eq('program_id', programId))
    }
  } catch (err) {
    err.partial = wrote
    throw err
  }
}

module.exports = { applyTreePlan }
