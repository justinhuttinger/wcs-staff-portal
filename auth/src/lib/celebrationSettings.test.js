const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
  DEFAULT_SETTINGS, parseSettings, validateSettings, isLifetimeMilestone,
  lifetimeText, ruleText, ruleLabel, MAX_TEXT,
} = require('./celebrationSettings')

const ABC_CHARS = /^[A-Z0-9 ,_!%+\-@^]+$/

test('the ghl-sync copy is identical (separate Render deployables)', () => {
  const here = fs.readFileSync(path.join(__dirname, 'celebrationSettings.js'), 'utf8')
  const there = fs.readFileSync(path.join(__dirname, '../../../ghl-sync/src/abc/celebrationSettings.js'), 'utf8')
  assert.equal(there.replace(/\r\n/g, '\n'), here.replace(/\r\n/g, '\n'))
})

test('defaults match the original hardcoded milestones', () => {
  const l = DEFAULT_SETTINGS.lifetime
  for (const n of [10, 25, 50, 100, 150, 200, 250, 300, 400, 1000]) assert.equal(isLifetimeMilestone(n, l), true, n)
  for (const n of [9, 11, 350, 0]) assert.equal(isLifetimeMilestone(n, l), false, n)
  assert.deepEqual(DEFAULT_SETTINGS.rules, [])
})

test('isLifetimeMilestone: custom list, repeat off, disabled', () => {
  assert.equal(isLifetimeMilestone(20, { enabled: true, milestones: [5, 20], repeatEvery: 0 }), true)
  assert.equal(isLifetimeMilestone(40, { enabled: true, milestones: [5, 20], repeatEvery: 0 }), false)
  assert.equal(isLifetimeMilestone(40, { enabled: true, milestones: [5, 20], repeatEvery: 10 }), true)
  assert.equal(isLifetimeMilestone(35, { enabled: true, milestones: [5, 20], repeatEvery: 10 }), false)
  assert.equal(isLifetimeMilestone(10, { enabled: false, milestones: [10], repeatEvery: 0 }), false)
})

test('texts fit ABC: 22 chars, allowed characters', () => {
  assert.equal(lifetimeText(10), 'CELEBRATE 10TH VISIT!')
  assert.equal(lifetimeText(1000), 'CELEBRATE 1000TH VISIT')
  assert.equal(lifetimeText(10000), null)
  assert.equal(lifetimeText(21), 'CELEBRATE 21ST VISIT!')
  assert.equal(lifetimeText(22), 'CELEBRATE 22ND VISIT!')
  assert.equal(lifetimeText(13), 'CELEBRATE 13TH VISIT!')
  assert.equal(lifetimeText(103), 'CELEBRATE 103RD VISIT!')
  assert.equal(ruleText({ type: 'rolling', visits: 12, days: 30 }), '12 VISITS IN 30 DAYS!')
  assert.equal(ruleText({ type: 'rolling', visits: 12, days: 365 }), '12 VISITS IN 365 DAYS!')
  assert.equal(ruleText({ type: 'rolling', visits: 100, days: 365 }), '100 VISITS IN 365 DAYS')
  assert.equal(ruleText({ type: 'new_member', visits: 8, days: 30 }), '8 IN FIRST 30 DAYS!')
  assert.equal(ruleText({ type: 'calendar_month', visits: 15 }), '15 VISITS THIS MONTH!')
  for (let v = 2; v <= 1000; v += 7) {
    for (const d of [1, 7, 30, 365]) {
      for (const type of ['rolling', 'new_member', 'calendar_month']) {
        const t = ruleText({ type, visits: v, days: d })
        if (t === null) continue
        assert.ok(t.length <= MAX_TEXT, t)
        assert.match(t, ABC_CHARS)
      }
    }
  }
})

test('ruleLabel: human wording for the admin page and the WCS ABC banner', () => {
  assert.equal(ruleLabel({ type: 'rolling', visits: 5, days: 7 }), '5 visits in 7 days')
  assert.equal(ruleLabel({ type: 'new_member', visits: 8, days: 30 }), '8 visits in first 30 days')
  assert.equal(ruleLabel({ type: 'calendar_month', visits: 15 }), '15 visits this month')
})

test('validateSettings: cleans and accepts a good payload', () => {
  const { settings, errors } = validateSettings({
    lifetime: { enabled: true, milestones: [50, '10', 10, 25], repeatEvery: '100' },
    rules: [{ type: 'rolling', visits: '12', days: '30', enabled: true }, { type: 'calendar_month', visits: 15, enabled: false }],
  })
  assert.deepEqual(errors, [])
  assert.deepEqual(settings.lifetime, { enabled: true, milestones: [10, 25, 50], repeatEvery: 100 })
  assert.equal(settings.rules.length, 2)
  assert.equal(settings.rules[0].visits, 12)
  assert.ok(settings.rules[0].id)
  assert.equal(settings.rules[1].days, null)
})

test('validateSettings: rejects bad input with readable errors', () => {
  const bad = (input) => validateSettings(input).errors
  assert.ok(bad({ lifetime: { milestones: [0] } }).length)
  assert.ok(bad({ lifetime: { milestones: [10, 'x'] } }).length)
  assert.ok(bad({ lifetime: { milestones: [10000] } }).length) // text too long
  assert.ok(bad({ lifetime: { milestones: [10], repeatEvery: -5 } }).length)
  assert.ok(bad({ rules: [{ type: 'weekly', visits: 3, days: 7 }] }).length)
  assert.ok(bad({ rules: [{ type: 'rolling', visits: 1, days: 7 }] }).length)
  assert.ok(bad({ rules: [{ type: 'rolling', visits: 5, days: 0 }] }).length)
  assert.ok(bad({ rules: [{ type: 'rolling', visits: 5, days: 400 }] }).length)
  assert.ok(bad({ rules: [
    { type: 'rolling', visits: 5, days: 7, enabled: true },
    { type: 'rolling', visits: 5, days: 7, enabled: true },
  ] }).length)
  assert.ok(bad({ rules: Array.from({ length: 21 }, (_, i) => ({ type: 'rolling', visits: i + 2, days: 30 })) }).length)
})

test('parseSettings: tolerant, never throws', () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(parseSettings('not json'), DEFAULT_SETTINGS)
  const saved = JSON.stringify({ lifetime: { enabled: true, milestones: [7], repeatEvery: 0 }, rules: [] })
  assert.deepEqual(parseSettings(saved).lifetime.milestones, [7])
  // Bad saved rules are dropped, good ones kept.
  const mixed = JSON.stringify({ lifetime: DEFAULT_SETTINGS.lifetime, rules: [{ type: 'rolling', visits: 5, days: 7 }, { type: 'nope' }] })
  assert.equal(parseSettings(mixed).rules.length, 1)
})
