#!/usr/bin/env node
/**
 * Builds a multi-tab Excel workbook listing every employee currently in ABC
 * for each of the 7 WCS clubs, then writes it to disk. Upload the resulting
 * .xlsx to Google Drive (Drive auto-converts to Google Sheets, preserving
 * one tab per location) and share with location managers.
 *
 * Each tab has the same columns:
 *   Employee ID | First Name | Last Name | Position | Department | ABC Status | Still Active?
 *
 * Managers fill the rightmost "Still Active?" column with Yes/No to flag who
 * no longer works at their club. The "ABC Status" column shows what ABC
 * currently has on file so they have a reference (and can see who ABC has
 * already marked inactive).
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
const XLSX = require('xlsx')

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const ABC_APP_ID = process.env.ABC_APP_ID
const ABC_APP_KEY = process.env.ABC_APP_KEY

const CLUBS = [
  { slug: 'salem',       clubNumber: '30935', name: 'Salem' },
  { slug: 'keizer',      clubNumber: '31599', name: 'Keizer' },
  { slug: 'eugene',      clubNumber: '7655',  name: 'Eugene' },
  { slug: 'springfield', clubNumber: '31598', name: 'Springfield' },
  { slug: 'clackamas',   clubNumber: '31600', name: 'Clackamas' },
  { slug: 'milwaukie',   clubNumber: '31601', name: 'Milwaukie' },
  { slug: 'medford',     clubNumber: '32073', name: 'Medford' },
]

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  return process.argv[i + 1]
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

async function fetchEmployees(clubNumber) {
  const url = `${ABC_BASE_URL}/${clubNumber}/employees`
  const res = await fetch(url, {
    headers: {
      app_id: ABC_APP_ID,
      app_key: ABC_APP_KEY,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    throw new Error(`ABC API HTTP ${res.status} for club ${clubNumber}`)
  }
  const body = await res.json()
  return body.employees || []
}

// Map an ABC employee object to our flat row shape. ABC returns a nested
// object with `personal`, `employment`, and a top-level `employeeId`.
function toRow(emp) {
  const p = emp.personal || {}
  const e = emp.employment || {}
  return {
    'Employee ID': emp.employeeId || emp.id || '',
    'First Name': (p.firstName || '').trim(),
    'Last Name': (p.lastName || '').trim(),
    'Position': e.position || e.jobTitle || '',
    'Department': e.department || '',
    'ABC Status': e.employeeStatus || '',
    'Still Active?': '', // manager fills this in
  }
}

const COLUMNS = ['Employee ID', 'First Name', 'Last Name', 'Position', 'Department', 'ABC Status', 'Still Active?']

async function main() {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    console.error('Missing ABC_APP_ID / ABC_APP_KEY in environment.')
    process.exit(1)
  }

  const outPath = path.resolve(arg('out', './abc-employee-roster.xlsx'))
  const activeOnly = hasFlag('active-only')
  const clubsArg = arg('clubs', null)
  const targets = clubsArg
    ? CLUBS.filter(c => clubsArg.toLowerCase().split(',').map(s => s.trim()).includes(c.slug))
    : CLUBS

  if (targets.length === 0) {
    console.error(`No matching clubs for --clubs=${clubsArg}`)
    process.exit(1)
  }

  console.log(`Building roster for ${targets.length} club(s) → ${outPath}`)
  if (activeOnly) console.log(`(--active-only: skipping employees ABC has flagged inactive)`)

  const workbook = XLSX.utils.book_new()

  for (const club of targets) {
    process.stdout.write(`  ${club.name.padEnd(12)}… `)
    let employees
    try {
      employees = await fetchEmployees(club.clubNumber)
    } catch (err) {
      console.log(`FAILED (${err.message})`)
      // Add an empty sheet with the error so managers don't think the tab is
      // missing — they can see something went wrong.
      const errSheet = XLSX.utils.aoa_to_sheet([['Error fetching from ABC:', err.message]])
      XLSX.utils.book_append_sheet(workbook, errSheet, club.name)
      continue
    }

    let rows = employees.map(toRow)
    if (activeOnly) {
      rows = rows.filter(r => r['ABC Status'].toLowerCase() === 'active')
    }
    // Sort by Last Name, First Name for manager-friendly ordering
    rows.sort((a, b) => {
      const ln = a['Last Name'].localeCompare(b['Last Name'])
      if (ln !== 0) return ln
      return a['First Name'].localeCompare(b['First Name'])
    })

    const sheet = XLSX.utils.json_to_sheet(rows, { header: COLUMNS })

    // Column widths so the sheet is readable as-is on first open
    sheet['!cols'] = [
      { wch: 12 }, // Employee ID
      { wch: 16 }, // First Name
      { wch: 18 }, // Last Name
      { wch: 22 }, // Position
      { wch: 18 }, // Department
      { wch: 12 }, // ABC Status
      { wch: 14 }, // Still Active?
    ]

    XLSX.utils.book_append_sheet(workbook, sheet, club.name)
    console.log(`${rows.length} employees`)
  }

  // Add a "How to use" instructions tab as the first sheet so managers
  // immediately see what they're supposed to do.
  const instructions = [
    ['WCS Employee Roster — Manager Review'],
    [],
    ['Each tab below shows the employees ABC currently has on file for one location.'],
    [],
    ['How to fill this out:'],
    ['  1. Open your location\'s tab using the tabs at the bottom of the sheet.'],
    ['  2. For each row, type "Yes" or "No" in the "Still Active?" column to indicate'],
    ['     whether the person still works at your club.'],
    ['  3. If someone is missing from your tab, add them at the bottom with their'],
    ['     first and last name and "Yes" in the Still Active? column.'],
    [],
    ['Reference columns (do not edit):'],
    ['  • Employee ID — ABC\'s internal ID for the person.'],
    ['  • Position / Department — what ABC has on file (may be blank).'],
    ['  • ABC Status — what ABC currently considers them (active/inactive/etc.).'],
    [],
    [`Generated: ${new Date().toISOString().slice(0, 10)}`],
  ]
  const instructionSheet = XLSX.utils.aoa_to_sheet(instructions)
  instructionSheet['!cols'] = [{ wch: 80 }]
  // Insert at index 0 so it's the leftmost (first) tab
  XLSX.utils.book_append_sheet(workbook, instructionSheet, 'Instructions')
  // Move Instructions to the front
  const sheetNames = workbook.SheetNames
  const idx = sheetNames.indexOf('Instructions')
  if (idx > 0) {
    sheetNames.splice(idx, 1)
    sheetNames.unshift('Instructions')
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  XLSX.writeFile(workbook, outPath)
  console.log(`\nWrote ${outPath}`)
  console.log(`Upload to Google Drive — Drive auto-converts .xlsx to Google Sheets with tabs preserved.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
