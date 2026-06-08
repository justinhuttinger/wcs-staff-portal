// Pure parser: Operandio "Job Report" audit PDF text -> normalized record.
// Input is the text extracted by pdf-parse. Filenames are NOT used; the PDF
// body is authoritative. Produces the same shape the email pipeline writes to
// operandio_qa_reports (location_slug, job_name, department, score triple,
// items[{n,at,by,name,score}]) so the existing HTML viewer renders it.
//
// IMPORTANT: in the PDF the "Overall" row is "<achieved> <possible> <pct>%"
// (achieved first). We parse achieved-first and sanity-check against the
// printed percent, swapping only if the other orientation matches.

const { ALL_SLUGS } = require('../utils/locationSlug')

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

function isAuditDept(dept) {
  return /audit/i.test(dept || '')
}

// auditKey()-style slug used to canonicalize the department name and to match
// the Admin -> Audits toggle keys.
function deptKey(dept) {
  return (dept || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// Canonical display names for the known audit departments. Older Operandio
// exports print ALL-CAPS headers ("FRONT DESK AUDIT") while newer ones use
// title case; normalizing keeps the Audits report from splitting one department
// into multiple case-variant groups and matches the email pipeline's names. An
// unknown audit type falls back to its parsed (trimmed) header text.
const CANON_DEPT = {
  front_desk_audit: 'Front Desk Audit',
  pt_audit: 'PT Audit',
  membership_coordinator_audit: 'Membership Coordinator Audit',
  group_x_audit: 'Group X Audit',
  childcare_audit: 'Childcare Audit',
}

// "Jun 2, 2026" -> { iso: '2026-06-02', monthDay: 'Jun 2' }
function parseHeaderDate(s) {
  const m = (s || '').match(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/)
  if (!m) return null
  const mm = MONTHS[m[1]]
  if (!mm) return null
  return { iso: `${m[3]}-${mm}-${String(m[2]).padStart(2, '0')}`, monthDay: `${m[1]} ${m[2]}` }
}

// "11:36AM" -> "11:36"; "1:05PM" -> "13:05"
function to24h(hhmm) {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})([AP]M)$/i)
  if (!m) return '00:00'
  let h = parseInt(m[1], 10)
  const min = m[2]
  const pm = /pm/i.test(m[3])
  if (pm && h !== 12) h += 12
  if (!pm && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${min}`
}

function parseAuditPdfText(rawText) {
  if (!rawText || typeof rawText !== 'string') return { ok: false, reason: 'empty text' }
  // Normalize line endings so regexes (and \n-sensitive captures) behave the
  // same whether the source has LF or CRLF.
  const text = rawText.replace(/\r\n?/g, '\n')

  if (!/Job Report/i.test(text)) return { ok: false, reason: 'not a Job Report' }

  // Header line: "<Department> | <Location> | Submitted <Mon D, YYYY>"
  const header = text.match(/(?:^|\n)\s*([^\n|]+?)\s*\|\s*([A-Za-z .'-]+?)\s*\|\s*Submitted\s+([A-Z][a-z]{2} \d{1,2}, \d{4})/)
  if (!header) return { ok: false, reason: 'no job-report header line' }

  const rawDept = header[1].replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  if (!isAuditDept(rawDept)) return { ok: false, reason: `not an audit department: ${rawDept}` }
  const department = CANON_DEPT[deptKey(rawDept)] || rawDept

  const locationSlug = header[2].trim().toLowerCase()
  if (!ALL_SLUGS.includes(locationSlug)) return { ok: false, reason: `unknown location: ${header[2].trim()}` }

  // "Submitted Jun 2, 2026, 11:36AM PDT by Steve Vedder"
  const sub = text.match(/Submitted\s+([A-Z][a-z]{2} \d{1,2}, \d{4}),?\s+(\d{1,2}:\d{2}\s*[AP]M)\s+([A-Z]{2,4})\s+by\s+([^\n]+)/)
  if (!sub) return { ok: false, reason: 'no "Submitted ... by <name>" line (likely a blank/unsubmitted template)' }
  const dt = parseHeaderDate(sub[1])
  if (!dt) return { ok: false, reason: 'unparseable submitted date' }
  const submittedBy = sub[4].trim()
  // US timezones the auditor's device may report. submittedDate is read from the
  // printed date (not recomputed from the offset), so this only sets the stored
  // timestamp's offset. Truly unknown zones are skipped rather than guessed.
  const TZ_OFFSETS = {
    PST: '-08:00', PDT: '-07:00',
    MST: '-07:00', MDT: '-06:00',
    CST: '-06:00', CDT: '-05:00',
    EST: '-05:00', EDT: '-04:00',
  }
  const tzOffset = TZ_OFFSETS[sub[3]]
  if (!tzOffset) return { ok: false, reason: `unrecognized timezone: ${sub[3]}` }
  const time24 = to24h(sub[2].replace(/\s+/g, ''))
  const submittedAt = `${dt.iso}T${time24}:00${tzOffset}`
  const atLabel = `${sub[1]}, ${sub[2].replace(/\s+/g, '')} ${sub[3]}`

  // Overall score row: "Overall 54 55 98.2%" (achieved possible pct).
  const overall = text.match(/Overall\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)%/)
  if (!overall) return { ok: false, reason: 'no Overall score row' }
  let achieved = parseInt(overall[1], 10)
  let possible = parseInt(overall[2], 10)
  const printedPct = Math.round(parseFloat(overall[3]))
  if (possible > 0 && Math.round((achieved / possible) * 100) !== printedPct &&
      achieved > 0 && Math.round((possible / achieved) * 100) === printedPct) {
    const tmp = achieved
    achieved = possible
    possible = tmp
  }
  const scorePct = possible > 0 ? Math.round((achieved / possible) * 100) : printedPct

  // Scored section rows: "<name> <achieved> <possible> <pct>%". Non-scored rows
  // (Comments, Auditor Name:) print "-" and never match. Drop the Overall and
  // "This section" summary rows; de-dup by name.
  const rowRe = /([^\n]+?)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)%/g
  const seen = new Set()
  const items = []
  let m
  while ((m = rowRe.exec(text)) !== null) {
    const name = m[1].trim().replace(/^\d+\s+/, '')
    if (/^(Overall|This section|This job)$/i.test(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    items.push({ n: items.length + 1, at: atLabel, by: submittedBy, name, score: parseInt(m[2], 10) })
  }
  if (items.length === 0) return { ok: false, reason: 'no scored section rows' }

  return {
    ok: true,
    locationSlug,
    department,
    jobName: `${department} (${dt.monthDay})`,
    submittedDate: dt.iso,
    submittedAt,
    submittedBy,
    scoreAchieved: achieved,
    scorePossible: possible,
    scorePct,
    items,
  }
}

module.exports = { parseAuditPdfText }
