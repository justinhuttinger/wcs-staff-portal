#!/usr/bin/env node
// Copies config/clubs.json (the one club list) into every service that needs it.
// Render builds auth/, ghl-sync/ and portal/ from their own folders, so none of
// them can import a file above their root. Each gets a copy instead, and
// auth/tests/clubsRegistry.test.js fails if a copy drifts from the source.
//
// Usage: node scripts/sync-clubs.js           (write the copies)
//        node scripts/sync-clubs.js --check   (exit 1 if any copy is stale)
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'config', 'clubs.json')
const TARGETS = [
  'auth/src/config/clubs.json',
  'ghl-sync/src/config/clubs.json',
  'portal/src/config/clubs.json',
]

const source = fs.readFileSync(SOURCE, 'utf8')
JSON.parse(source) // refuse to copy a broken file

const check = process.argv.includes('--check')
let stale = 0
for (const rel of TARGETS) {
  const target = path.join(ROOT, rel)
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
  if (current === source) continue
  if (check) {
    console.error(`stale: ${rel}`)
    stale++
  } else {
    fs.writeFileSync(target, source)
    console.log(`wrote ${rel}`)
  }
}
if (check && stale) {
  console.error('Run `node scripts/sync-clubs.js` to update the copies.')
  process.exit(1)
}
if (check) console.log('club copies are in sync')
