const test = require('node:test')
const assert = require('node:assert')
const { validateSchema, validateSubmission, makeSlug, INPUT_TYPES, FIELD_TYPES } = require('./formsSchema')

const SCHEMA = [
  { id: 'f_head1', type: 'header', label: 'Event Signup' },
  { id: 'f_name', type: 'short_text', label: 'Your name', required: true },
  { id: 'f_email', type: 'email', label: 'Email', required: true },
  { id: 'f_phone', type: 'phone', label: 'Phone', required: false },
  { id: 'f_count', type: 'number', label: 'Guests', required: false },
  { id: 'f_shirt', type: 'dropdown', label: 'Shirt size', required: true, options: ['S', 'M', 'L'] },
  { id: 'f_days', type: 'checkbox', label: 'Days attending', required: false, options: ['Sat', 'Sun'] },
  { id: 'f_date', type: 'date', label: 'Birth date', required: false },
]

test('FIELD_TYPES covers all 11 types', () => {
  assert.strictEqual(FIELD_TYPES.length, 11)
  assert.ok(FIELD_TYPES.includes('header') && FIELD_TYPES.includes('description'))
  assert.strictEqual(INPUT_TYPES.length, 9)
})

test('validateSchema accepts a good schema', () => {
  assert.deepStrictEqual(validateSchema(SCHEMA), { ok: true })
})

test('validateSchema rejects non-array, bad type, dup ids, empty label, missing options', () => {
  assert.strictEqual(validateSchema({}).ok, false)
  assert.strictEqual(validateSchema([{ id: 'f_x', type: 'file', label: 'x' }]).ok, false)
  assert.strictEqual(validateSchema([SCHEMA[1], SCHEMA[1]]).ok, false)
  assert.strictEqual(validateSchema([{ id: 'f_x', type: 'short_text', label: '' }]).ok, false)
  assert.strictEqual(validateSchema([{ id: 'f_x', type: 'radio', label: 'Pick', options: [] }]).ok, false)
})

test('header block does not need a label to be non-empty options etc', () => {
  assert.strictEqual(validateSchema([{ id: 'f_h', type: 'description', label: '', help_text: 'welcome' }]).ok, true)
})

test('validateSubmission happy path cleans values', () => {
  const r = validateSubmission(SCHEMA, {
    f_name: '  Justin ', f_email: 'j@x.com', f_shirt: 'M', f_days: ['Sat'], f_count: '3',
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.cleaned.f_name, 'Justin')
  assert.deepStrictEqual(r.cleaned.f_days, ['Sat'])
})

test('validateSubmission enforces required, formats, option membership, unknown ids', () => {
  const r = validateSubmission(SCHEMA, {
    f_email: 'not-an-email', f_shirt: 'XXL', f_days: ['Mon'], f_count: 'abc',
    f_date: 'yesterday', f_phone: '12', f_bogus: 'x',
  })
  assert.strictEqual(r.ok, false)
  assert.ok(r.errors.f_name)   // required missing
  assert.ok(r.errors.f_email)  // bad email
  assert.ok(r.errors.f_shirt)  // not an option
  assert.ok(r.errors.f_days)   // bad option in array
  assert.ok(r.errors.f_count)  // not a number
  assert.ok(r.errors.f_date)   // bad date
  assert.ok(r.errors.f_phone)  // too short
  assert.ok(r.errors.f_bogus)  // unknown field
})

test('phone: normalizes valid US numbers to (999) 999-9999', () => {
  const base = { f_name: 'A', f_email: 'a@b.co', f_shirt: 'S' }
  for (const input of ['9717203264', '971-720-3264', '(971) 720 3264', '1 971 720 3264', '+1 (971) 720-3264']) {
    const r = validateSubmission(SCHEMA, { ...base, f_phone: input })
    assert.strictEqual(r.ok, true, `should accept ${input}`)
    assert.strictEqual(r.cleaned.f_phone, '(971) 720-3264', `should normalize ${input}`)
  }
})

test('phone: rejects wrong lengths and non-NANP shapes', () => {
  const base = { f_name: 'A', f_email: 'a@b.co', f_shirt: 'S' }
  // 9 digits, 11 digits without a leading 1, 12 digits, area code starting
  // with 0, exchange starting with 1.
  for (const input of ['971720326', '99717203264', '197172032645', '0717203264', '9711203264']) {
    const r = validateSubmission(SCHEMA, { ...base, f_phone: input })
    assert.strictEqual(r.ok, false, `should reject ${input}`)
    assert.ok(r.errors.f_phone, `should error on ${input}`)
  }
})

test('display blocks are ignored by validateSubmission', () => {
  const r = validateSubmission(SCHEMA, { f_name: 'A', f_email: 'a@b.co', f_shirt: 'S' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual('f_head1' in r.cleaned, false)
})

test('makeSlug: lowercase, hyphenated, 4-char suffix, distinct per call', () => {
  const s = makeSlug('Summer Bash 2026!')
  assert.match(s, /^summer-bash-2026-[a-z0-9]{4}$/)
  assert.notStrictEqual(makeSlug('Summer Bash 2026!'), s)
})
