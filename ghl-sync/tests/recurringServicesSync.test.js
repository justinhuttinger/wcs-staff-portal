const test = require('node:test')
const assert = require('node:assert/strict')

// Pure-function tests for the sync module. The Supabase/ABC I/O is exercised
// in the live deploy via POST /api/sync/abc/recurring-services.
const {
  transformService,
  detectCancelDate,
  isPT,
  isPIF,
  dateChunks,
  toDateString,
  isRsSyncRunning,
  syncRecurringServices,
  syncRecurringServicesForClub,
} = require('../src/abc/recurringServicesSync')

test('isPT recognizes common PT shapes and rejects Consult', () => {
  assert.equal(isPT('PT 60MIN'), true)
  assert.equal(isPT('PT60'), true)
  assert.equal(isPT('Partner Training'), true)
  assert.equal(isPT('Small Group Training'), true)
  assert.equal(isPT('Online Coaching'), true)
  assert.equal(isPT('Membership Challenge'), true)
  assert.equal(isPT('Consult'), false, 'Consult must be excluded')
  assert.equal(isPT('PT CONSULT'), false, 'Consult-containing names excluded too')
  assert.equal(isPT('Smoothie'), false)
  assert.equal(isPT(''), false)
  assert.equal(isPT(null), false)
})

test('isPIF detects Paid in Full case-insensitively', () => {
  assert.equal(isPIF({ recurringTypeDesc: 'Paid in Full' }), true)
  assert.equal(isPIF({ recurringTypeDesc: 'paid in full' }), true)
  assert.equal(isPIF({ recurringTypeDesc: 'PAID IN FULL - 12 month' }), true)
  assert.equal(isPIF({ recurringTypeDesc: 'Monthly Recurring' }), false)
  assert.equal(isPIF({}), false)
})

test('detectCancelDate prefers cancellationDate, falls back through known fields', () => {
  // Top-level cancellationDate wins
  assert.equal(
    detectCancelDate({ cancellationDate: '2026-04-01T00:00:00' }),
    '2026-04-01',
  )
  // Inside recurringServiceDates
  assert.equal(
    detectCancelDate({ recurringServiceDates: { terminationDate: '2026-03-15' } }),
    '2026-03-15',
  )
  // First non-null wins — cancellationDate beats terminationDate
  assert.equal(
    detectCancelDate({
      recurringServiceDates: {
        cancellationDate: '2026-01-01',
        terminationDate: '2026-02-01',
      },
    }),
    '2026-01-01',
  )
  // No termination fields present
  assert.equal(detectCancelDate({}), null)
  assert.equal(detectCancelDate({ recurringServiceDates: { saleDate: '2026-01-01' } }), null,
    'saleDate must not be treated as a cancellation date')
})

test('toDateString trims to YYYY-MM-DD', () => {
  assert.equal(toDateString('2026-05-15T09:00:00.000Z'), '2026-05-15')
  assert.equal(toDateString('2026-05-15'), '2026-05-15')
  assert.equal(toDateString(null), null)
  assert.equal(toDateString(''), null)
  assert.equal(toDateString('not a date'), null)
})

test('dateChunks splits range into 180-day buckets', () => {
  const chunks = dateChunks('2026-01-01', '2026-12-31')
  assert.ok(chunks.length >= 2, 'a full year must split into multiple chunks')
  // First chunk starts on the start date
  assert.equal(chunks[0].split(',')[0], '2026-01-01')
  // Last chunk ends on the end date
  assert.equal(chunks.at(-1).split(',')[1], '2026-12-31')
  // No gaps: each chunk's start should be the day after the prior chunk's end
  for (let i = 1; i < chunks.length; i++) {
    const prevEnd = new Date(chunks[i - 1].split(',')[1] + 'T00:00:00')
    const curStart = new Date(chunks[i].split(',')[0] + 'T00:00:00')
    const diffDays = (curStart - prevEnd) / (24 * 3600 * 1000)
    assert.equal(diffDays, 1, `chunk ${i} should start one day after previous chunk's end`)
  }
})

test('dateChunks handles short ranges as a single chunk', () => {
  const chunks = dateChunks('2026-05-01', '2026-05-10')
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0], '2026-05-01,2026-05-10')
})

