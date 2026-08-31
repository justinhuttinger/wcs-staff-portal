/**
 * How many months of a recurring PT contract commission is owed on.
 *
 * Pure and I/O-free so the rule can be tested without ABC credentials or a
 * database, in the same way recurringPtRow.js is. recurringServices.js is not
 * loadable in a test: it pulls in axios and the Supabase client at require time.
 */
'use strict';

// The fixed terms PT packages are sold on. A schedule one draft short of one of
// these is a term whose first month was collected at the point of sale.
const PACKAGE_TERMS = [6, 12];

function monthIndex(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 12 + parseInt(m[2], 10);
}

/**
 * How many months of the contract the commission is owed on.
 *
 * THE SALE MONTH IS OFTEN NOT IN THE DRAFT SCHEDULE. On a 12-month package the
 * first month is collected at the point of sale and ABC schedules only the
 * remaining 11, so `totalPeriods` reads 11. A real Medford sale:
 *
 *   saleDate         2026-08-28
 *   firstBillingDate 2026-09-28     <- a month AFTER the sale
 *   finalBillingDate 2027-07-28     <- Sep..Jul = 11 drafts
 *   totalPeriods     11
 *
 * That is a twelve-month sale. Valuing it at eleven shorted the commission by a
 * month, and the month it shorted earns nothing anywhere else: the POS upload
 * drops every TRAINING row as a $0 placeholder precisely because PT commission
 * is supposed to come from here. Measured across April-August 2026 it cost 128
 * sales a combined $1,981.00.
 *
 * TWO CONDITIONS, BOTH REQUIRED, because the same term is written two ways:
 *
 *   1. totalPeriods + 1 is a term we actually sell (6 or 12). Medford writes
 *      12-month packages as BOTH 11 drafts plus a signup month AND as 12 drafts
 *      with nothing taken at signup. A 12-draft schedule is already whole and
 *      must not become 13.
 *
 *   2. The first draft falls in a LATER CALENDAR MONTH than the sale. If a
 *      draft lands in the sale month then the sale month is already paid for by
 *      the schedule and nothing was collected separately. Five of the 5-draft
 *      rows are in exactly that state.
 *
 * Month-to-month plans (totalPeriods 1) are left alone: there is no term to be
 * short of. PIF is untouched — invoiceTotal is already the whole amount.
 */
function billablePeriods(svc) {
  const periods = parseInt(svc.totalPeriods || '1', 10) || 1;
  if (periods <= 1) return Math.max(periods, 1);
  if (!PACKAGE_TERMS.includes(periods + 1)) return periods;

  const sale = monthIndex(svc.recurringServiceDates?.saleDate);
  const first = monthIndex(svc.recurringServiceDates?.firstBillingDate);
  // Unknown dates leave the schedule as ABC stated it. Guessing upward here
  // would pay a month on evidence we do not have.
  if (sale === null || first === null) return periods;

  return first > sale ? periods + 1 : periods;
}

const COMMISSION_RATE = 0.04;

function totalContractValue(svc) {
  const invoice = parseFloat(svc.invoiceTotal || '0') || 0;
  // For PIF the invoiceTotal IS the full amount; totalPeriods is typically 1.
  // For monthly recurring, multiply by the months actually owed.
  const periods = billablePeriods(svc);
  return Math.round(invoice * Math.max(periods, 1) * 100) / 100;
}

module.exports = { billablePeriods, totalContractValue, monthIndex, PACKAGE_TERMS, COMMISSION_RATE };

