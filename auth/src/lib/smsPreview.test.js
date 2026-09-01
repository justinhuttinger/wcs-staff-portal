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

// --- planted values + field discovery -------------------------------------

const { extractMergeFields, labelForField } = require('./smsPreview')

test('a planted value fills a token by its full path', () => {
  const r = resolveTokens('Hi {{contact.first_name}} at {{location.name}}', {
    values: { 'contact.first_name': 'Alex', 'location.name': 'Salem' },
  })
  assert.equal(r.text, 'Hi Alex at Salem')
  assert.deepEqual(r.unresolved, [])
})

test('a planted value beats the structured contact object', () => {
  const r = resolveTokens('{{contact.first_name}}', {
    values: { 'contact.first_name': 'Planted' },
    contact: { first_name: 'Structured' },
  })
  assert.equal(r.text, 'Planted')
})

test('a deliberately cleared field renders blank, the way GHL renders an empty field', () => {
  // Clearing "Referred by" in the panel is how you test what a member with no
  // referrer receives, so it must blank rather than fall back or show braces.
  const r = resolveTokens('Ref: {{contact.referred_by_full_name}}!', {
    values: { 'contact.referred_by_full_name': '' },
    contact: { referred_by_full_name: 'Fallback' },
  })
  assert.equal(r.text, 'Ref: !')
  // Still reported, because a blank mid-sentence is usually a bug.
  assert.deepEqual(r.unresolved, ['contact.referred_by_full_name'])
})

test('extractMergeFields lists every field the copy needs', () => {
  const fields = extractMergeFields('Hi {{contact.first_name}} {{contact.last_name}} at {{location.name}}')
  assert.deepEqual(fields, ['contact.first_name', 'contact.last_name', 'location.name'])
})

test('extractMergeFields sees fields hidden inside a referenced custom value', () => {
  // The message names no contact field; the custom value it points at does.
  const fields = extractMergeFields('{{custom_values.vip_sms_1}}', {
    'custom_values.vip_sms_1': 'Hi {{contact.first_name}}, {{contact.referred_by_full_name}} sent you a pass',
  })
  assert.deepEqual(fields, ['contact.first_name', 'contact.referred_by_full_name'])
})

test('extractMergeFields ignores custom_values themselves', () => {
  assert.deepEqual(extractMergeFields('{{custom_values.missing}}'), [])
})

test('extractMergeFields de-dupes a repeated field', () => {
  assert.deepEqual(extractMergeFields('{{contact.first_name}} x {{contact.first_name}}'), ['contact.first_name'])
})

test('labelForField reads as a form label', () => {
  assert.equal(labelForField('contact.referred_by_full_name'), 'Referred By Full Name')
  assert.equal(labelForField('contact.first_name'), 'First Name')
  assert.equal(labelForField('location.name'), 'Name')
})
