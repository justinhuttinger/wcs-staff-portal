const test = require('node:test')
const assert = require('node:assert')
const { templateKey, normalizeBody } = require('./templateKey')
const { GROUPS } = require('./__fixtures__/realBodies')

// GHL gives no workflow id on a message, so the message body IS the only
// identity an automated text has. These cases pin the normalization that makes
// two sends of the same template collide and two different templates not,
// driven by real production bodies (see __fixtures__/realBodies.js) rather
// than hand-written examples — the earlier greeting-only rule passed
// hand-written tests and still produced 982 "templates" from 1,437 real
// messages.

for (const [name, bodies] of Object.entries(GROUPS)) {
  test(`fixture group "${name}": every body collides to the same key`, () => {
    const keys = bodies.map(templateKey)
    for (const k of keys) {
      assert.match(k, /^[0-9a-f]{16}$/)
      assert.strictEqual(k, keys[0])
    }
  })
}

test('fixture groups do not collide with each other', () => {
  const names = Object.keys(GROUPS)
  const keyOf = name => templateKey(GROUPS[name][0])
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      assert.notStrictEqual(
        keyOf(names[i]),
        keyOf(names[j]),
        `groups "${names[i]}" and "${names[j]}" collided`
      )
    }
  }
})

// The one pair called out explicitly: both contain "this is ... from", and
// must stay distinct because one generalizes to "this is x from" (a 1:1 sales
// text) and the other to "this is x team from" (a location-open blast).
test('freeTrialReady and medfordOpen stay distinct despite both saying "this is ... from"', () => {
  assert.notStrictEqual(
    templateKey(GROUPS.freeTrialReady[0]),
    templateKey(GROUPS.medfordOpen[0])
  )
})

// These are the explicit regression pins for the over-merge bug: a
// punctuation-anchored rule that strips any capitalized word before "," or
// "!" collapses these into one key, silently pooling different templates'
// engagement numbers together.
test('Congrats! and Welcome! openers stay distinct (must-not-collide)', () => {
  assert.notStrictEqual(
    templateKey(GROUPS.congratsMember[0]),
    templateKey(GROUPS.welcomeMember[0])
  )
})

test('Last chance! and Today only! openers stay distinct (must-not-collide)', () => {
  assert.notStrictEqual(
    templateKey(GROUPS.lastChanceSale[0]),
    templateKey(GROUPS.todayOnlySale[0])
  )
})

// Not a checked-in fixture group (both sides are single-body, no per-recipient
// variation to demonstrate), but the same class of stoplist regression.
test('Good news, and Bad news, openers stay distinct (must-not-collide)', () => {
  assert.notStrictEqual(
    templateKey('Good news, your session is confirmed for tomorrow at 10am.'),
    templateKey('Bad news, your session is confirmed for tomorrow at 10am.')
  )
})

test('bare-name greeting with no punctuation still collides across recipients', () => {
  const keys = GROUPS.heyNameNoPunct.map(templateKey)
  for (const k of keys) assert.strictEqual(k, keys[0])
})

test('differing short links in the same template collide', () => {
  const a = 'Book your tour here: https://link.wcs.com/a1b2c3'
  const b = 'Book your tour here: https://link.wcs.com/z9y8x7'
  assert.strictEqual(templateKey(a), templateKey(b))
})

test('differing phone numbers and digits in the same template collide', () => {
  const a = 'Call us at 503-555-0142 to confirm your 9:00 session'
  const b = 'Call us at 541-555-9987 to confirm your 6:30 session'
  assert.strictEqual(templateKey(a), templateKey(b))
})

test('punctuation and whitespace noise collapses', () => {
  assert.strictEqual(templateKey('Hi  Shaun!!   See   you soon.'), templateKey('Hi Shaun! See you soon.'))
})

test('empty or missing body yields null', () => {
  assert.strictEqual(templateKey(''), null)
  assert.strictEqual(templateKey(null), null)
  assert.strictEqual(templateKey('   '), null)
})

