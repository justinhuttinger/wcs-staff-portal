#!/usr/bin/env node
/**
 * Seed the Coaching exercise library from free-exercise-db (Unlicense).
 *
 *   node auth/scripts/seed-exercise-library.js
 *
 * Idempotent: rows are matched on (source, source_id), and a free row YMove
 * has since linked onto is skipped rather than brought back. Pinned to one
 * commit so images and ids never shift underneath programs.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const { fromFreeDb, FREE_DB_REPO } = require('../src/lib/exerciseLibrary')
const { applyRows } = require('../src/services/exerciseSync')

const SHA = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5'

async function main() {
  const url = `https://raw.githubusercontent.com/${FREE_DB_REPO}/${SHA}/dist/exercises.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`free-exercise-db fetch failed: ${res.status}`)
  const data = await res.json()
  const rows = data.filter(r => r && r.id && r.name).map(r => fromFreeDb(r, SHA))
  const result = await applyRows(rows)
  console.log(`free-exercise-db @ ${SHA.slice(0, 7)}: ${rows.length} exercises`, result)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
