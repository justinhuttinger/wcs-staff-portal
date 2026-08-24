// node --test auth/src/services/meetingGoals/tiptap.test.js
'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { buildGoalsDoc, hashDoc, longDate } = require('./tiptap')
const { WEEKS_KEPT } = require('./config')

const entry = (week_start, plans, submitted_by = 'Ryan Harris') =>
  ({ week_start, submitted_by, action_plans: plans })

test('longDate reads the weekday without a timezone in play', () => {
  assert.equal(longDate('2026-08-24'), 'Monday, August 24')
  assert.equal(longDate('2026-01-01'), 'Thursday, January 1')
})

test('buildGoalsDoc puts the newest week first', () => {
  const doc = buildGoalsDoc([
    entry('2026-08-17', ['older']),
    entry('2026-08-24', ['newer']),
  ])
  const text = JSON.stringify(doc)
  assert.ok(text.indexOf('newer') < text.indexOf('older'))
  assert.equal(doc.content[0].content[0].text, 'Week of Monday, August 24')
})

test('buildGoalsDoc renders header, attribution and bullets', () => {
  const doc = buildGoalsDoc([entry('2026-08-24', ['first thing', 'second thing'])])
  assert.equal(doc.type, 'doc')
  assert.equal(doc.content[0].content[0].marks[0].type, 'bold')
  assert.equal(doc.content[1].content[0].text, 'Submitted by Ryan Harris')
  const list = doc.content[2]
  assert.equal(list.type, 'bulletList')
  assert.equal(list.content.length, 2)
  assert.equal(list.content[0].content[0].content[0].text, 'first thing')
})

test('buildGoalsDoc separates weeks with a rule but does not lead with one', () => {
  const doc = buildGoalsDoc([entry('2026-08-24', ['a']), entry('2026-08-17', ['b'])])
  assert.notEqual(doc.content[0].type, 'horizontalRule')
  assert.equal(doc.content.filter((n) => n.type === 'horizontalRule').length, 1)
})

test('buildGoalsDoc omits weeks with no action plans entirely', () => {
  const doc = buildGoalsDoc([
    entry('2026-08-24', ['kept']),
    entry('2026-08-17', []),
  ])
  const text = JSON.stringify(doc)
  assert.ok(text.includes('kept'))
  assert.ok(!text.includes('August 17'))
  assert.equal(doc.content.filter((n) => n.type === 'horizontalRule').length, 0)
})

test('buildGoalsDoc trims to the kept window', () => {
  const many = []
  for (let i = 0; i < WEEKS_KEPT + 5; i++) {
    const day = String(3 + i).padStart(2, '0') // 2026-08-03 is a Monday
    many.push(entry(`2026-08-${day}`, [`week ${i}`]))
  }
  const doc = buildGoalsDoc(many)
  const headers = doc.content.filter((n) =>
    n.type === 'paragraph' && n.content[0].marks?.[0]?.type === 'bold')
  assert.equal(headers.length, WEEKS_KEPT)
})

test('buildGoalsDoc gives an empty article an explanatory line, not a blank doc', () => {
  const doc = buildGoalsDoc([])
  assert.equal(doc.type, 'doc')
  assert.equal(doc.content.length, 1)
  assert.ok(doc.content[0].content[0].text.includes('No action plans recorded yet'))
})

test('buildGoalsDoc omits attribution when nobody is recorded', () => {
  const doc = buildGoalsDoc([entry('2026-08-24', ['a'], null)])
  assert.equal(doc.content[1].type, 'bulletList')
})

test('hashDoc is stable for equal docs and differs for changed ones', () => {
  const a = buildGoalsDoc([entry('2026-08-24', ['same'])])
  const b = buildGoalsDoc([entry('2026-08-24', ['same'])])
  const c = buildGoalsDoc([entry('2026-08-24', ['different'])])
  assert.equal(hashDoc(a), hashDoc(b))
  assert.notEqual(hashDoc(a), hashDoc(c))
})
