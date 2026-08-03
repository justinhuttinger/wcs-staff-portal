const test = require('node:test')
const assert = require('node:assert')
const { renderBoardHtml } = require('./groupXBoard')

// The board is one HTML document built from a Node template literal, so the
// client script is a string until a browser sees it. Nothing here type-checks
// it and no bundler touches it: these tests are the only thing standing between
// a typo and a blank board on seven walls.

const groupX = () => renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem' })

// Pull a function out of the EMITTED document and make it callable, so what is
// tested is what the browser actually receives rather than what the source says.
function emittedFn(html, name) {
  const start = html.indexOf('function ' + name + '(')
  assert.notStrictEqual(start, -1, `${name} missing from the emitted script`)
  let depth = 0
  let i = html.indexOf('{', start)
  const from = i
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}' && --depth === 0) break
  }
  const body = html.slice(from + 1, i)
  const args = html.slice(html.indexOf('(', start) + 1, html.indexOf(')', start))
  // eslint-disable-next-line no-new-func
  return new Function(args, body)
}

test('the emitted time regex still has its backslashes', () => {
  // A lone \d in a template literal is not an escape sequence, so it collapses
  // to a bare "d" on the way out and the browser gets /^(d{1,2}):(d{2})/, which
  // matches no time that has ever existed. That shipped: every class reported a
  // start of 0, which silently flattened the time-positioned layout and would
  // put the "on now" marker on the wrong card. Doubling the backslash in the
  // source is the fix; this is the guard.
  const startMinutes = emittedFn(groupX(), 'startMinutes')
  assert.strictEqual(startMinutes({ time: '09:30' }), 570)
  assert.strictEqual(startMinutes({ time: '5:00' }), 300)
  assert.strictEqual(startMinutes({ time: '16:30' }), 990)
  assert.strictEqual(startMinutes({ time: '00:00' }), 0)
  // Anything unparseable still has to be a number, not NaN, or the layout
  // arithmetic downstream turns into NaN flex weights.
  assert.strictEqual(startMinutes({}), 0)
  assert.strictEqual(startMinutes({ time: 'noon' }), 0)
})

test('cards carry the start and end the now-marker reads', () => {
  const html = groupX()
  assert.match(html, /data-start="' \+ startM \+ '" data-end="' \+ \(startM \+ \(c\.duration_minutes \|\| 60\)\)/)
  assert.ok(html.includes('<span class="badge badge--now">On now</span>'))
  // The badge is revealed by CSS, not JS, so the rule has to exist.
  assert.ok(html.includes('.cls--now .badge--now { display: inline-block; }'))
})

test('the clock reads the club timezone, not the viewer', () => {
  const html = groupX()
  // Both the day and the minute-of-day must come from the same zone, or a
  // phone in another state disagrees with the TV about what is on now.
  const zones = [...html.matchAll(/timeZone: '([^']+)'/g)].map(m => m[1])
  assert.ok(zones.length >= 3, `expected the week, the clock and the minutes to be zoned, saw ${zones.length}`)
  assert.deepStrictEqual([...new Set(zones)], ['America/Los_Angeles'])
})

test('empty days say so, in the words of the board they belong to', () => {
  assert.ok(groupX().includes('var EMPTY = "No classes"'))
  const courts = renderBoardHtml({
    clubSlug: 'springfield', clubName: 'Springfield', layout: 'fill',
    scheduleUrl: '/public/facility/schedule?facility=courts', emptyLabel: 'Nothing scheduled',
  })
  assert.ok(courts.includes('var EMPTY = "Nothing scheduled"'))
  // Today's column appends " today", so the label has to end a sentence.
  assert.ok(courts.includes(`(isToday ? ' today' : '')`))
})

test('embed mode drops the title block but keeps the week range', () => {
  const embed = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem', embed: true })
  // The .head__titles CSS rule ships either way; it is the markup that goes.
  assert.ok(!embed.includes('<div class="head__titles">'))
  assert.ok(embed.includes('id="range"'))
  assert.ok(embed.includes('id="now"'))
  assert.ok(groupX().includes('<div class="head__titles">'))
})
