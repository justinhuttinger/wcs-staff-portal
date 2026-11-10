const test = require('node:test')
const assert = require('node:assert')
const { AREAS, areaByKey, areaForCategories, filterWeekByArea } = require('./groupXAreas')

test('a type in the Ultimate category is on the Ultimate board', () => {
  assert.strictEqual(areaForCategories(['Ultimate']), 'ultimate')
  assert.strictEqual(areaForCategories([' ultimate ']), 'ultimate')
})

test('Group X, no category, and anything else stay on the Group X board', () => {
  assert.strictEqual(areaForCategories(['Group X']), 'groupx')
  assert.strictEqual(areaForCategories([]), 'groupx')
  assert.strictEqual(areaForCategories(undefined), 'groupx')
  assert.strictEqual(areaForCategories(['Cycling']), 'groupx')
})

test('areaByKey accepts the known keys only', () => {
  assert.strictEqual(areaByKey('ULTIMATE').key, 'ultimate')
  assert.strictEqual(areaByKey('groupx').label, 'Group X')
  assert.strictEqual(areaByKey('pool'), null)
  assert.strictEqual(areaByKey(undefined), null)
  assert.deepStrictEqual(AREAS.map(a => a.key), ['groupx', 'ultimate'])
})

test('filterWeekByArea narrows each day and leaves the cached week alone', () => {
  const week = {
    range_label: 'Nov 10 - 16',
    days: [
      { date: '2026-11-10', classes: [{ class_name: 'Yoga', area: 'groupx' }, { class_name: 'Ultimate Workout', area: 'ultimate' }] },
      { date: '2026-11-11', classes: [{ class_name: 'Old cache entry' }] },
    ],
  }
  const ult = filterWeekByArea(week, 'ultimate')
  assert.deepStrictEqual(ult.days.map(d => d.classes.map(c => c.class_name)), [['Ultimate Workout'], []])
  const gx = filterWeekByArea(week, 'groupx')
  assert.deepStrictEqual(gx.days.map(d => d.classes.map(c => c.class_name)), [['Yoga'], ['Old cache entry']])
  assert.strictEqual(ult.range_label, 'Nov 10 - 16')
  assert.strictEqual(week.days[0].classes.length, 2)
  assert.strictEqual(filterWeekByArea(week, null), week)
})
