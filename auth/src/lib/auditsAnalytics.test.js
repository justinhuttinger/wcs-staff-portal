const test = require('node:test')
const assert = require('node:assert')
const { buildAudits, auditKey, isEnabled, STALE_DAYS } = require('./auditsAnalytics')

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
    r('PT Audit', 'salem', '2026-08-01', 80),
    r('PT Audit', 'salem', '2026-08-15', 90),
    r('PT Audit', 'salem', '2026-07-10', 70),
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
