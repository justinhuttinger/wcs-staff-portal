#!/usr/bin/env node
/**
 * Migrate the Mastermind custom field options to v2 (Strategize / Build /
 * Thinking) on every list in the WCS Marketing space.
 *
 * v2 collapses the old 6 modes (Brief Me / Strategize / Analyze / Draft /
 * Review / Wrap Up) into 2 user-triggerable modes plus a self-managed
 * Thinking state.
 *
 * Strategy: walk every list in the space, find the Mastermind field on each,
 * delete it, recreate with the v2 options. Existing tasks lose any old
 * Mastermind value (acceptable; they had none in production use yet).
 *
 * Usage:
 *   cd auth
 *   CLICKUP_API_KEY=pk_xxx CLICKUP_SPACE_MARKETING=90114171469 \
 *     node scripts/migrate-mastermind-v2-options.js
 */

const TOKEN = process.env.CLICKUP_API_KEY
const SPACE_ID = process.env.CLICKUP_SPACE_MARKETING
if (!TOKEN) { console.error('Missing CLICKUP_API_KEY'); process.exit(1) }
if (!SPACE_ID) { console.error('Missing CLICKUP_SPACE_MARKETING'); process.exit(1) }

const API = 'https://api.clickup.com/api/v2'
const SLEEP_MS = 250

async function cu(path, opts = {}) {
  await new Promise(r => setTimeout(r, SLEEP_MS))
  const r = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: TOKEN,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const text = await r.text()
  let json; try { json = text ? JSON.parse(text) : {} } catch { json = {} }
  if (!r.ok) throw new Error(`${r.status} ${opts.method || 'GET'} ${path}: ${String(text).slice(0, 200)}`)
  return json
}

const V2_FIELD = {
  name: 'Mastermind',
  type: 'drop_down',
  type_config: {
    options: [
      { name: 'Strategize', color: '#9B59B6', orderindex: 0 },
      { name: 'Build', color: '#2ECC71', orderindex: 1 },
      { name: 'Thinking', color: '#F1C40F', orderindex: 2 },
    ],
  },
}

async function main() {
  console.log(`\n=== Mastermind v2 options migration ===\n`)
  console.log(`Space: ${SPACE_ID}\n`)

  // Walk folders → lists in the space
  const folders = await cu(`/space/${SPACE_ID}/folder?archived=false`)
  const allLists = []
  for (const f of folders.folders || []) {
    console.log(`Folder: ${f.name}`)
    for (const list of f.lists || []) {
      allLists.push({ folder: f.name, list })
      console.log(`  list: ${list.name} (${list.id})`)
    }
  }

  console.log(`\nFound ${allLists.length} lists. Walking fields...\n`)

  let migrated = 0
  let skipped = 0
  let failed = 0
  let firstNewFieldId = null

  for (const { folder, list } of allLists) {
    try {
      const lf = await cu(`/list/${list.id}/field`)
      const existing = (lf.fields || []).find(f => f?.name === 'Mastermind')
      if (existing?.id) {
        await cu(`/list/${list.id}/field/${existing.id}`, { method: 'DELETE' })
        console.log(`  ✓ deleted old Mastermind field on '${folder}/${list.name}'`)
      } else {
        console.log(`  - no existing Mastermind field on '${folder}/${list.name}'`)
      }
      await cu(`/list/${list.id}/field`, {
        method: 'POST',
        body: JSON.stringify(V2_FIELD),
      })
      console.log(`  ✓ created v2 Mastermind field on '${folder}/${list.name}'`)

      if (!firstNewFieldId) {
        const refreshed = await cu(`/list/${list.id}/field`)
        const newField = (refreshed.fields || []).find(f => f?.name === 'Mastermind')
        if (newField?.id) firstNewFieldId = newField.id
      }
      migrated++
    } catch (e) {
      console.error(`  ⚠ failed on '${folder}/${list.name}': ${e.message.slice(0, 200)}`)
      failed++
    }
  }

  console.log(`\n=========================================`)
  console.log(`  Migration done. ${migrated} migrated, ${failed} failed, ${skipped} skipped.`)
  console.log(`=========================================\n`)

  if (firstNewFieldId) {
    console.log(`Update CLICKUP_MASTERMIND_FIELD_ID in Render to:\n  ${firstNewFieldId}\n`)
  } else {
    console.log(`Warning: could not capture the new field ID. Read it from any list with GET /list/{id}/field.\n`)
  }
}

main().catch(e => {
  console.error('\nFAIL:', e.message)
  process.exit(1)
})
