const test = require('node:test')
const assert = require('node:assert')
const { buildAudits, auditKey, isEnabled, auditCycleMonth, STALE_DAYS, CYCLE_SPLIT_DAY } = require('./auditsAnalytics')

const r = (department, slug, submitted_date, score_pct) => ({
  department, location_slug: slug, submitted_date, score_pct,
})

const TODAY = '2026-08-28'
const opts = (over = {}) => ({ start: '2026-01-01', end: TODAY, today: TODAY, ...over })

test('never audited is distinguished from not audited lately', () => {
  // Only one of these can be fixed by waiting, so they must not be one bucket.
  const out = buildAudits([
    r('PT Audit', 'salem', '2026-08-01', 80),
    r('PT Audit', 'keizer', '2026-01-05', 90),
  ], opts({ clubs: ['salem', 'keizer', 'milwaukie'] }))

  const cells = out.grid[0].cells
  const milwaukie = cells.find(c => c.slug === 'milwaukie')
  const keizer = cells.find(c => c.slug === 'keizer')

  assert.equal(milwaukie.everAudited, false)
  assert.equal(keizer.everAudited, true)
  assert.equal(keizer.stale, true)         // January is well past the threshold
  assert.equal(out.gaps.length, 1)
  assert.equal(out.stale.length, 1)
})

test('staleness is measured from the last audit EVER, not the last in window', () => {
  // A club with no audit in the window and one with none for a year are
  // different facts. A windowed query reports both as absence.
  const out = buildAudits([
    r('PT Audit', 'salem', '2025-06-01', 70),   // outside the window
  ], opts({ clubs: ['salem'] }))

  const cell = out.grid[0].cells[0]
  assert.equal(cell.everAudited, true)
  assert.equal(cell.lastDate, '2025-06-01')
  assert.equal(cell.submissions, 0)            // none in window
  assert.ok(cell.daysStale > 400)
})

test('a recent audit is not stale', () => {
  const out = buildAudits([r('PT Audit', 'salem', '2026-08-20', 88)], opts({ clubs: ['salem'] }))
  const cell = out.grid[0].cells[0]
  assert.equal(cell.stale, false)
  assert.equal(cell.daysStale, 8)
  assert.deepEqual(out.stale, [])
})

test('the threshold boundary is not stale until it is passed', () => {
  const exactly = new Date(Date.parse(TODAY) - STALE_DAYS * 86400000).toISOString().slice(0, 10)
  const out = buildAudits([r('PT Audit', 'salem', exactly, 88)], opts({ clubs: ['salem'] }))
  assert.equal(out.grid[0].cells[0].daysStale, STALE_DAYS)
  assert.equal(out.grid[0].cells[0].stale, false)
})

test('coverage counts department/club pairs, not submissions', () => {
  // 2 departments x 2 clubs = 4 pairs; 3 covered.
  const out = buildAudits([
    r('PT Audit', 'salem', '2026-08-01', 80),
    r('PT Audit', 'keizer', '2026-08-01', 80),
    r('Front Desk Audit', 'salem', '2026-08-01', 80),
  ], opts({ clubs: ['salem', 'keizer'] }))

  assert.equal(out.summary.gaps, 1)
  assert.equal(out.summary.coverage, 75)
})

test('small samples are flagged rather than silently ranked', () => {
  // A club with one audit at 95% must not be presented as beating one with six
  // averaging 90%.
  const out = buildAudits([
    r('PT Audit', 'milwaukie', '2026-08-27', 95),
    ...Array.from({ length: 6 }, (_, i) => r('PT Audit', 'salem', `2026-08-0${i + 1}`, 90)),
  ], opts({ clubs: ['milwaukie', 'salem'] }))

  const mil = out.byClub.find(c => c.key === 'milwaukie')
  const sal = out.byClub.find(c => c.key === 'salem')
  assert.equal(mil.rankable, false)
  assert.equal(sal.rankable, true)
  assert.equal(mil.submissions, 1)
})

