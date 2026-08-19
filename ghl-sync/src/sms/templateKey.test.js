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

// Failure 2 regression: a merge field mid-clause, right before the first
// terminal punctuation, must still collapse across recipients — including
// when GHL sends the name ALL CAPS.
test('trailing merge-field name collides across recipients (tourBookingThanks, happyBirthday)', () => {
  assert.strictEqual(
    templateKey(GROUPS.tourBookingThanks[0]),
    templateKey(GROUPS.tourBookingThanks[1])
  )
  assert.strictEqual(
    templateKey(GROUPS.happyBirthday[0]),
    templateKey(GROUPS.happyBirthday[1])
  )
})

test('tourBookingThanks and happyBirthday stay distinct from each other', () => {
  assert.notStrictEqual(
    templateKey(GROUPS.tourBookingThanks[0]),
    templateKey(GROUPS.happyBirthday[0])
  )
})
