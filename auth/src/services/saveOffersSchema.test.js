const test = require('node:test')
const assert = require('node:assert')
const {
  CLUB_NUMBERS,
  validateSettings,
  validateReason,
  normalizeOfferConfig,
  validateOffer,
  parseLimit,
  parseDays,
  computeStats,
  needsAction,
  PLAN_KINDS,
  isPlanKind,
  validateCancelRule,
  sortCancelRules,
} = require('./saveOffersSchema')

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const KNOWN = new Set([R1, R2])

function offer(overrides = {}) {
  return {
    offer_type: 'dues_discount',
    headline: 'Half off your next 2 months',
    config: { percent_off: 50, invoices: 2 },
    ...overrides,
  }
}

// ---------------------------------------------------------------- settings

test('club list is the seven WCS clubs', () => {
  assert.deepStrictEqual(
    [...CLUB_NUMBERS].sort(),
    ['30935', '31598', '31599', '31600', '31601', '32073', '7655'].sort(),
  )
})

test('validateSettings whitelists columns and drops unknown ones', () => {
  const r = validateSettings({ enabled: false, max_offers_shown: '3', id: 9, updated_by: 'x', hack: 1 })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.patch, { enabled: false, max_offers_shown: 3 })
})

test('validateSettings bounds max_offers_shown to 0-5', () => {
  assert.strictEqual(validateSettings({ max_offers_shown: 0 }).ok, true)
  assert.strictEqual(validateSettings({ max_offers_shown: 5 }).ok, true)
  assert.strictEqual(validateSettings({ max_offers_shown: 6 }).ok, false)
  assert.strictEqual(validateSettings({ max_offers_shown: -1 }).ok, false)
  assert.strictEqual(validateSettings({ max_offers_shown: 1.5 }).ok, false)
})

test('validateSettings rejects charge with a clear message', () => {
  const r = validateSettings({ owed_balance_mode: 'charge' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'Card payments are not set up yet')
  assert.strictEqual(validateSettings({ owed_balance_mode: 'nope' }).ok, false)
  assert.deepStrictEqual(validateSettings({ owed_balance_mode: 'block' }).patch, { owed_balance_mode: 'block' })
})

test('validateSettings cleans staff_notify_emails and rejects bad ones', () => {
  const r = validateSettings({ staff_notify_emails: [' A@wcstrength.com ', 'a@wcstrength.com', '', 'b@x.io'] })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.patch.staff_notify_emails, ['a@wcstrength.com', 'b@x.io'])
  assert.strictEqual(validateSettings({ staff_notify_emails: ['not-an-email'] }).ok, false)
  assert.strictEqual(validateSettings({ staff_notify_emails: 'a@b.co' }).ok, false)
})

test('validateSettings rejects blank copy and non-boolean flags', () => {
  assert.strictEqual(validateSettings({ intro_heading: '   ' }).ok, false)
  assert.strictEqual(validateSettings({ enabled: 'yes' }).ok, false)
  assert.deepStrictEqual(validateSettings({ saved_body: ' Thanks ' }).patch, { saved_body: 'Thanks' })
})

// ---------------------------------------------------------------- reasons

test('validateReason uppercases and checks the ABC code', () => {
  const r = validateReason({ label: 'Moving', abc_cancel_code: 'cmo' })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.row, { label: 'Moving', abc_cancel_code: 'CMO' })
  assert.strictEqual(validateReason({ label: 'x', abc_cancel_code: 'CM' }).ok, false)
  assert.strictEqual(validateReason({ label: 'x', abc_cancel_code: 'CMOO' }).ok, false)
  assert.strictEqual(validateReason({ label: 'x', abc_cancel_code: 'C-O' }).ok, false)
  assert.strictEqual(validateReason({ label: '', abc_cancel_code: 'CMO' }).ok, false)
})

test('validateReason partial only checks what was sent', () => {
  const r = validateReason({ active: false, sort_order: 20 }, { partial: true })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.row, { active: false, sort_order: 20 })
  assert.strictEqual(validateReason({ abc_cancel_code: 'x' }, { partial: true }).ok, false)
})

// ---------------------------------------------------------------- offer config

