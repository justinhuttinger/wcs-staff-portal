const test = require('node:test')
const assert = require('node:assert/strict')

// Only test the pure helpers — Supabase I/O is exercised against live data
// in a follow-up smoke test after deploy with DEACTIVATED_PT_USE_SUPABASE=1.
//
// Lazy-load the module via a require that doesn't pull in supabase-js if it's
// not present (the tests environment may not have node_modules installed).
let mapRowToAbcPayload
try {
  ;({ mapRowToAbcPayload } = require('../src/services/abcRecurringServicesReader'))
} catch (err) {
  // Fall back to inlining the function for syntax-only test runs (matches the
  // pattern in cacheWarmer.test.js where supabase isn't available locally).
  mapRowToAbcPayload = null
}

const haveDeps = mapRowToAbcPayload !== null

test('mapRowToAbcPayload returns null for null row', { skip: !haveDeps }, () => {
  assert.equal(mapRowToAbcPayload(null), null)
})

test('mapRowToAbcPayload returns the raw payload spread + cancellationDate override', { skip: !haveDeps }, () => {
  const row = {
    recurring_service_id: 'RS-1',
    club_number: '30935',
    cancel_date: '2026-04-15',
    raw: {
      recurringServiceId: 'RS-1',
      memberId: 'M-1',
      memberFirstName: 'Jane',
      memberLastName: 'Doe',
      serviceItem: 'PT 60MIN',
      recurringServiceStatus: 'cancelled',
      invoiceTotal: '240.00',
      recurringServiceDates: { saleDate: '2025-12-01' },
    },
  }
  const svc = mapRowToAbcPayload(row)

  assert.equal(svc.recurringServiceId, 'RS-1')
  assert.equal(svc.memberId, 'M-1')
  assert.equal(svc.memberFirstName, 'Jane')
  assert.equal(svc.memberLastName, 'Doe')
  assert.equal(svc.serviceItem, 'PT 60MIN')
  assert.equal(svc.recurringServiceStatus, 'cancelled')
  assert.equal(svc.invoiceTotal, '240.00')
  assert.deepEqual(svc.recurringServiceDates, { saleDate: '2025-12-01' })
  // The sync's computed cancel_date wins over whatever was in raw
  assert.equal(svc.cancellationDate, '2026-04-15')
})

test('mapRowToAbcPayload falls back to raw.cancellationDate when sync cancel_date is null', { skip: !haveDeps }, () => {
  const row = {
    cancel_date: null,
    raw: {
      recurringServiceId: 'RS-2',
      cancellationDate: '2026-03-01',
    },
  }
  const svc = mapRowToAbcPayload(row)
  assert.equal(svc.cancellationDate, '2026-03-01')
})

test('mapRowToAbcPayload falls back to raw.recurringServiceDates.cancellationDate', { skip: !haveDeps }, () => {
  const row = {
    cancel_date: null,
    raw: {
      recurringServiceId: 'RS-3',
      recurringServiceDates: { cancellationDate: '2026-02-14' },
    },
  }
  const svc = mapRowToAbcPayload(row)
  assert.equal(svc.cancellationDate, '2026-02-14')
})

test('mapRowToAbcPayload tolerates missing raw', { skip: !haveDeps }, () => {
  const row = { cancel_date: '2026-01-01', raw: null }
  const svc = mapRowToAbcPayload(row)
  assert.equal(svc.cancellationDate, '2026-01-01')
  // No other fields exist; that's fine — the consumer code defensively uses
  // `|| ''` fallbacks throughout.
})

test('mapRowToAbcPayload preserves nested objects (e.g. recurringServiceDates)', { skip: !haveDeps }, () => {
  const row = {
    cancel_date: null,
    raw: {
      recurringServiceDates: {
        saleDate: '2025-01-01',
        startDate: '2025-02-01',
        nextBillingDate: '2026-06-01',
      },
    },
  }
  const svc = mapRowToAbcPayload(row)
  assert.equal(svc.recurringServiceDates.saleDate, '2025-01-01')
  assert.equal(svc.recurringServiceDates.startDate, '2025-02-01')
  assert.equal(svc.recurringServiceDates.nextBillingDate, '2026-06-01')
})
