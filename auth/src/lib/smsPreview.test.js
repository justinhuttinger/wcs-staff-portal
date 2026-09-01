// auth/src/lib/smsPreview.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { resolveTokens, smsSegments, findHiddenCharacters, normalizePhone } = require('./smsPreview')

const CVS = {
  'custom_values.vip_sms_1': 'Hi {{contact.first_name}}, {{contact.referred_by_full_name}} sent you a pass!',
  '{{ custom_values.offer }}': 'half off',
}

test('substitutes contact and location tokens', () => {
  const r = resolveTokens('Hey {{contact.first_name}}, welcome to {{location.name}}!', {
    contact: { first_name: 'Alex' },
    location: { name: 'Salem' },
  })
  assert.equal(r.text, 'Hey Alex, welcome to Salem!')
  assert.deepEqual(r.unresolved, [])
})

test('tolerates inner spaces in the token', () => {
  const r = resolveTokens('Hi {{  contact.first_name  }}', { contact: { first_name: 'Alex' } })
  assert.equal(r.text, 'Hi Alex')
})

test('resolves a custom value, including one nested inside another', () => {
  const r = resolveTokens('{{custom_values.vip_sms_1}}', {
    customValues: CVS,
    contact: { first_name: 'Alex', referred_by_full_name: 'Jamie Smith' },
  })
  assert.equal(r.text, 'Hi Alex, Jamie Smith sent you a pass!')
  assert.deepEqual(r.unresolved, [])
})

test('normalizes custom value keys that arrive wrapped in braces', () => {
  const r = resolveTokens('Get {{custom_values.offer}} today', { customValues: CVS })
  assert.equal(r.text, 'Get half off today')
})

test('leaves an unknown token in place and reports it', () => {
  const r = resolveTokens('Hi {{contact.first_name}}, ref {{contact.referred_by_full_name}}', {
    contact: { first_name: 'Alex' },
  })
  // The referrer is the exact gap this preview exists to expose.
  assert.equal(r.text, 'Hi Alex, ref {{contact.referred_by_full_name}}')
  assert.deepEqual(r.unresolved, ['contact.referred_by_full_name'])
})

test('an empty-string field counts as unresolved, not as a blank substitution', () => {
  const r = resolveTokens('Ref: {{contact.referred_by_full_name}}', {
    contact: { referred_by_full_name: '' },
  })
  assert.deepEqual(r.unresolved, ['contact.referred_by_full_name'])
})

test('reports each unresolved token once, in first-seen order', () => {
  const r = resolveTokens('{{contact.b}} {{contact.a}} {{contact.b}}', {})
  assert.deepEqual(r.unresolved, ['contact.b', 'contact.a'])
})

test('a self-referencing custom value terminates instead of hanging', () => {
  const r = resolveTokens('{{custom_values.loop}}', {
    customValues: { 'custom_values.loop': 'x {{custom_values.loop}}' },
  })
  assert.ok(r.text.startsWith('x x'))
  assert.deepEqual(r.unresolved, ['custom_values.loop'])
})

test('segments: plain GSM-7 under 160 is one segment', () => {
  const s = smsSegments('a'.repeat(160))
  assert.deepEqual(s, { chars: 160, segments: 1, encoding: 'GSM-7' })
})

test('segments: 161 GSM-7 characters spill to two', () => {
  assert.equal(smsSegments('a'.repeat(161)).segments, 2)
})

test('segments: one invisible character forces UCS-2 and inflates the cost', () => {
  const plain = 'a'.repeat(300)
  assert.deepEqual(smsSegments(plain), { chars: 300, segments: 2, encoding: 'GSM-7' })
  // Once UCS-2 kicks in the budget drops to 67 per segment: 2 becomes 5.
  const withZwsp = '​' + plain
  assert.deepEqual(smsSegments(withZwsp), { chars: 301, segments: 5, encoding: 'UCS-2' })
})

test('segments: a GSM-7 extended character costs two septets', () => {
  assert.equal(smsSegments('{').chars, 2)
})

test('finds hidden characters with their position', () => {
  assert.deepEqual(findHiddenCharacters('​hi﻿'), [
    { index: 0, codePoint: 'U+200B' },
    { index: 3, codePoint: 'U+FEFF' },
  ])
  assert.deepEqual(findHiddenCharacters('clean'), [])
})

test('normalizePhone accepts the shapes staff actually type', () => {
  assert.equal(normalizePhone('5035551234'), '+15035551234')
  assert.equal(normalizePhone('(503) 555-1234'), '+15035551234')
  assert.equal(normalizePhone('1-503-555-1234'), '+15035551234')
  assert.equal(normalizePhone('+15035551234'), '+15035551234')
})

test('normalizePhone rejects anything that is not a number', () => {
  assert.equal(normalizePhone(''), null)
  assert.equal(normalizePhone('   '), null)
  assert.equal(normalizePhone('call me'), null)
  assert.equal(normalizePhone('555-1234'), null)
  assert.equal(normalizePhone(undefined), null)
})
