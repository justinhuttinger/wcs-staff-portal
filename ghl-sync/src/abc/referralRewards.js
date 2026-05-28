// ghl-sync/src/abc/referralRewards.js
const referral = require('../config/referral');

/**
 * Earliest invoice with profitCenterAbcCode === DUES and dueDate >= today.
 * Dates are YYYY-MM-DD strings (lexicographic compare is safe).
 * @returns {object|null}
 */
function pickNextDuesInvoice(invoices, today) {
  const dues = (invoices || [])
    .filter((i) => i && i.profitCenterAbcCode === referral.DUES_PROFIT_CENTER)
    .filter((i) => i.dueDate && i.dueDate >= today)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return dues[0] || null;
}

/**
 * Decide whether a referred member should be processed this cycle.
 * @returns {{eligible: boolean, reason: string}}
 */
function isEligibleCandidate({ abcMember, referredByValue, existingRow, programStartDate }) {
  const ref = (referredByValue || '').trim();
  if (!ref) return { eligible: false, reason: 'no_referrer' };
  if (!abcMember || abcMember.is_active !== true) return { eligible: false, reason: 'inactive' };
  if (ref === abcMember.member_id) return { eligible: false, reason: 'self_referral' };
  const signDate = abcMember.sign_date || abcMember.since_date || '';
  if (!signDate || signDate < programStartDate) return { eligible: false, reason: 'before_program_start' };
  if (existingRow) {
    const s = existingRow.dues_status;
    if (s === 'zeroed' || s === 'no_dues_invoice') return { eligible: false, reason: 'terminal' };
    // s === 'error' (or anything else) → retry
  }
  return { eligible: true, reason: 'ok' };
}

/** Body for POST /agreements/invoiceadjustment that zeroes one DUES invoice. */
function buildAdjustmentBody(dueDate) {
  return {
    startDate: dueDate,
    profitCenterAbcCode: referral.DUES_PROFIT_CENTER,
    invoiceAmount: referral.ADJUST_AMOUNT,
    numberOfInvoices: referral.NUMBER_OF_INVOICES,
  };
}

module.exports = { pickNextDuesInvoice, isEligibleCandidate, buildAdjustmentBody };
