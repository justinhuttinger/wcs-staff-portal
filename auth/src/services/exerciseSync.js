// auth/src/services/exerciseSync.js
// Writes library rows into memberapp_exercises. Used by the free-exercise-db
// seed script and the nightly YMove sync. The decisions (update, link, insert,
// skip) are made by planUpsert in lib/exerciseLibrary; this file only reads
// what is stored and writes the plan.
const cron = require('node-cron')
const ymoveClient = require('./ymoveClient')
const { fromYmove, planUpsert } = require('../lib/exerciseLibrary')

const TABLE = 'memberapp_exercises'
const READ_PAGE = 1000 // PostgREST's default row cap
const WRITE_BATCH = 200

// Lazy so tests (and the seed script before dotenv) never build a client.
const defaultDb = () => require('./supabase').supabaseAdmin

async function loadExisting(db) {
  const rows = []
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await db.from(TABLE).select('id, source, source_id, name_key').range(from, from + READ_PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < READ_PAGE) break
  }
  return rows
}

/**
 * Upsert library rows. Updates go through upsert-on-id in batches (one
 * request per 200 rows rather than one per row); updated_at is stamped here.
 * @returns {Promise<{inserted, updated, skipped}>}
 */
async function applyRows(rows, { db = defaultDb() } = {}) {
  const existing = await loadExisting(db)
  const { updates, inserts, skipped } = planUpsert(existing, rows)
  const now = new Date().toISOString()

  for (let i = 0; i < inserts.length; i += WRITE_BATCH) {
    const { error } = await db.from(TABLE).insert(inserts.slice(i, i + WRITE_BATCH))
    if (error) throw new Error(error.message)
  }
  const updateRows = updates.map(u => ({ ...u.row, id: u.id, updated_at: now }))
  for (let i = 0; i < updateRows.length; i += WRITE_BATCH) {
    const { error } = await db.from(TABLE).upsert(updateRows.slice(i, i + WRITE_BATCH), { onConflict: 'id' })
    if (error) throw new Error(error.message)
  }
  return { inserted: inserts.length, updated: updates.length, skipped }
}

/**
 * Pull YMove's whole catalogue (metadata only) and fold it into the library.
 * Fetches everything before writing anything, so an outage or a 429 mid-way
 * leaves the library exactly as it was.
 */
async function syncYmove({ client = ymoveClient, db } = {}) {
  if (!client.isConfigured()) return { skipped: 'no_key' }
  const items = await client.listAllExercises()
  const rows = items.filter(ex => ex && ex.id && ex.title).map(fromYmove)
  const result = await applyRows(rows, { db: db || defaultDb() })
  return { ...result, total: rows.length }
}

function startExerciseSyncCron() {
  cron.schedule('15 3 * * *', async () => {
    try {
      const result = await syncYmove()
      if (!result.skipped) console.log('[exerciseSync] YMove sync', result)
    } catch (err) {
      console.error('[exerciseSync] YMove sync failed:', err.message)
    }
  }, { timezone: 'America/Los_Angeles' })
}

module.exports = { applyRows, syncYmove, startExerciseSyncCron }
