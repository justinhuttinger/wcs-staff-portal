// Pure shaping for Analytics > Audits. No I/O; the route fetches.
//
// Audits are QA submissions in operandio_qa_reports — six departments across
// seven clubs, 173 submissions all time. That scarcity is the defining fact and
// drives every decision below.
//
// THE SCORES ARE NOT THE STORY. COVERAGE IS. Most clubs sit between 74% and
// 97%, a band narrow enough that ranking on it is mostly noise at these sample
// sizes. What the data actually shows is who is not being audited at all:
// Milwaukie has TWO audits in its entire history, Salem has never had a
// Childcare or Group X audit, and several clubs were last audited in July.
//
// An average cannot say any of that, so the report leads with the department x
// club grid and names the gaps and the stale cells explicitly.
//
// SAMPLE SIZES TRAVEL WITH AVERAGES EVERYWHERE. An average of three
// submissions and an average of seven are not comparable, and a club with one
// audit at 80% must never outrank one with six averaging 79%.
//
// AUDITS ARE SWITCHED ON PER CLUB IN ADMIN, AND A SWITCHED-OFF AUDIT IS NOT A
// GAP. Settings carry `audit_off_<department>_<slug>` = '1' for every pair that
// does not apply — a club with no childcare room is not failing to audit its
// childcare room. Counting those as missing coverage would invent work and bury
// the pairs that genuinely are not being done. Disabled cells are marked and
// excluded from gaps, staleness and the coverage figure alike.
//
// THE TREND IS A YEAR, ONE LINE PER DEPARTMENT, NOT A MONTHLY AVERAGE.
// Audits run about once a month per department per club, so a monthly average
// is one or two readings — it moves violently on a single 78% and says nothing
// about direction. A trailing twelve months with a line per department shows
// the actual change, and when several clubs are selected each point is the mean
// across the clubs audited that month.
//
// ONLY DEPARTMENTS MATCHING /audit/i ARE INCLUDED. QA-Cleaning is scored into
// the same table and is not an audit; the admin toggle list does not carry it
// either.

// A cell older than this is reported as stale. Audits run roughly monthly, so
// two months without one is a missed cycle rather than a slow week.
const STALE_DAYS = 60

// Below this an average is shown but never ranked on: it is a reading, not a
// rate.
const MIN_SAMPLE_TO_RANK = 3

// A year. Long enough that a roughly-monthly audit draws a real shape.
const TREND_MONTHS = 12

/**
 * Settings key fragment for a department.
 *
 * MUST match auditKey() in AuditsReport.jsx and the AUDITS keys in
 * AuditTogglesAdmin.jsx: lowercased, non-alphanumerics collapsed to single
 * underscores, trimmed. "Front Desk Audit" -> "front_desk_audit". A mismatch
 * here silently ignores every toggle rather than failing loudly.
 */