test('dues_discount needs exactly one of percent_off / amount_off', () => {
  assert.deepStrictEqual(normalizeOfferConfig('dues_discount', { percent_off: 50, invoices: 2 }),
    { ok: true, config: { percent_off: 50, invoices: 2 } })
  assert.deepStrictEqual(normalizeOfferConfig('dues_discount', { amount_off: '10.005', invoices: '3' }),
    { ok: true, config: { amount_off: 10.01, invoices: 3 } })
  assert.strictEqual(normalizeOfferConfig('dues_discount', { percent_off: 50, amount_off: 5, invoices: 1 }).ok, false)
  assert.strictEqual(normalizeOfferConfig('dues_discount', { invoices: 1 }).ok, false)
})

test('dues_discount bounds', () => {
  assert.strictEqual(normalizeOfferConfig('dues_discount', { percent_off: 0, invoices: 1 }).ok, false)
  assert.strictEqual(normalizeOfferConfig('dues_discount', { percent_off: 101, invoices: 1 }).ok, false)
  assert.strictEqual(normalizeOfferConfig('dues_discount', { percent_off: 100, invoices: 1 }).ok, true)
  assert.strictEqual(normalizeOfferConfig('dues_discount', { amount_off: 0, invoices: 1 }).ok, false)
  assert.strictEqual(normalizeOfferConfig('dues_discount', { amount_off: -5, invoices: 1 }).ok, false)
  assert.strictEqual(normalizeOfferConfig('dues_discount', { percent_off: 10, invoices: 0 }).ok, false)
  assert.strictEqual(normalizeOfferConfig('dues_discount', { percent_off: 10, invoices: 13 }).ok, false)
  assert.strictEqual(normalizeOfferConfig('dues_discount', { percent_off: 10, invoices: 1.5 }).ok, false)
})

test('freeze months 1-12 and fee >= 0, unknown keys stripped', () => {
  assert.deepStrictEqual(normalizeOfferConfig('freeze', { months: 2, fee: 0, extra: 'x' }),
    { ok: true, config: { months: 2, fee: 0 } })
  assert.strictEqual(normalizeOfferConfig('freeze', { months: 0, fee: 0 }).ok, false)
  assert.strictEqual(normalizeOfferConfig('freeze', { months: 13, fee: 0 }).ok, false)
  assert.strictEqual(normalizeOfferConfig('freeze', { months: 1, fee: -1 }).ok, false)
  assert.strictEqual(normalizeOfferConfig('freeze', { months: 1 }).ok, false)
})

test('perk needs staff_instructions', () => {
  assert.deepStrictEqual(normalizeOfferConfig('perk', { staff_instructions: ' Free PT session ', percent_off: 5 }),
    { ok: true, config: { staff_instructions: 'Free PT session' } })
  assert.strictEqual(normalizeOfferConfig('perk', { staff_instructions: '  ' }).ok, false)
  assert.strictEqual(normalizeOfferConfig('bogus', {}).ok, false)
})

// ---------------------------------------------------------------- offers

test('validateOffer accepts a good offer and fills defaults', () => {
  const r = validateOffer(offer(), { knownReasonIds: KNOWN })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.row, {
    offer_type: 'dues_discount',
    config: { percent_off: 50, invoices: 2 },
    headline: 'Half off your next 2 months',
    name: 'Half off your next 2 months',
    description: null,
    fine_print: null,
    reason_ids: [],
    club_numbers: [],
    priority: 100,
    active: false,
    starts_on: null,
    ends_on: null,
  })
})

test('validateOffer headline required and <= 120 chars', () => {
  assert.strictEqual(validateOffer(offer({ headline: '' }), { knownReasonIds: KNOWN }).ok, false)
  assert.strictEqual(validateOffer(offer({ headline: 'x'.repeat(120) }), { knownReasonIds: KNOWN }).ok, true)
  assert.strictEqual(validateOffer(offer({ headline: 'x'.repeat(121) }), { knownReasonIds: KNOWN }).ok, false)
})

