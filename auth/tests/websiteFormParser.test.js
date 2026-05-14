const test = require('node:test')
const assert = require('node:assert/strict')
const { parseWebsiteFormBody, parseLocation } = require('../src/services/websiteFormParser')

test('parseLocation matches a known prefix with " - "', () => {
  assert.equal(parseLocation('Springfield - Swim Sign Up'), 'Springfield')
})

test('parseLocation is case-insensitive and returns canonical case', () => {
  assert.equal(parseLocation('springfield - Swim Sign Up'), 'Springfield')
  assert.equal(parseLocation('MEDFORD - membership inquiry'), 'Medford')
})

test('parseLocation matches with whitespace separator (no dash)', () => {
  assert.equal(parseLocation('Salem Swim Sign Up'), 'Salem')
})

test('parseLocation rejects mid-string matches and word-boundary violations', () => {
  assert.equal(parseLocation('New Salemite Form'), null) // not at start
  assert.equal(parseLocation('Springfieldville Form'), null) // word boundary
})

test('parseLocation returns null for null/empty/non-string', () => {
  assert.equal(parseLocation(null), null)
  assert.equal(parseLocation(undefined), null)
  assert.equal(parseLocation(''), null)
  assert.equal(parseLocation(42), null)
})

test('parseWebsiteFormBody extracts all known fields from the sample payload', () => {
  // Sample matches the real webhook body Justin captured 2026-05-14 (with the
  // updated form_name prefix convention).
  const body = {
    'First Name': 'Justin',
    'Last Name': 'Huttinger',
    'Email': 'justinhuttinger1@gmal.com',
    'Phone': '4259549854',
    'Message': 'test',
    'Opt In for Messaging': 'on',
    'No Label field_5f3533b': '',
    'form_id': '3bf9439a',
    'form_name': 'Springfield - Swim Sign Up',
  }
  const parsed = parseWebsiteFormBody(body)
  assert.equal(parsed.first_name, 'Justin')
  assert.equal(parsed.last_name, 'Huttinger')
  assert.equal(parsed.email, 'justinhuttinger1@gmal.com')
  assert.equal(parsed.phone, '4259549854')
  assert.equal(parsed.message, 'test')
  assert.equal(parsed.opt_in, true)
  assert.equal(parsed.form_id, '3bf9439a')
  assert.equal(parsed.form_name, 'Springfield - Swim Sign Up')
  assert.equal(parsed.location, 'Springfield')
  // raw passes through verbatim — dynamic No-Label fields preserved.
  assert.equal(parsed.raw, body)
  assert.equal(parsed.raw['No Label field_5f3533b'], '')
})

test('opt_in coerces missing/empty to false', () => {
  const parsed = parseWebsiteFormBody({ 'form_name': 'Salem - X' })
  assert.equal(parsed.opt_in, false)
})

test('opt_in accepts "on", "true", "1", "yes" (case-insensitive)', () => {
  for (const v of ['on', 'true', 'TRUE', '1', 'yes', 'YES']) {
    const parsed = parseWebsiteFormBody({ 'Opt In for Messaging': v, 'form_name': 'Salem - X' })
    assert.equal(parsed.opt_in, true, `expected true for "${v}"`)
  }
})

test('field name lookup is case-insensitive', () => {
  const parsed = parseWebsiteFormBody({
    'first name': 'lower',
    'LAST NAME': 'UPPER',
    'Email': 'mixed@x.com',
    'form_name': 'Eugene - inquiry',
  })
  assert.equal(parsed.first_name, 'lower')
  assert.equal(parsed.last_name, 'UPPER')
  assert.equal(parsed.email, 'mixed@x.com')
  assert.equal(parsed.location, 'Eugene')
})

test('empty-string values become null on known fields', () => {
  const parsed = parseWebsiteFormBody({
    'First Name': '',
    'Email': '   ',
    'form_name': 'Keizer - inquiry',
  })
  assert.equal(parsed.first_name, null)
  assert.equal(parsed.email, null)
  assert.equal(parsed.location, 'Keizer')
})

test('unknown form_name prefix → location null, row still parseable', () => {
  const parsed = parseWebsiteFormBody({ 'form_name': 'Random Form Name' })
  assert.equal(parsed.location, null)
  assert.equal(parsed.form_name, 'Random Form Name')
})

test('missing form_name → location null, no throw', () => {
  const parsed = parseWebsiteFormBody({ 'First Name': 'X' })
  assert.equal(parsed.location, null)
  assert.equal(parsed.form_name, null)
  assert.equal(parsed.first_name, 'X')
})

test('parseWebsiteFormBody returns null for non-object input', () => {
  assert.equal(parseWebsiteFormBody(null), null)
  assert.equal(parseWebsiteFormBody(undefined), null)
  assert.equal(parseWebsiteFormBody('a string'), null)
})

test('dynamic No-Label fields preserved inside raw', () => {
  const body = {
    'form_name': 'Clackamas - Swim',
    'No Label field_abc': 'value-1',
    'No Label field_def': 'value-2',
  }
  const parsed = parseWebsiteFormBody(body)
  assert.equal(parsed.raw['No Label field_abc'], 'value-1')
  assert.equal(parsed.raw['No Label field_def'], 'value-2')
})
