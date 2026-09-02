const test = require('node:test')
const assert = require('node:assert')
const Module = require('module')

const { normalise, dayOneCalendarNames, PRIMARY } = require('./dayOneCalendars')

// ---------------------------------------------------------------------------
// Which names count
// ---------------------------------------------------------------------------

test('every club gets the primary Day One calendar', () => {
  for (const slug of ['salem', 'keizer', 'eugene', 'springfield', 'medford']) {
    assert.deepEqual(dayOneCalendarNames(slug), [PRIMARY], slug)
  }
})

test('the two clubs with their own Day One flavour get their extra calendar', () => {
  assert.deepEqual(dayOneCalendarNames('clackamas'), ['Day One', 'Stretch'])
  assert.deepEqual(dayOneCalendarNames('milwaukie'), ['Day One', "Kirstyn Pagano-Jackson's Calendar"])
})

// A calendar named from a phone or pasted out of a doc carries U+2019, and an
// exact compare against the U+0027 in the config silently misses it — which
// looks identical to a club that stopped booking Day Ones.
test('curly and straight apostrophes are the same calendar', () => {
  assert.equal(normalise("Kirstyn Pagano-Jackson’s Calendar"), normalise("Kirstyn Pagano-Jackson's Calendar"))
})

test('case and stray whitespace do not matter', () => {
  assert.equal(normalise('  DAY   One '), 'day one')
})

// THE REGRESSION THIS FILE EXISTS FOR. Daily Snapshot used to match any calendar
// whose name merely CONTAINED "day one", and the obvious fix for the two clubs
// above is to loosen the match further. Both are wrong: every sub-account also
// carries Gym Tours and trainer personal calendars, and a Day One count that
// quietly absorbs gym tours is worse than one that misses a booking, because
// nobody questions a number that is too big.
test('nothing outside the allowlist is a Day One calendar', () => {
  const wanted = new Set(dayOneCalendarNames('clackamas').map(normalise))
  for (const name of [
    'Gym Tours', 'Tour', 'Day One Tour', 'PT Consult', 'Meet with Justin',
    'Stretch Therapy', "Kirstyn Pagano-Jackson's Calendar",
  ]) {
    assert.equal(wanted.has(normalise(name)), false, `${name} must not count at Clackamas`)
  }
})

// ---------------------------------------------------------------------------
// Resolution against a sub-account's calendar list
// ---------------------------------------------------------------------------

/** Run `fn` with ghlClient stubbed to return `calendars`, then restore. */
async function withCalendars(calendars, fn) {
  const load = Module._load
  const calls = []
  Module._load = function (request, parent, isMain) {
    if (request === '../services/ghlClient') {
      return { ghlFetch: async (path) => { calls.push(path); return { calendars } } }
    }
    return load.apply(this, arguments)
  }
  delete require.cache[require.resolve('./dayOneCalendars')]
  try {
    const mod = require('./dayOneCalendars')
    mod.clearCache()
    return await fn(mod, calls)
  } finally {
    Module._load = load
    delete require.cache[require.resolve('./dayOneCalendars')]
  }
}

const loc = { slug: 'clackamas', name: 'Clackamas', id: 'loc1', apiKey: 'k' }

test('resolves the primary and the extra calendar together', async () => {
  await withCalendars([
    { id: 'a', name: 'Day One' },
    { id: 'b', name: 'Stretch' },
    { id: 'c', name: 'Gym Tours' },
  ], async (mod) => {
    const found = await mod.resolveDayOneCalendars(loc)
    assert.deepEqual(found.map(c => c.id), ['a', 'b'])
  })
})

// Randall Irving's 9/4 Day One: booked on Stretch, sat on the calendar for three
// hours, and eleven reconciler passes never saw it because the scan only ever
// read the calendar named exactly "Day One".
test('a Day One booked on the Stretch calendar is picked up', async () => {
  await withCalendars([
    { id: 'a', name: 'Day One' },
    { id: 'b', name: 'Stretch' },
  ], async (mod) => {
    const found = await mod.resolveDayOneCalendars(loc)
    assert.ok(found.some(c => c.name === 'Stretch'))
  })
})

test('a missing EXTRA calendar warns and keeps the club syncing', async () => {
  await withCalendars([{ id: 'a', name: 'Day One' }], async (mod) => {
    const warns = []
    const orig = console.warn
    console.warn = m => warns.push(String(m))
    try {
      const found = await mod.resolveDayOneCalendars(loc)
      assert.deepEqual(found.map(c => c.id), ['a'])
      assert.ok(warns.some(w => w.includes('Stretch')), 'should warn about the missing calendar')
      // The warning has to name what IS there, or a rename is undiagnosable.
      assert.ok(warns.some(w => w.includes('Day One')), 'should list the available calendars')
    } finally { console.warn = orig }
  })
})

test('a missing PRIMARY calendar is fatal — that means the wrong sub-account', async () => {
  await withCalendars([{ id: 'z', name: 'Gym Tours' }], async (mod) => {
    await assert.rejects(() => mod.resolveDayOneCalendars(loc), /No "Day One" calendar found/)
  })
})

test('the calendar list is fetched once per club, not per lookup', async () => {
  await withCalendars([{ id: 'a', name: 'Day One' }, { id: 'b', name: 'Stretch' }], async (mod, calls) => {
    await mod.resolveDayOneCalendars(loc)
    await mod.resolveDayOneCalendars(loc)
    assert.equal(calls.length, 1)
  })
})
