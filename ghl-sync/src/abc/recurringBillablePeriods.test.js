const test = require('node:test');
const assert = require('node:assert');
const { billablePeriods, totalContractValue, COMMISSION_RATE } = require('./recurringPeriods');

// A recurring service as ABC returns it. Defaults describe the case the fix is
// about: a twelve-month package whose first month was paid at the point of sale,
// so ABC scheduled only eleven drafts.
const svc = (over = {}) => ({
  totalPeriods: '11',
  invoiceTotal: '285',
  recurringTypeDesc: 'Fixed Interval',
  frequency: 'Monthly',
  ...over,
  recurringServiceDates: {
    saleDate: '2026-08-28',
    firstBillingDate: '2026-09-28',
    finalBillingDate: '2027-07-28',
    ...(over.recurringServiceDates || {}),
  },
});

// --- the month paid at signup ------------------------------------------------

test('an 11-draft schedule starting after the sale month is a 12-month package', () => {
  // The real Medford sale this was found on.
  assert.equal(billablePeriods(svc()), 12);
});

test('a 5-draft schedule starting after the sale month is a 6-month package', () => {
  assert.equal(billablePeriods(svc({
    totalPeriods: '5',
    recurringServiceDates: { saleDate: '2026-04-06', firstBillingDate: '2026-05-06', finalBillingDate: '2026-09-06' },
  })), 6);
});

test('the commission covers the signup month', () => {
  // 11 x 285 = 3135 -> $125.40. 12 x 285 = 3420 -> $136.80.
  const value = totalContractValue(svc());
  assert.equal(value, 3420);
  assert.equal(Math.round(value * COMMISSION_RATE * 100) / 100, 136.8);
});

// --- what must NOT move ------------------------------------------------------

test('a full 12-draft schedule stays at 12, never 13', () => {
  // Medford writes the same twelve-month package both ways. A schedule that
  // already covers the whole term must not gain a thirteenth month.
  assert.equal(billablePeriods(svc({
    totalPeriods: '12',
    recurringServiceDates: { saleDate: '2026-04-29', firstBillingDate: '2026-05-05', finalBillingDate: '2027-04-05' },
  })), 12);
});

test('a draft inside the sale month means nothing was collected at signup', () => {
  // Sold on the 1st, drafted on the 27th of the same month: the sale month is
  // already paid for by the schedule.
  assert.equal(billablePeriods(svc({
    totalPeriods: '5',
    recurringServiceDates: { saleDate: '2026-05-01', firstBillingDate: '2026-05-27', finalBillingDate: '2026-09-27' },
  })), 5);
});

test('month-to-month plans are left alone', () => {
  // There is no term for them to be one short of.
  assert.equal(billablePeriods(svc({
    totalPeriods: '1',
    recurringServiceDates: { saleDate: '2026-05-01', firstBillingDate: '2026-06-01', finalBillingDate: '2026-06-01' },
  })), 1);
});

test('a term we do not sell is not rounded up to one we do', () => {
  // 2 drafts would become 3, and 3-month packages are not a thing here. Only
  // 6 and 12 are, so only 5 and 11 move.
  assert.equal(billablePeriods(svc({ totalPeriods: '2' })), 2);
  assert.equal(billablePeriods(svc({ totalPeriods: '3' })), 3);
  assert.equal(billablePeriods(svc({ totalPeriods: '10' })), 10);
});

test('Paid in Full is untouched: invoiceTotal is already the whole amount', () => {
  assert.equal(totalContractValue({
    totalPeriods: '1', invoiceTotal: '3200', recurringTypeDesc: 'Paid in Full',
    recurringServiceDates: { saleDate: '2026-05-01', firstBillingDate: '2026-06-01' },
  }), 3200);
});

// --- missing evidence --------------------------------------------------------

test('a missing billing date leaves the schedule as ABC stated it', () => {
  // Paying a month on evidence we do not have is worse than being one short:
  // the first is an overpayment nobody can explain, the second is a known gap.
  assert.equal(billablePeriods(svc({
    recurringServiceDates: { saleDate: '2026-08-28', firstBillingDate: null, finalBillingDate: null },
  })), 11);
  assert.equal(billablePeriods(svc({
    recurringServiceDates: { saleDate: null, firstBillingDate: '2026-09-28' },
  })), 11);
});

test('a service with no dates at all does not throw', () => {
  assert.equal(billablePeriods({ totalPeriods: '11', invoiceTotal: '285' }), 11);
});