test('averages ignore missing scores instead of scoring them zero', () => {
  const out = buildAudits([
    r('PT Audit', 'salem', '2026-08-01', 80),
    r('PT Audit', 'salem', '2026-08-02', null),
  ], opts({ clubs: ['salem'] }))
  assert.equal(out.summary.avgScore, 80)
  // The submission still counts as having happened.
  assert.equal(out.summary.submissions, 2)
})

test('the window filters submissions but never the department list', () => {
  const out = buildAudits([
    r('PT Audit', 'salem', '2026-08-01', 80),
    r('Childcare Audit', 'salem', '2024-01-01', 60),
  ], opts({ clubs: ['salem'] }))

  // Childcare has no submission in the window but is still a row in the grid,
  // otherwise a department nobody audits would vanish from the report entirely.
  assert.equal(out.departments.length, 2)
  assert.equal(out.grid.length, 2)
})

test('the trend is monthly, ordered, and carries its sample count', () => {
  const out = buildAudits([
    r('PT Audit', 'salem', '2026-08-26', 80),
    r('PT Audit', 'salem', '2026-08-28', 90),
    r('PT Audit', 'salem', '2026-07-26', 70),
  ], opts({ clubs: ['salem'] }))

  assert.deepEqual(out.months.map(m => m.month), ['2026-07-01', '2026-08-01'])
  assert.equal(out.months[1].avgScore, 85)
  assert.equal(out.months[1].submissions, 2)
})

test('an empty table produces no rates and no false alarms', () => {
  const out = buildAudits([], opts({ clubs: ['salem'] }))
  assert.equal(out.summary.avgScore, null)
  assert.equal(out.summary.submissions, 0)
  assert.equal(out.notes.coverage, null)
})


// --- audits are switched on per club in Admin -----------------------------
//
// `audit_off_<department>_<slug>` = '1' means the pair does not apply. A club
// with no childcare room is not failing to audit its childcare room.

test('the settings key matches the admin toggles exactly', () => {
  // A mismatch here silently ignores every toggle rather than failing loudly,
  // so it is pinned. These are the AUDITS keys in AuditTogglesAdmin.jsx.
  assert.equal(auditKey('Front Desk Audit'), 'front_desk_audit')
  assert.equal(auditKey('PT Audit'), 'pt_audit')
  assert.equal(auditKey('Membership Coordinator Audit'), 'membership_coordinator_audit')
  assert.equal(auditKey('Group X Audit'), 'group_x_audit')
  assert.equal(auditKey('Childcare Audit'), 'childcare_audit')
})

test('isEnabled defaults to on when nothing is configured', () => {
  assert.equal(isEnabled(null, 'PT Audit', 'salem'), true)
  assert.equal(isEnabled({}, 'PT Audit', 'salem'), true)
  assert.equal(isEnabled({ audit_off_pt_audit_salem: '1' }, 'PT Audit', 'salem'), false)
  // Anything other than '1' is on, matching the admin screen's own semantics.
  assert.equal(isEnabled({ audit_off_pt_audit_salem: '' }, 'PT Audit', 'salem'), true)
})

test('a switched-off audit is NOT a gap', () => {
  // The whole point: counting these as missing coverage would invent work and
  // bury the pairs that genuinely are not being done.
  const out = buildAudits([
    r('Childcare Audit', 'eugene', '2026-08-01', 95),
  ], opts({
    clubs: ['eugene', 'salem'],
    toggles: { audit_off_childcare_audit_salem: '1' },
  }))

  assert.equal(out.gaps.length, 0)
  const salemCell = out.grid[0].cells.find(c => c.slug === 'salem')
  assert.equal(salemCell.enabled, false)
})