test('validateOffer checks clubs against the club map', () => {
  const ok = validateOffer(offer({ club_numbers: ['30935', '31599', '30935'] }), { knownReasonIds: KNOWN })
  assert.deepStrictEqual(ok.row.club_numbers, ['30935', '31599'])
  const bad = validateOffer(offer({ club_numbers: ['99999'] }), { knownReasonIds: KNOWN })
  assert.strictEqual(bad.ok, false)
  assert.ok(bad.fields.club_numbers)
})

test('validateOffer checks reason ids exist', () => {
  assert.strictEqual(validateOffer(offer({ reason_ids: [R1, R2] }), { knownReasonIds: KNOWN }).ok, true)
  const bad = validateOffer(offer({ reason_ids: ['33333333-3333-4333-8333-333333333333'] }), { knownReasonIds: KNOWN })
  assert.strictEqual(bad.ok, false)
  assert.ok(bad.fields.reason_ids)
  assert.strictEqual(validateOffer(offer({ reason_ids: ['nope'] }), { knownReasonIds: KNOWN }).ok, false)
})

test('validateOffer dates: valid, and ends_on >= starts_on', () => {
  assert.strictEqual(validateOffer(offer({ starts_on: '2026-10-01', ends_on: '2026-10-01' }), { knownReasonIds: KNOWN }).ok, true)
  assert.strictEqual(validateOffer(offer({ starts_on: '2026-10-02', ends_on: '2026-10-01' }), { knownReasonIds: KNOWN }).ok, false)
  assert.strictEqual(validateOffer(offer({ starts_on: '2026-02-30' }), { knownReasonIds: KNOWN }).ok, false)
  assert.strictEqual(validateOffer(offer({ ends_on: '' }), { knownReasonIds: KNOWN }).row.ends_on, null)
})

test('validateOffer type and config errors surface', () => {
  const r = validateOffer(offer({ offer_type: 'cash' }), { knownReasonIds: KNOWN })
  assert.strictEqual(r.ok, false)
  assert.ok(r.fields.offer_type)
  const c = validateOffer(offer({ config: { percent_off: 50 } }), { knownReasonIds: KNOWN })
  assert.strictEqual(c.ok, false)
  assert.ok(c.fields.config)
})

test('validateOffer priority and active', () => {
  assert.strictEqual(validateOffer(offer({ priority: '10', active: true }), { knownReasonIds: KNOWN }).row.priority, 10)
  assert.strictEqual(validateOffer(offer({ priority: 'high' }), { knownReasonIds: KNOWN }).ok, false)
  assert.strictEqual(validateOffer(offer({ active: 'yes' }), { knownReasonIds: KNOWN }).ok, false)
})

// ---------------------------------------------------------------- misc

test('parseLimit / parseDays clamp', () => {
  assert.strictEqual(parseLimit(undefined), 100)
  assert.strictEqual(parseLimit('50'), 50)
  assert.strictEqual(parseLimit('9999'), 500)
  assert.strictEqual(parseLimit('-3'), 100)
  assert.strictEqual(parseDays(undefined), 30)
  assert.strictEqual(parseDays('7'), 7)
  assert.strictEqual(parseDays('1000'), 365)
})

test('computeStats totals, save rate, breakdowns', () => {
  const s = computeStats([
    { outcome: 'saved', offer_id: 'o1', offer_snapshot: { headline: 'Half off' }, reason_label: 'Moving' },
    { outcome: 'saved', offer_id: 'o1', offer_snapshot: { headline: 'Half off' }, reason_label: 'Too expensive' },
    { outcome: 'cancelled', reason_label: 'Moving' },
    { outcome: 'needs_staff', offer_id: 'o2', offer_snapshot: { headline: 'Free PT' }, reason_label: 'Moving' },
    { outcome: 'needs_staff', reason_label: 'Moving', resolved_at: '2026-09-25T00:00:00Z' },
    { outcome: 'abandoned' },
    { outcome: 'saved', offer_id: 'o3', offer_snapshot: { headline: 'Free smoothie' }, staff_reason: 'Give perk: free smoothie' },
  ])
  assert.strictEqual(s.total, 7)
  assert.strictEqual(s.by_outcome.saved, 3)
  assert.strictEqual(s.by_outcome.cancelled, 1)
  assert.strictEqual(s.by_outcome.needs_staff, 2)
  assert.strictEqual(s.save_rate, 3 / 4)
  // one open needs_staff + one perk saved with staff_reason
  assert.strictEqual(s.needs_action_open, 2)
  assert.deepStrictEqual(s.by_offer[0], { offer_id: 'o1', headline: 'Half off', count: 2 })
  assert.deepStrictEqual(s.by_reason[0], { reason_label: 'Moving', count: 4 })
})

