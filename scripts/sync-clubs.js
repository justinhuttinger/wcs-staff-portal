#!/usr/bin/env node
// Copies config/clubs.json (the one club list) into every service that needs it.
// Render builds auth/, ghl-sync/ and portal/ from their own folders, and the
// launcher packages only launcher/, so none of them can import a file above
// their root. Each gets a copy instead, and auth/src/config/clubs.test.js
// fails if a copy drifts from the source.
//
// Usage: node scripts/sync-clubs.js           (write the copies)
//        node scripts/sync-clubs.js --check   (exit 1 if any copy is stale)
//        node scripts/sync-clubs.js --sql     (print the upsert that brings the
//                                              public.clubs table in line)
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'config', 'clubs.json')
const TARGETS = [
  'auth/src/config/clubs.json',
  'ghl-sync/src/config/clubs.json',
  'portal/src/config/clubs.json',
  'launcher/src/clubs.json',
]

const source = fs.readFileSync(SOURCE, 'utf8')
const { clubs } = JSON.parse(source) // refuse to copy a broken file

if (process.argv.includes('--sql')) {
  const q = s => `'${String(s).replace(/'/g, "''")}'`
  const rows = clubs.map((c, i) =>
    `  (${q(c.clubNumber)}, ${q(c.slug)}, ${q(c.name)}, ${i + 1}, ${c.active ? 'true' : 'false'})`)
  console.log(`insert into public.clubs (club_number, slug, name, sort_order, active) values
${rows.join(',\n')}
on conflict (club_number) do update
  set slug = excluded.slug, name = excluded.name,
      sort_order = excluded.sort_order, active = excluded.active;`)
  process.exit(0)
}

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