test('without the toggle, that same pair IS a gap', () => {
  const out = buildAudits([
    r('Childcare Audit', 'eugene', '2026-08-01', 95),
  ], opts({ clubs: ['eugene', 'salem'] }))
  assert.equal(out.gaps.length, 1)
  assert.equal(out.gaps[0].slug, 'salem')
})

test('a switched-off audit is never stale', () => {
  const out = buildAudits([
    r('PT Audit', 'salem', '2024-01-01', 70),
  ], opts({ clubs: ['salem'], toggles: { audit_off_pt_audit_salem: '1' } }))
  assert.deepEqual(out.stale, [])
})

test('coverage counts only the pairs that are supposed to happen', () => {
  // 1 department x 2 clubs, one switched off -> 1 expected pair, 1 covered.
  const out = buildAudits([
    r('PT Audit', 'eugene', '2026-08-01', 90),
  ], opts({ clubs: ['eugene', 'salem'], toggles: { audit_off_pt_audit_salem: '1' } }))
  assert.equal(out.summary.coverage, 100)
  assert.equal(out.summary.gaps, 0)
})

test('submissions for a switched-off pair do not move the averages', () => {
  const out = buildAudits([
    r('PT Audit', 'eugene', '2026-08-01', 90),
    r('PT Audit', 'salem', '2026-08-01', 10),
  ], opts({ clubs: ['eugene', 'salem'], toggles: { audit_off_pt_audit_salem: '1' } }))
  assert.equal(out.summary.avgScore, 90)
  assert.equal(out.byClub.find(c => c.key === 'salem'), undefined)
})

test('QA-Cleaning is not an audit and is excluded', () => {
  // It is scored into the same table and the admin toggle list does not carry
  // it, matching the old report.
  const out = buildAudits([
    r('QA-Cleaning', 'salem', '2026-08-01', 50),
    r('PT Audit', 'salem', '2026-08-01', 90),
  ], opts({ clubs: ['salem'] }))
  assert.deepEqual(out.departments, ['PT Audit'])
  assert.equal(out.summary.avgScore, 90)
})

// --- the trailing-year, per-department trend -------------------------------
//
// Audits run about monthly per department per club, so a month's "average" is
// one or two readings and lurches on a single low score. A year with one line
// per department shows the real direction.

test('the trend spans a full year regardless of the selected window', () => {
  const out = buildAudits([r('PT Audit', 'salem', '2026-08-01', 80)], opts({ clubs: ['salem'] }))
  assert.equal(out.trendMonths.length, 12)
  assert.equal(out.trendMonths[11], '2026-08-01')
  assert.equal(out.trendMonths[0], '2025-09-01')
})

test('a month with no audit is a gap, never a zero', () => {
  // Joining across it would draw a dive that never happened.
  const out = buildAudits([
    r('PT Audit', 'salem', '2026-08-26', 80),
    r('PT Audit', 'salem', '2026-06-26', 90),
  ], opts({ clubs: ['salem'] }))

  const pt = out.trendSeries.find(x => x.key === 'PT Audit')
  const july = pt.points.find(p => p.month === '2026-07-01')
  assert.equal(july.value, null)
  assert.notEqual(july.value, 0)
})

test('several clubs average into ONE line per department', () => {
  const out = buildAudits([
    r('PT Audit', 'salem', '2026-08-26', 70),
    r('PT Audit', 'eugene', '2026-08-30', 90),
  ], opts({ clubs: ['salem', 'eugene'] }))

  const pt = out.trendSeries.find(x => x.key === 'PT Audit')
  const aug = pt.points.find(p => p.month === '2026-08-01')
  assert.equal(aug.value, 80)      // mean of the clubs audited that month
  assert.equal(aug.samples, 2)
  assert.equal(out.trendSeries.length, 1)
})

test('a department with no audit all year is not drawn as an empty line', () => {
  const out = buildAudits([
    r('PT Audit', 'salem', '2026-08-01', 80),
    r('Childcare Audit', 'salem', '2020-01-01', 60),
  ], opts({ clubs: ['salem'] }))
  assert.deepEqual(out.trendSeries.map(x => x.key), ['PT Audit'])
})