function auditKey(department) {
  return (department || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Is this audit switched on for this club? */
function isEnabled(toggles, department, slug) {
  if (!toggles) return true
  return toggles[`audit_off_${auditKey(department)}_${slug}`] !== '1'
}

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function avg(values) {
  const xs = values.filter(v => Number.isFinite(v))
  if (xs.length === 0) return null
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
}

function daysBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const a = Date.parse(fromIso)
  const b = Date.parse(toIso)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.floor((b - a) / 86_400_000)
}

/**
 * @param rows   operandio_qa_reports rows (all time, for staleness)
 * @param opts   { start, end, clubs, today, toggles }
 *
 * `rows` is deliberately the WHOLE table rather than the window. Staleness is a
 * question about the last audit ever, not the last audit inside the filter — a
 * club with no audit in the window and none for a year are different facts, and
 * a windowed query reports both as absence.
 */
function buildAudits(rows, opts = {}) {
  // Audits only. QA-Cleaning shares the table and is not one.
  const all = (rows || []).filter(r => /audit/i.test(r.department || ''))
  const toggles = opts.toggles || {}
  const start = opts.start || null
  const end = opts.end || null
  const today = opts.today || new Date().toISOString().slice(0, 10)

  const inWindow = all.filter(r => {
    const d = r.submitted_date
    if (!d) return false
    if (start && d < start) return false
    if (end && d > end) return false
    return true
  })

  // Departments and clubs come from the data, not a hardcoded list, so a new
  // audit type appears without a code change.
  const departments = [...new Set(all.map(r => r.department).filter(Boolean))].sort()
  const clubs = opts.clubs && opts.clubs.length
    ? opts.clubs.slice().sort()
    : [...new Set(all.map(r => r.location_slug).filter(Boolean))].sort()

  // --- the grid ------------------------------------------------------------
  const cellKey = (dept, slug) => `${dept}||${slug}`
  const cells = new Map()

  for (const r of all) {
    if (!r.department || !r.location_slug) continue
    const k = cellKey(r.department, r.location_slug)
    const cur = cells.get(k) || {
      department: r.department, slug: r.location_slug,
      submissions: 0, windowScores: [], lastDate: null, lastScore: null,
      lastId: null, lastReportUrl: null,
    }
    if (r.submitted_date && (!cur.lastDate || r.submitted_date > cur.lastDate)) {
      cur.lastDate = r.submitted_date
      cur.lastScore = r.score_pct === null || r.score_pct === undefined ? null : num(r.score_pct)
      // Carried so the grid cell can open the full report, the same way the old
      // Audits report did. openAuditReport needs the id and falls back to the
      // stored URL when the detail fetch comes back empty.
      cur.lastId = r.id || null
      cur.lastReportUrl = r.report_url || null
    }
    cells.set(k, cur)
  }
  for (const r of inWindow) {
    if (!r.department || !r.location_slug) continue
    const cur = cells.get(cellKey(r.department, r.location_slug))
    if (!cur) continue
    cur.submissions += 1
    if (r.score_pct !== null && r.score_pct !== undefined) cur.windowScores.push(num(r.score_pct))
  }

  const grid = departments.map(dept => ({
    department: dept,
    cells: clubs.map(slug => {
      const c = cells.get(cellKey(dept, slug))
      const enabled = isEnabled(toggles, dept, slug)
      if (!enabled) {
        // Switched off in Admin. Not a gap, not stale, not counted anywhere —
        // this pair is not supposed to happen.
        return { slug, enabled: false, everAudited: !!c, submissions: 0, avgScore: null, lastDate: c ? c.lastDate : null, lastScore: null, daysStale: null, stale: false, lastId: null, lastReportUrl: null }
      }
      if (!c) {
        // Never audited. Distinct from "not audited lately", and the only one
        // of the two that cannot be fixed by waiting.
        return { slug, enabled: true, everAudited: false, submissions: 0, avgScore: null, lastDate: null, lastScore: null, daysStale: null, stale: false, lastId: null, lastReportUrl: null }
      }
      const daysStale = daysBetween(c.lastDate, today)
      return {
        slug,
        enabled: true,
        everAudited: true,
        submissions: c.submissions,
        avgScore: avg(c.windowScores),
        lastDate: c.lastDate,
        lastScore: c.lastScore,
        lastId: c.lastId,
        lastReportUrl: c.lastReportUrl,
        daysStale,
        stale: daysStale !== null && daysStale > STALE_DAYS,
      }
    }),
  }))

  const flatCells = grid.flatMap(g => g.cells.map(c => ({ ...c, department: g.department })))
  const gaps = flatCells.filter(c => c.enabled && !c.everAudited)
  const stale = flatCells.filter(c => c.enabled && c.everAudited && c.stale)
    .sort((a, b) => (b.daysStale ?? 0) - (a.daysStale ?? 0))

  // --- rollups -------------------------------------------------------------
  const roll = (keyFn) => {
    const m = new Map()
    for (const r of inWindow) {
      if (!isEnabled(toggles, r.department, r.location_slug)) continue
      const k = keyFn(r)
      if (!k) continue
      const cur = m.get(k) || { key: k, scores: [], submissions: 0 }
      cur.submissions += 1
      if (r.score_pct !== null && r.score_pct !== undefined) cur.scores.push(num(r.score_pct))
      m.set(k, cur)
    }
    return [...m.values()]
      .map(x => ({
        key: x.key,
        submissions: x.submissions,
        avgScore: avg(x.scores),
        // Ranking on three submissions is mostly noise; the flag lets the UI
        // show the number without implying it is a league table.
        rankable: x.scores.length >= MIN_SAMPLE_TO_RANK,
      }))
      .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1))
  }

  const byDepartment = roll(r => r.department)
  const byClub = roll(r => r.location_slug)

  // --- trend ---------------------------------------------------------------
  //
  // A TRAILING YEAR, ONE SERIES PER DEPARTMENT, IGNORING THE SELECTED WINDOW.
  // Audits happen about monthly, so a month-to-date selection would draw one
  // point per department and a month with no audit would read as a collapse to
  // zero rather than as "not audited yet".
  //
  // Every month in the year is emitted even when empty, so gaps stay gaps: the
  // chart breaks the line rather than joining across a month nobody audited.
  const trendMonths = []
  {
    const anchor = end ? new Date(`${end}T00:00:00Z`) : new Date()
    anchor.setUTCDate(1)
    for (let i = TREND_MONTHS - 1; i >= 0; i--) {
      const d = new Date(anchor)
      d.setUTCMonth(d.getUTCMonth() - i)
      trendMonths.push(d.toISOString().slice(0, 8) + '01')
    }
  }
  const firstTrendMonth = trendMonths[0]

  const trendBucket = new Map()
  for (const r of all) {
    if (!r.submitted_date || !r.department || !r.location_slug) continue
    if (!isEnabled(toggles, r.department, r.location_slug)) continue
    if (clubs.length && !clubs.includes(r.location_slug)) continue
    const month = `${r.submitted_date.slice(0, 7)}-01`
    if (month < firstTrendMonth) continue
    if (r.score_pct === null || r.score_pct === undefined) continue
    const k = `${r.department}||${month}`
    if (!trendBucket.has(k)) trendBucket.set(k, [])
    // Averaged across whichever clubs were audited that month, so selecting
    // several clubs gives one line per department rather than one per pair.
    trendBucket.get(k).push(num(r.score_pct))
  }

  const trendSeries = departments.map(dept => ({
    key: dept,
    label: dept,
    points: trendMonths.map(month => {
      const scores = trendBucket.get(`${dept}||${month}`)
      return { month, value: scores && scores.length ? avg(scores) : null, samples: scores ? scores.length : 0 }
    }),
  // A department with no audit anywhere in the year is not drawn at all rather
  // than as a flat empty line.
  })).filter(sr => sr.points.some(pt => pt.value !== null))

  // Kept for the table view, which is a list of what happened rather than a
  // shape over time.
  const monthMap = new Map()
  for (const r of inWindow) {
    if (!r.submitted_date) continue
    if (!isEnabled(toggles, r.department, r.location_slug)) continue
    const month = `${r.submitted_date.slice(0, 7)}-01`
    const cur = monthMap.get(month) || { month, scores: [], submissions: 0 }
    cur.submissions += 1
    if (r.score_pct !== null && r.score_pct !== undefined) cur.scores.push(num(r.score_pct))
    monthMap.set(month, cur)
  }
  const months = [...monthMap.values()]
    .map(m => ({ month: m.month, avgScore: avg(m.scores), submissions: m.submissions }))
    .sort((a, b) => a.month.localeCompare(b.month))

  // Switched-off pairs are excluded here too. A club audited on a department
  // that was later turned off would otherwise keep dragging the company average
  // for work nobody expects it to do.
  const countedInWindow = inWindow.filter(
    x => isEnabled(toggles, x.department, x.location_slug)
  )
  const windowScores = countedInWindow
    .filter(x => x.score_pct !== null && x.score_pct !== undefined)
    .map(x => num(x.score_pct))

  // Only the pairs that are supposed to happen. Counting switched-off ones
  // would report a club as under-covered for work it does not do.
  const expectedCells = flatCells.filter(c => c.enabled).length

  return {
    summary: {
      submissions: countedInWindow.length,
      avgScore: avg(windowScores),
      departments: departments.length,
      clubs: clubs.length,
      // The two numbers that actually drive action.
      gaps: gaps.length,
      stale: stale.length,
      coverage: expectedCells
        ? Math.round(((expectedCells - gaps.length) / expectedCells) * 1000) / 10
        : null,
    },
    departments,
    clubs,
    grid,
    gaps,
    stale,
    byDepartment,
    byClub,
    months,
    trendMonths,
    trendSeries,
    notes: {
      coverage: gaps.length === 0 && stale.length === 0 ? null
        : [
            gaps.length ? `${gaps.length} department/club pairs have never been audited.` : null,
            stale.length ? `${stale.length} have not been audited in over ${STALE_DAYS} days.` : null,
            'Scores sit in a narrow band, so who is being audited matters more than the average.',
          ].filter(Boolean).join(' '),
    },
  }
}

module.exports = { buildAudits, auditKey, isEnabled, STALE_DAYS, MIN_SAMPLE_TO_RANK, TREND_MONTHS }
