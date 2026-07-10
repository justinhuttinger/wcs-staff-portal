// One-time backfill: give every existing form response sheet "anyone with
// the link can edit" access and file it into its location subfolder under the
// shared forms Drive folder (subfolders are created on demand).
//
// Run from auth/:
//   node scripts/backfill-forms-sheet-access.js --dry-run   (list sheets, write nothing)
//   node scripts/backfill-forms-sheet-access.js             (do the backfill)
//
// Idempotent + safe: re-posting the 'anyone' permission is a no-op update and
// a sheet already in its subfolder is left alone.
require('dotenv').config()
// Polyfill WebSocket for Node < 22 (Supabase Realtime constructor check fires
// at createClient() time even when Realtime is never used by this script).
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class WebSocket {
    constructor() { this.readyState = 3 }
    close() {} send() {} addEventListener() {} removeEventListener() {}
  }
}
const { organizeSheet } = require('../src/services/formsSheets')

async function main() {
  const dry = process.argv.includes('--dry-run')
  const { supabaseAdmin } = require('../src/services/supabase')
  const { data: forms, error } = await supabaseAdmin
    .from('forms').select('*').not('sheet_id', 'is', null).order('title')
  if (error) throw error
  console.log(`${(forms || []).length} form(s) with a sheet${dry ? ' (dry run)' : ''}`)
  let ok = 0, failed = 0
  for (const form of forms || []) {
    try {
      if (!dry) await organizeSheet(form)
      console.log(`  ok   ${form.title} (${form.sheet_id})`)
      ok++
    } catch (e) {
      console.error(`  FAIL ${form.title}: ${e.message}`)
      failed++
    }
  }
  console.log(`done: ${ok} ok, ${failed} failed`)
  if (failed) process.exitCode = 1
}

main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e); process.exit(1) })
