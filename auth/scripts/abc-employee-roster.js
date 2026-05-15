#!/usr/bin/env node
/**
 * Builds a multi-tab Excel workbook listing every employee currently in ABC
 * for each of the 7 WCS clubs, then writes it to disk. Upload the resulting
 * .xlsx to Google Drive (Drive auto-converts to Google Sheets, preserving
 * one tab per location) and share with location managers.
 *
 * For the run-from-browser equivalent, hit
 *   GET /admin/exports/abc-employee-roster.xlsx
 * while logged in as admin — the auth API has the same ABC creds and the
 * same workbook builder.
 *
 * Each tab has the same columns:
 *   Employee ID | First Name | Last Name | Position | Department | ABC Status | Still Active?
 *
 * Usage:
 *   node scripts/abc-employee-roster.js
 *   node scripts/abc-employee-roster.js --out ~/Desktop/wcs-employees.xlsx
 *   node scripts/abc-employee-roster.js --active-only          # skip inactive in ABC
 *   node scripts/abc-employee-roster.js --clubs salem,keizer   # limit to specific slugs
 *
 * Requires ABC_APP_ID and ABC_APP_KEY in env (same vars the auth API uses).
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { buildRoster } = require('../src/services/abcEmployeeRoster')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  return process.argv[i + 1]
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

async function main() {
  if (!process.env.ABC_APP_ID || !process.env.ABC_APP_KEY) {
    console.error('Missing ABC_APP_ID / ABC_APP_KEY in environment.')
    console.error('Copy them from Render → wcs-auth-api → Environment into auth/.env.')
    process.exit(1)
  }

  const outPath = path.resolve(arg('out', './abc-employee-roster.xlsx'))
  const activeOnly = hasFlag('active-only')
  const clubsArg = arg('clubs', null)
  const clubSlugs = clubsArg ? clubsArg.split(',').map(s => s.trim()) : null

  console.log(`Building roster → ${outPath}`)
  if (activeOnly) console.log(`(--active-only: skipping employees ABC has flagged inactive)`)

  const { buffer, totals } = await buildRoster({
    activeOnly,
    clubSlugs,
    log: (msg) => process.stdout.write(`  ${msg}\n`),
  })

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, buffer)

  console.log('\nRow counts:')
  for (const [club, n] of Object.entries(totals)) {
    console.log(`  ${club.padEnd(14)} ${n}`)
  }
  console.log(`\nWrote ${outPath}`)
  console.log(`Upload to Google Drive — Drive auto-converts .xlsx to Google Sheets with tabs preserved.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
