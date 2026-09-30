// abc-scraper.js is a sandboxed preload (only `electron` can be required), so
// its pure helpers can't be imported. Pull parseCelebration out of the source
// and test that instead.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, 'abc-scraper.js'), 'utf8')
const fnSrc = /function parseCelebration\([\s\S]*?\r?\n}\r?\n/.exec(src)[0]
const parseCelebration = new Function(fnSrc + 'return parseCelebration')()

test('reads the milestone from the ABC alert text', () => {
  assert.equal(parseCelebration('CELEBRATE 10TH VISIT!'), 10)
  assert.equal(parseCelebration('  celebrate 1000th visit '), 1000)
  assert.equal(parseCelebration('CELEBRATE 250TH VISIT!'), 250)
})

test('ignores every other alert', () => {
  assert.equal(parseCelebration('PAYMENT OVERDUE 12 DAYS'), null)
  assert.equal(parseCelebration('PASS ACTIVE TO 09-04'), null)
  assert.equal(parseCelebration('NEW PROFILE'), null)
  assert.equal(parseCelebration(''), null)
  assert.equal(parseCelebration(null), null)
})

test('celebration alerts never trigger the purple staff-alert lookup', () => {
  assert.match(src, /const SYSTEM_ALERT_RE = \/[^\n]*celebrate/)
})

test('alert-sound accepts the party level', () => {
  const sound = fs.readFileSync(path.join(__dirname, 'alert-sound.js'), 'utf8')
  assert.match(sound, /\['red', 'blue', 'blue-double', 'party'\]/)
  assert.match(sound, /level === 'party'/)
})