test('switched-off pairs stay out of the trend too', () => {
  const out = buildAudits([
    r('PT Audit', 'salem', '2026-08-26', 10),
    r('PT Audit', 'eugene', '2026-08-26', 90),
  ], opts({ clubs: ['salem', 'eugene'], toggles: { audit_off_pt_audit_salem: '1' } }))

  const pt = out.trendSeries.find(x => x.key === 'PT Audit')
  assert.equal(pt.points.find(p => p.month === '2026-08-01').value, 90)
})

test('the latest submission is carried so the cell can open its report', () => {
  const out = buildAudits([
    { department: 'PT Audit', location_slug: 'salem', submitted_date: '2026-08-01',
      score_pct: 80, id: 'newer', report_url: 'https://example.test/b' },
    { department: 'PT Audit', location_slug: 'salem', submitted_date: '2026-07-01',
      score_pct: 70, id: 'older', report_url: 'https://example.test/a' },
  ], opts({ clubs: ['salem'] }))

  const cell = out.grid[0].cells[0]
  assert.equal(cell.lastId, 'newer')
  assert.equal(cell.lastReportUrl, 'https://example.test/b')
})

// --- an audit belongs to its cycle, not its calendar month -----------------
//
// The window runs about the 25th to the 5th of the next month, so a submission
// on 3 September is September's date and August's audit. Bucketing on the raw
// date gave August two audits and September none.

test('a submission early in the month counts for the previous month', () => {
  assert.equal(auditCycleMonth('2026-09-03'), '2026-08-01')
  assert.equal(auditCycleMonth('2026-09-01'), '2026-08-01')
  assert.equal(auditCycleMonth('2026-09-05'), '2026-08-01')
})

test('a submission in the audit window counts for its own month', () => {
  assert.equal(auditCycleMonth('2026-08-25'), '2026-08-01')
  assert.equal(auditCycleMonth('2026-08-31'), '2026-08-01')
  assert.equal(auditCycleMonth('2026-08-24'), '2026-08-01')
})

test('the split sits in the empty gap, not on the exact boundary', () => {
  // The window is "something like" the 25th to the 5th. A rule that only worked
  // if that were exact would break the first time somebody filed on the 7th.
  assert.equal(auditCycleMonth('2026-09-06'), '2026-08-01')
  assert.equal(auditCycleMonth('2026-09-10'), '2026-08-01')
  assert.equal(auditCycleMonth(`2026-09-${CYCLE_SPLIT_DAY}`), '2026-08-01')
  assert.equal(auditCycleMonth('2026-09-16'), '2026-09-01')
})

test('the year boundary does not produce month zero', () => {
  // Naive month arithmetic on 3 January underflows; shifting the date does not.
  assert.equal(auditCycleMonth('2026-01-03'), '2025-12-01')
  assert.equal(auditCycleMonth('2026-01-28'), '2026-01-01')
})

test('a bad or missing date yields null rather than a bogus month', () => {
  assert.equal(auditCycleMonth(null), null)
  assert.equal(auditCycleMonth(''), null)
  assert.equal(auditCycleMonth('not a date'), null)
})

test('the spillover audit lands in the same trend point as its cycle', () => {
  // One club audited on 26 August, another on 3 September. Same cycle, so one
  // point averaging both — not August=x and September=y.
  const out = buildAudits([
    r('PT Audit', 'salem', '2026-08-26', 70),
    r('PT Audit', 'eugene', '2026-09-03', 90),
  ], opts({ clubs: ['salem', 'eugene'], end: '2026-09-30', today: '2026-09-30' }))

  const pt = out.trendSeries.find(x => x.key === 'PT Audit')
  const aug = pt.points.find(p => p.month === '2026-08-01')
  const sep = pt.points.find(p => p.month === '2026-09-01')

  assert.equal(aug.value, 80)
  assert.equal(aug.samples, 2)
  // September must be empty, not a second reading of the same cycle.
  assert.equal(sep.value, null)
})