test('computeStats with no decided requests has null save rate', () => {
  const s = computeStats([])
  assert.strictEqual(s.total, 0)
  assert.strictEqual(s.save_rate, null)
})

test('needsAction: needs_staff or staff_reason, and not resolved', () => {
  assert.strictEqual(needsAction({ outcome: 'needs_staff' }), true)
  assert.strictEqual(needsAction({ outcome: 'saved', staff_reason: 'Give perk: free smoothie' }), true)
  assert.strictEqual(needsAction({ outcome: 'saved' }), false)
  assert.strictEqual(needsAction({ outcome: 'needs_staff', resolved_at: '2026-09-25T00:00:00Z' }), false)
  assert.strictEqual(needsAction({ outcome: 'saved', staff_reason: 'x', resolved_at: '2026-09-25T00:00:00Z' }), false)
})

// ---------------------------------------------------------------- cancel rules

test('plan kinds are the three the Worker maps ABC terms to', () => {
  assert.deepStrictEqual(PLAN_KINDS, ['month_to_month', 'contract', 'prepaid'])
  assert.strictEqual(isPlanKind('contract'), true)
  assert.strictEqual(isPlanKind('annual'), false)
  assert.strictEqual(isPlanKind(undefined), false)
})

test('validateCancelRule accepts the editable fields and rounds the fee to cents', () => {
  const r = validateCancelRule({ notice_days: '15', early_cancel_fee: '99.999', send_to_staff: false })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.patch, { notice_days: 15, early_cancel_fee: 100, send_to_staff: false })
  const r2 = validateCancelRule({ early_cancel_fee: 49.504 })
  assert.deepStrictEqual(r2.patch, { early_cancel_fee: 49.5 })
})

test('validateCancelRule allows zero and the 90 day edge', () => {
  assert.deepStrictEqual(validateCancelRule({ notice_days: 0, early_cancel_fee: 0 }).patch, { notice_days: 0, early_cancel_fee: 0 })
  assert.strictEqual(validateCancelRule({ notice_days: 90 }).ok, true)
})

test('validateCancelRule rejects bad values', () => {
  for (const notice_days of [-1, 91, 1.5, '', 'abc', null]) {
    const r = validateCancelRule({ notice_days })
    assert.strictEqual(r.ok, false, `notice_days ${notice_days}`)
    assert.ok(r.fields.notice_days)
  }
  for (const early_cancel_fee of [-0.01, '', 'free', null, 10000.01]) {
    const r = validateCancelRule({ early_cancel_fee })
    assert.strictEqual(r.ok, false, `early_cancel_fee ${early_cancel_fee}`)
    assert.ok(r.fields.early_cancel_fee)
  }
  const r = validateCancelRule({ send_to_staff: 'yes' })
  assert.strictEqual(r.ok, false)
  assert.ok(r.fields.send_to_staff)
})

test('validateCancelRule ignores label and plan_kind, and needs something to update', () => {
  const r = validateCancelRule({ label: 'Hacked', plan_kind: 'contract', notice_days: 10 })
  assert.deepStrictEqual(r.patch, { notice_days: 10 })
  const empty = validateCancelRule({ label: 'Hacked' })
  assert.strictEqual(empty.ok, false)
  assert.strictEqual(empty.error, 'Nothing to update')
  assert.strictEqual(validateCancelRule(null).ok, false)
})

test('sortCancelRules orders month to month, contract, prepaid', () => {
  const sorted = sortCancelRules([
    { plan_kind: 'prepaid' }, { plan_kind: 'mystery' }, { plan_kind: 'month_to_month' }, { plan_kind: 'contract' },
  ])
  assert.deepStrictEqual(sorted.map(r => r.plan_kind), ['month_to_month', 'contract', 'prepaid', 'mystery'])
})