test('transformService maps ABC payload to row shape', () => {
  const svc = {
    recurringServiceId: 'RS-123',
    memberId: 'M-456',
    memberFirstName: 'Jane',
    memberLastName: 'Doe',
    serviceItem: 'PT 60MIN',
    recurringServicePlanId: 'PLAN-1',
    recurringServicePlanName: 'PT60 3X/WEEK 12 MONTHS',
    recurringTypeDesc: 'Monthly Recurring',
    invoiceTotal: '$240.00',
    totalPeriods: '12',
    recurringServiceStatus: 'Active',
    serviceEmployeeId: 'E-7',
    serviceEmployeeFirstName: 'Bob',
    serviceEmployeeLastName: 'Smith',
    lastModifiedTimestamp: '2026-05-14 09:15:00',
    recurringServiceDates: {
      saleDate: '2026-01-01',
      startDate: '2026-01-15',
      nextBillingDate: '2026-06-15',
    },
  }
  const row = transformService(svc, '30935')

  assert.equal(row.recurring_service_id, 'RS-123')
  assert.equal(row.club_number, '30935')
  assert.equal(row.member_id, 'M-456')
  assert.equal(row.member_first_name, 'Jane')
  assert.equal(row.member_last_name, 'Doe')
  assert.equal(row.service_item, 'PT 60MIN')
  assert.equal(row.service_plan_id, 'PLAN-1')
  assert.equal(row.service_plan_name, 'PT60 3X/WEEK 12 MONTHS')
  assert.equal(row.recurring_type_desc, 'Monthly Recurring')
  assert.equal(row.is_pif, false)
  assert.equal(row.invoice_total, 240)
  assert.equal(row.total_periods, 12)
  assert.equal(row.sale_date, '2026-01-01')
  assert.equal(row.start_date, '2026-01-15')
  assert.equal(row.next_billing_date, '2026-06-15')
  assert.equal(row.cancel_date, null, 'active service has no cancel date')
  assert.equal(row.status, 'active', 'status must be lowercased')
  assert.equal(row.service_employee_id, 'E-7')
  assert.equal(row.service_employee_name, 'Bob Smith')
  assert.equal(row.last_modified_timestamp, '2026-05-14 09:15:00')
  assert.deepEqual(row.raw, svc, 'raw payload is preserved')
  assert.ok(row.last_synced_at, 'last_synced_at is set')
})

test('transformService flags PIF and pulls cancel_date for terminated rows', () => {
  const svc = {
    recurringServiceId: 'RS-PIF-1',
    serviceItem: 'PT60 6 PACK',
    recurringTypeDesc: 'Paid in Full',
    recurringServiceStatus: 'cancelled',
    invoiceTotal: '600',
    totalPeriods: '1',
    recurringServiceDates: {
      saleDate: '2025-12-01',
      cancellationDate: '2026-03-01',
    },
  }
  const row = transformService(svc, '30935')

  assert.equal(row.is_pif, true)
  assert.equal(row.cancel_date, '2026-03-01')
  assert.equal(row.status, 'cancelled')
  assert.equal(row.invoice_total, 600)
})

test('transformService handles empty/missing employee gracefully', () => {
  const row = transformService({
    recurringServiceId: 'X',
    serviceEmployeeFirstName: '   ',
    serviceEmployeeLastName: '',
  }, '30935')
  assert.equal(row.service_employee_name, null)
})

test('transformService strips dollar signs and commas from invoice_total', () => {
  const cases = [
    { in: '$1,234.56', out: 1234.56 },
    { in: '$0.00', out: 0 },
    { in: '600', out: 600 },
    { in: '', out: null },
    { in: null, out: null },
  ]
  for (const c of cases) {
    const row = transformService({ recurringServiceId: 'x', invoiceTotal: c.in }, '30935')
    assert.equal(row.invoice_total, c.out, `invoiceTotal=${JSON.stringify(c.in)} → ${c.out}`)
  }
})

test('isRsSyncRunning starts false', () => {
  assert.equal(isRsSyncRunning(), false)
})

test('syncRecurringServices with no qualifying locations returns []', async () => {
  // Sanity check that the wrapper releases the lock cleanly even when there's
  // nothing to sync. The actual concurrent-call lock behavior is exercised
  // in the live deploy when the scheduler fires while a manual trigger is
  // already running — it logs "Already running — skipping this cycle" and
  // returns null. Unit-testing that path here would require either ABC creds
  // or a mock injection point; not worth it for this PR.
  const result = await syncRecurringServices([{ name: 'NoClub', slug: 'noclub' }], { sinceDays: 1 })
  assert.deepEqual(result, [])
  assert.equal(isRsSyncRunning(), false, 'lock must be released after the call')
})