test('key is 16 hex characters and stable across calls', () => {
  const k = templateKey('Hi Shaun! Welcome aboard.')
  assert.match(k, /^[0-9a-f]{16}$/)
  assert.strictEqual(k, templateKey('Hi Shaun! Welcome aboard.'))
})

test('normalizeBody strips the leading personalization entirely', () => {
  assert.strictEqual(normalizeBody('Hi Shaun! Welcome aboard.'), 'welcome aboard')
})

test('bodies differing only past 160 normalized characters collide', () => {
  const base = 'x'.repeat(200)
  assert.strictEqual(templateKey(base + 'aaa'), templateKey(base + 'bbb'))
})

// Failure 1 regression: the trailing-name rule must not eat real brand copy
// like "Strength" just because it happens to sit before the first period.
test('trailing-name rule does not strip "Strength" from real closing copy', () => {
  const norm = normalizeBody(GROUPS.personalWelcome[0])
  assert.match(norm, /\bstrength\b/)
})

// Failure 1 regression: a greeting followed by a stoplisted word (not a
// name) must keep that word, even though it looks like "Hey <Name>,".
test('"Hey Team," keeps "Team" (stoplisted, not a name)', () => {
  const norm = normalizeBody('Hey Team, the gym is closed today for a deep clean.')
  assert.match(norm, /\bteam\b/)
})

// Failure 1 regression: greeting + up to three capitalized name tokens must
// still collapse across recipients, including a three-word name.
test('multi-token merged names collide across recipients (oneMoreTryMultiName)', () => {
  const keys = GROUPS.oneMoreTryMultiName.map(templateKey)
  for (const k of keys) assert.strictEqual(k, keys[0])
})

// ---------------------------------------------------------------------------
// MUST-NOT-COLLIDE regression guard (trailing-name rule revert)
//
// Commit 8d7037c briefly added `stripTrailingNameBeforePunct`: strip any
// capitalized token sitting right before the first terminal punctuation,
// guarded only by a small stoplist. The previous test suite PASSED with that
// rule in place, because nothing tested the danger zone directly — it only
// asserted the merge-field cases the rule was meant to fix
// (tourBookingThanks, happyBirthday), never the cases it broke.
//
// A stoplist cannot enumerate the space of legitimate proper nouns: class
// names, trainer names, weekdays, cities, products. Every pair below is a
// DIFFERENT real WCS template that the reverted rule collapsed into the SAME
// key, which pools two templates' engagement numbers together and reports
// wrong data. The worst case is the last one: WCS is a seven-location gym
// chain, and per-location promo copy ("Milwaukie" vs "Medford") is exactly
// what this report exists to keep apart. These assertions exist so nobody
// re-adds that rule (or an equivalent) without noticing it breaks this.
// ---------------------------------------------------------------------------
test('MUST-NOT-COLLIDE: different trainer name before "!" stays distinct', () => {
  assert.notStrictEqual(
    templateKey('Free trial today with Coach Sarah!'),
    templateKey('Free trial today with Coach Mike!')
  )
})

test('MUST-NOT-COLLIDE: different weekday before "!" stays distinct', () => {
  assert.notStrictEqual(
    templateKey('See you Monday!'),
    templateKey('See you Wednesday!')
  )
})

test('MUST-NOT-COLLIDE: different class/program name before "!" stays distinct', () => {
  assert.notStrictEqual(
    templateKey('Sign up for Bootcamp!'),
    templateKey('Sign up for Yoga!')
  )
})

test('MUST-NOT-COLLIDE: different location name before "!" stays distinct (worst case: per-location promo copy)', () => {
  assert.notStrictEqual(
    templateKey('Come see our new location in Milwaukie!'),
    templateKey('Come see our new location in Medford!')
  )
})

test('MUST-NOT-COLLIDE: different brand name before "." stays distinct', () => {
  assert.notStrictEqual(
    templateKey('Welcome to Cascade CrossFit. Come check us out!'),
    templateKey('Welcome to Cascade Fitness. Come check us out!')
  )
})
