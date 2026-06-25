const test = require('node:test');
const assert = require('node:assert');
const { isPT, isActivePT, toRow } = require('./recurringPtRow');

test('isPT matches training names, excludes consults', () => {
  assert.equal(isPT('PT 60MIN'), true);
  assert.equal(isPT('SMALL GROUP TRAINING'), true);
  assert.equal(isPT('PT CONSULT'), false);
  assert.equal(isPT('DUES'), false);
});

test('isActivePT keeps active non-PIF PT, drops the rest', () => {
  assert.equal(isActivePT({ recurringServiceStatus: 'active', recurringTypeDesc: 'Recurring', serviceItem: 'PT 60MIN' }), true);
  assert.equal(isActivePT({ recurringServiceStatus: 'inactive', recurringTypeDesc: 'Recurring', serviceItem: 'PT 60MIN' }), false);
  assert.equal(isActivePT({ recurringServiceStatus: 'active', recurringTypeDesc: 'Paid in Full', serviceItem: 'PT 60MIN' }), false);
  assert.equal(isActivePT({ recurringServiceStatus: 'active', recurringTypeDesc: 'Recurring', serviceItem: 'DUES' }), false);
});

test('toRow maps fields and slices the ABC timestamp date', () => {
  const row = toRow({
    recurringServiceId: 555,
    memberId: 42, memberFirstName: 'Jo', memberLastName: 'Doe',
    serviceEmployeeId: 9, serviceEmployeeFirstName: 'Pat', serviceEmployeeLastName: 'Lee',
    serviceItem: 'PT 60MIN', invoiceTotal: '120.00', recurringTypeDesc: 'Recurring',
    recurringServiceStatus: 'active',
    recurringServiceDates: { nextBillingDate: '2026-07-05 00:00:00.0' },
  }, { clubNumber: '30935', slug: 'salem' });

  assert.equal(row.club_number, '30935');
  assert.equal(row.recurring_service_id, '555');
  assert.equal(row.location_slug, 'salem');
  assert.equal(row.member_id, '42');
  assert.equal(row.member_name, 'Jo Doe');
  assert.equal(row.service_employee_id, '9');
  assert.equal(row.trainer_name, 'Pat Lee');
  assert.equal(row.next_billing_date, '2026-07-05');
  assert.equal(row.invoice_total, 120);
  assert.equal(row.status, 'active');
});

test('toRow tolerates missing names/date', () => {
  const row = toRow({ recurringServiceId: 1, invoiceTotal: '0', recurringServiceDates: {} }, { clubNumber: '7655', slug: 'eugene' });
  assert.equal(row.member_name, null);
  assert.equal(row.trainer_name, null);
  assert.equal(row.next_billing_date, null);
  assert.equal(row.invoice_total, 0);
});
