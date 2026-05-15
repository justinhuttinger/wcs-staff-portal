// Build a multi-tab .xlsx workbook listing every employee currently in ABC
// for each of the 7 WCS clubs. Shared between the CLI script
// (auth/scripts/abc-employee-roster.js) and the admin export route
// (auth/src/routes/exports.js). xlsx is required lazily so pure helpers can
// be unit-tested without the dep.

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

const COLUMNS = ['Employee ID', 'First Name', 'Last Name', 'Position', 'Department', 'ABC Status', 'Still Active?']

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

function sortByName(rows) {
  return rows.slice().sort((a, b) => {
    const ln = a['Last Name'].localeCompare(b['Last Name'])
    if (ln !== 0) return ln
    return a['First Name'].localeCompare(b['First Name'])
  })
}

async function fetchEmployees(clubNumber) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set in env')
  }
  const url = `${ABC_BASE_URL}/${clubNumber}/employees`
  const res = await fetch(url, {
    headers: { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    throw new Error(`ABC API HTTP ${res.status} for club ${clubNumber}`)
  }
  const body = await res.json()
  return body.employees || []
}

function instructionsRows(generatedAt) {
  return [
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
    [`Generated: ${generatedAt}`],
  ]
}

/**
 * Build the workbook.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.activeOnly=false]  Skip employees ABC has flagged inactive.
 * @param {string[]} [opts.clubSlugs]        Limit to a subset of clubs by slug.
 * @param {(msg: string) => void} [opts.log] Optional progress logger.
 * @returns {Promise<{ buffer: Buffer, totals: Record<string, number|string> }>}
 *   `buffer` is the .xlsx file contents. `totals` maps each club name (and
 *   any failed clubs) to its row count or an error message.
 */
async function buildRoster(opts = {}) {
  const { activeOnly = false, clubSlugs = null, log = () => {} } = opts
  const targets = clubSlugs
    ? CLUBS.filter(c => clubSlugs.map(s => s.toLowerCase()).includes(c.slug))
    : CLUBS
  if (targets.length === 0) {
    throw new Error(`No matching clubs for slugs: ${JSON.stringify(clubSlugs)}`)
  }

  const XLSX = require('xlsx')
  const workbook = XLSX.utils.book_new()
  const totals = {}

  for (const club of targets) {
    log(`fetching ${club.name}...`)
    let employees
    try {
      employees = await fetchEmployees(club.clubNumber)
    } catch (err) {
      totals[club.name] = `ERROR: ${err.message}`
      const errSheet = XLSX.utils.aoa_to_sheet([['Error fetching from ABC:', err.message]])
      XLSX.utils.book_append_sheet(workbook, errSheet, club.name)
      continue
    }

    let rows = employees.map(toRow)
    if (activeOnly) {
      rows = rows.filter(r => r['ABC Status'].toLowerCase() === 'active')
    }
    rows = sortByName(rows)
    totals[club.name] = rows.length

    const sheet = XLSX.utils.json_to_sheet(rows, { header: COLUMNS })
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
  }

  // Prepend an Instructions tab so it's the leftmost (first) sheet managers see.
  const instructionSheet = XLSX.utils.aoa_to_sheet(
    instructionsRows(new Date().toISOString().slice(0, 10))
  )
  instructionSheet['!cols'] = [{ wch: 80 }]
  XLSX.utils.book_append_sheet(workbook, instructionSheet, 'Instructions')
  const sheetNames = workbook.SheetNames
  const idx = sheetNames.indexOf('Instructions')
  if (idx > 0) {
    sheetNames.splice(idx, 1)
    sheetNames.unshift('Instructions')
  }

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  return { buffer, totals }
}

module.exports = {
  CLUBS,
  COLUMNS,
  toRow,
  sortByName,
  fetchEmployees,
  buildRoster,
}