test('staleness still measures from the real submission date', () => {
  // Which cycle it counted for is a different question from how long ago it
  // actually happened.
  const out = buildAudits([r('PT Audit', 'salem', '2026-09-03', 90)],
    opts({ end: '2026-09-30', today: '2026-09-10', clubs: ['salem'] }))
  assert.equal(out.grid[0].cells[0].lastDate, '2026-09-03')
  assert.equal(out.grid[0].cells[0].daysStale, 7)
})

// --- the early history is a backfill, not a record -------------------------
//
// Everything before June 2026 came from a one-off PDF import covering one to
// four clubs a month; November 2025 and January 2026 have no rows at all. A gap
// there means "not backfilled", not "not audited".

const sourced = (dept, slug, date, score, source) => ({
  ...r(dept, slug, date, score), source,
})

test('a trend reaching into the backfill era says so', () => {
  const out = buildAudits([
    sourced('PT Audit', 'salem', '2025-12-30', 85, 'pdf_backfill'),
    sourced('PT Audit', 'salem', '2026-06-26', 90, 'email'),
  ], opts({ clubs: ['salem'], end: '2026-08-28', today: '2026-08-28' }))

  assert.equal(out.firstLiveMonth, '2026-06-01')
  assert.match(out.notes.history, /2026-06/)
  assert.match(out.notes.history, /not backfilled, not that it was not done/)
})

test('the warning tracks the CHART, not the selected window', () => {
  // The trend always spans a trailing year, so it keeps showing backfill months
  // regardless of the date filter — and the caveat has to stay up while those
  // months are on screen, not disappear because the picker moved.
  const out = buildAudits([
    sourced('PT Audit', 'salem', '2026-06-26', 90, 'email'),
    sourced('PT Audit', 'salem', '2026-07-26', 92, 'email'),
  ], opts({ clubs: ['salem'], start: '2026-07-01', end: '2026-07-31', today: '2026-07-31' }))

  assert.equal(out.firstLiveMonth, '2026-06-01')
  assert.ok(out.trendMonths[0] < out.firstLiveMonth)
  assert.match(out.notes.history, /not backfilled/)
})

test('once the whole trend sits in the live era the warning stops', () => {
  // A year after the email feed started, nothing on the chart is backfill and
  // the caveat retires itself rather than nagging for ever.
  const out = buildAudits([
    sourced('PT Audit', 'salem', '2026-06-26', 90, 'email'),
    sourced('PT Audit', 'salem', '2027-07-26', 92, 'email'),
  ], opts({ clubs: ['salem'], start: '2027-07-01', end: '2027-07-31', today: '2027-07-31' }))

  assert.equal(out.firstLiveMonth, '2026-06-01')
  assert.ok(out.trendMonths[0] >= out.firstLiveMonth)
  assert.equal(out.notes.history, null)
})

test('with no emailed audits at all there is no boundary to claim', () => {
  const out = buildAudits([
    sourced('PT Audit', 'salem', '2026-02-25', 80, 'pdf_backfill'),
  ], opts({ clubs: ['salem'] }))
  assert.equal(out.firstLiveMonth, null)
  assert.equal(out.notes.history, null)
})

test('the boundary is the earliest emailed audit, not the earliest audit', () => {
  const out = buildAudits([
    sourced('PT Audit', 'salem', '2025-10-31', 70, 'pdf_backfill'),
    sourced('PT Audit', 'salem', '2026-07-26', 90, 'email'),
    sourced('PT Audit', 'eugene', '2026-06-26', 88, 'email'),
  ], opts({ clubs: ['salem', 'eugene'], end: '2026-08-28', today: '2026-08-28' }))
  assert.equal(out.firstLiveMonth, '2026-06-01')
})
