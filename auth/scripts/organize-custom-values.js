#!/usr/bin/env node
// File every club's GHL custom values into folders.
//
//   node scripts/organize-custom-values.js [--clubs a,b] [--template salem] [--apply]
//
// Folder layout comes from two places:
//   1. Name rules below (emails and their sender values).
//   2. The template club's own folders (default Salem, where the SMS folders
//      were set up by hand): a value with the same name goes in the same
//      folder in every club.
// Folders are created when missing; values already in the right folder are
// left alone. A value neither source knows is reported, not moved.
// Dry run by default; --apply writes.
//
// GHL API: list folders GET customValues?documentType=folder; create POST
// { name, documentType: 'folder' }; file a value PUT { name, value, parentId }.
// A plain PUT { name, value } (the portal's editors) keeps the folder.

require('dotenv').config()
const { LOCATIONS } = require('../src/config/ghlLocations')
const { ghlFetch } = require('../src/services/ghlClient')

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const APPLY = process.argv.includes('--apply')
const TEMPLATE = arg('template', 'salem')
const CLUBS = arg('clubs') ? arg('clubs').split(',') : LOCATIONS.map(l => l.slug)

const RULES = [
  [/^New Lead Email \d+ (Subject|Preview|HTML)$/i, 'Email - New Leads'],
  [/^Free Pass Email \d+ (Subject|Preview|HTML)$/i, 'Email - Free Pass'],
  [/^New Member Email \d+ (Subject|Preview|HTML)$/i, 'Email - New Members'],
  [/^Check In \d+ Email (Subject|Preview|HTML)$/i, 'Email - Check-In Milestones'],
  [/^Email From (Name|Address)$/i, 'Email - Sender'],
]

const norm = (s) => String(s || '').trim().toLowerCase()

async function load(loc) {
  const base = `/locations/${loc.id}/customValues`
  const folders = (await ghlFetch(base, loc.apiKey, { params: { documentType: 'folder' } })).customValueFolders || []
  const values = (await ghlFetch(base, loc.apiKey)).customValues || []
  return { base, folders, values }
}

async function main() {
  const tpl = LOCATIONS.find(l => l.slug === TEMPLATE)
  if (!tpl) throw new Error('Unknown --template ' + TEMPLATE)
  const t = await load(tpl)
  const tplFolderName = new Map(t.folders.map(f => [f.id, f.name]))
  const fromTemplate = new Map()
  for (const v of t.values) if (v.parentId && tplFolderName.has(v.parentId)) fromTemplate.set(norm(v.name), tplFolderName.get(v.parentId))

  const folderFor = (name) => RULES.find(([re]) => re.test(name))?.[1] || fromTemplate.get(norm(name)) || null

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: template ${tpl.name} (${fromTemplate.size} filed values), clubs ${CLUBS.join(', ')}`)
  for (const slug of CLUBS) {
    const loc = LOCATIONS.find(l => l.slug === slug)
    if (!loc) { console.log(`\n${slug}: no GHL credentials, skipped`); continue }
    const { base, folders, values } = await load(loc)
    const folderId = new Map(folders.map(f => [f.name, f.id]))
    let moved = 0, already = 0, createdFolders = 0
    const unknown = []
    for (const v of values) {
      const folder = folderFor(v.name)
      if (!folder) { unknown.push(v.name); continue }
      if (!folderId.has(folder)) {
        if (APPLY) {
          const made = await ghlFetch(base, loc.apiKey, { method: 'POST', body: { name: folder, documentType: 'folder' } })
          folderId.set(folder, (made.customValue || made).id)
        } else {
          folderId.set(folder, `new:${folder}`)
        }
        createdFolders++
      }
      const target = folderId.get(folder)
      if (v.parentId === target) { already++; continue }
      if (APPLY) await ghlFetch(`${base}/${v.id}`, loc.apiKey, { method: 'PUT', body: { name: v.name, value: v.value ?? '', parentId: target } })
      moved++
    }
    console.log(`\n${loc.name}: ${values.length} values. ${APPLY ? '' : 'would '}create ${createdFolders} folders, ${APPLY ? 'moved' : 'move'} ${moved}, already filed ${already}`)
    if (unknown.length) console.log(`  no folder rule (left where they are): ${unknown.join(', ')}`)
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1) })
