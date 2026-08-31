import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportOffKey, isReportVisible } from './analyticsReportCatalogue.js'

const ALL = ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']

test('the key matches what the admin screen writes', () => {
  assert.equal(reportOffKey('childcare', 'salem'), 'report_off_childcare_salem')
})

test('a report with no setting is visible', () => {
  // Absence of a setting is the safe state: a report that ships tomorrow is on
  // everywhere until somebody turns it off.
  assert.equal(isReportVisible({}, 'childcare', ALL), true)
  assert.equal(isReportVisible(null, 'childcare', ALL), true)
})

test('a report turned off at the selected club is hidden', () => {
  const s = { report_off_childcare_salem: '1' }
  assert.equal(isReportVisible(s, 'childcare', ['salem']), false)
  assert.equal(isReportVisible(s, 'childcare', ['keizer']), true)
})

test('with several clubs it shows if ANY of them has it on', () => {
  // Hiding it because one club has it off would take it from the others too.
  const s = { report_off_childcare_salem: '1' }
  assert.equal(isReportVisible(s, 'childcare', ['salem', 'keizer']), true)
})

test('selecting every club does not bypass the toggles', () => {
  // "All" must not mean "no filter": a report off EVERYWHERE stays hidden.
  const off = Object.fromEntries(ALL.map(c => [reportOffKey('childcare', c), '1']))
  assert.equal(isReportVisible(off, 'childcare', ALL), false)
  // But one club still on is enough to keep it.
  delete off.report_off_childcare_medford
  assert.equal(isReportVisible(off, 'childcare', ALL), true)
})

test('anything other than "1" counts as on', () => {
  // The admin screen writes '' to clear a toggle, matching the audit toggles.
  assert.equal(isReportVisible({ report_off_childcare_salem: '' }, 'childcare', ['salem']), true)
  assert.equal(isReportVisible({ report_off_childcare_salem: '0' }, 'childcare', ['salem']), true)
})

test('an empty club list shows everything rather than nothing', () => {
  // Before the location filter resolves there is nothing to evaluate against,
  // and a menu that starts empty looks broken.
  const off = { report_off_childcare_salem: '1' }
  assert.equal(isReportVisible(off, 'childcare', []), true)
  assert.equal(isReportVisible(off, 'childcare', undefined), true)
})

test('one report being off does not hide another', () => {
  const s = { report_off_childcare_salem: '1' }
  assert.equal(isReportVisible(s, 'payroll', ['salem']), true)
})
