import test from 'node:test'
import assert from 'node:assert/strict'
import { bundleFromHtml, bundleFromUrl, shouldReload } from './autoUpdate.js'

const MIN = 60 * 1000

test('reads the hashed entry chunk out of the served HTML', () => {
  const html = '<script type="module" crossorigin src="/assets/tour-DurcuxOR.js"></script>'
  assert.equal(bundleFromHtml(html), 'tour-DurcuxOR.js')
})

test('ignores the preloaded chunks alongside it', () => {
  const html = `
    <script type="module" src="/assets/tour-AAA111.js"></script>
    <link rel="modulepreload" href="/assets/chunk-C_Lf2zpa.js">
    <link rel="modulepreload" href="/assets/src-HFBszFmB.js">`
  assert.equal(bundleFromHtml(html), 'tour-AAA111.js')
})

test('finds nothing in the dev entry, which disables the check', () => {
  assert.equal(bundleFromHtml('<script src="/src/tour/main.jsx"></script>'), null)
  assert.equal(bundleFromUrl('http://localhost:5173/src/tour/main.jsx'), null)
})

test('reads the running bundle off its own module URL', () => {
  assert.equal(bundleFromUrl('https://portal.wcstrength.com/assets/tour-DurcuxOR.js'), 'tour-DurcuxOR.js')
})

test('same bundle never reloads, however idle the desk is', () => {
  assert.equal(shouldReload({
    current: 'tour-AAA.js', deployed: 'tour-AAA.js', visible: false, msSinceInput: 60 * MIN,
  }), false)
})

test('a backgrounded iPad reloads immediately: there is no input to lose', () => {
  assert.equal(shouldReload({
    current: 'tour-AAA.js', deployed: 'tour-BBB.js', visible: false, msSinceInput: 0,
  }), true)
})

test('never reloads out from under someone who is mid-check-in', () => {
  assert.equal(shouldReload({
    current: 'tour-AAA.js', deployed: 'tour-BBB.js', visible: true, msSinceInput: 30 * 1000,
  }), false)
})

test('reloads once the desk has been quiet for five minutes', () => {
  assert.equal(shouldReload({
    current: 'tour-AAA.js', deployed: 'tour-BBB.js', visible: true, msSinceInput: 5 * MIN,
  }), true)
})

test('a failed HTML read is not treated as a new deploy', () => {
  assert.equal(shouldReload({
    current: 'tour-AAA.js', deployed: null, visible: false, msSinceInput: 60 * MIN,
  }), false)
})
