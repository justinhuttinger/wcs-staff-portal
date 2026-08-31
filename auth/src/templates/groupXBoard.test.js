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
  assert.ok(html.includes('<span class="badge badge--now">Currently</span>'))
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

test('nothing inside the board can scroll once it stacks', () => {
  // The embed contract is that the PAGE grows and the iframe never scrolls. An
  // inner scroller both steals the gesture and hides the bottom of the week, so
  // every element that scrolls or clips in the TV layout has to be released at
  // the narrow breakpoint -- including .list--time, whose `overflow` shorthand
  // sets overflow-y and would otherwise survive a .list override.
  const html = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem', embed: true })
  const start = html.indexOf('@media (max-width: 760px) and (orientation: portrait)')
  assert.notStrictEqual(start, -1)
  const stacked = html.slice(start, html.indexOf('@media (prefers-reduced-motion', start))

  assert.match(stacked, /html \{ height: auto; \}/)
  assert.match(stacked, /\.list, \.list--time \{ overflow: visible; \}/)
  assert.match(stacked, /\.list--time \.cls \{ max-height: none; overflow: visible; \}/)

  // The TV rules these undo must still be there for the wide layout.
  const wide = html.slice(0, start)
  assert.match(wide, /html \{ [^}]*height: 100%; \}/)
  assert.match(wide, /\.list--time \{ overflow: hidden; \}/)
})

test('the stacked embed measures its content, not the frame it was given', () => {
  const embed = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem', embed: true })
  // A root carrying height:100% can report that height rather than its content,
  // so the beacon takes the largest of four measurements.
  assert.match(embed, /h\.scrollHeight, h\.offsetHeight,\s*b\.scrollHeight, b\.offsetHeight/)
  // The floor that would stop the frame shrinking back down is dropped.
  assert.match(embed, /@media \(max-width: 760px\) and \(orientation: portrait\) \{\s*body \{ min-height: 0; \}/)
  // Re-measure when the display face swaps in and class names rewrap.
  assert.ok(embed.includes('document.fonts.ready.then(postHeight)'))
  // The grid is watched as well as the body.
  assert.ok(embed.includes('ro.observe(weekEl)'))

  // None of this belongs on a TV, which has no parent to talk to.
  const tv = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem' })
  assert.ok(!tv.includes('wcs-board-height'))
})

test('embed mode drops the title block but keeps the week range', () => {
  const embed = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem', embed: true })
  // The .head__titles CSS rule ships either way; it is the markup that goes.
  assert.ok(!embed.includes('<div class="head__titles">'))
  assert.ok(embed.includes('id="range"'))
  assert.ok(embed.includes('id="now"'))
  assert.ok(groupX().includes('<div class="head__titles">'))
})

test('the board carries print rules that fit it on one page', () => {
  const html = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem' })
  assert.match(html, /@media print/, 'no print block at all')
  assert.match(html, /@page \{ size: landscape; margin: \.4in; \}/)
  // The whole one-page guarantee is this line: the flex column distributes
  // into a stated height instead of a viewport it does not have on paper.
  assert.match(html, /height: 7\.7in;/)
  // Without exact colour the board prints as a grey skeleton of itself.
  assert.match(html, /print-color-adjust: exact/)
})

test('print hides the clock but keeps the week range', () => {
  const html = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem' })
  const printBlock = html.slice(html.indexOf('@media print'))
  assert.match(printBlock, /\.now \{ display: none !important; \}/)
  // The range is what says which week this is, and is still true tomorrow.
  assert.doesNotMatch(printBlock, /\.range \{ display: none/)
})

test('the week range and class times are full ink, not muted', () => {
  const html = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem' })
  // Both washed out at distance on a wall TV. The instructor line is still
  // allowed to be muted -- that one really is secondary.
  const range = html.match(/\.range \{[^}]*\}/)[0]
  assert.match(range, /color: var\(--color-text\)/)
  const time = html.match(/\n  \.time \{[^}]*\}/)[0]
  assert.match(time, /color: var\(--color-text\)/)
  assert.doesNotMatch(time, /--color-muted/)
})

test('the board pins its window only when a start date is given', () => {
  const rolling = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem' })
  // A wall TV must roll over at local midnight, so START stays empty and the
  // page keeps asking for today.
  assert.match(rolling, /var START = "";/)

  const pinned = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem', startDate: '2026-09-07' })
  assert.match(pinned, /var START = "2026-09-07";/)
  assert.match(pinned, /START \|\| pacificToday\(\)/)
})

test('autoPrint makes the board print itself and stop polling', () => {
  const normal = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem' })
  assert.match(normal, /var AUTO_PRINT = false;/)

  const printing = renderBoardHtml({ clubSlug: 'salem', clubName: 'Salem', autoPrint: true })
  assert.match(printing, /var AUTO_PRINT = true;/)
  // Fonts first: the display face is an embedded data URI, and printing before
  // it swaps in prints the fallback's metrics instead of the board's.
  assert.match(printing, /document\.fonts\.ready\.then\(go, go\)/)
  // A poll mid-print would re-render the page out from under the print job.
  assert.match(printing, /if \(!AUTO_PRINT\) \{\s*\n\s*setInterval/)
})
