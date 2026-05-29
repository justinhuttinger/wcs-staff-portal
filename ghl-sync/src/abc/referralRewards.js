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

/**
 * Process one referral reward end-to-end. Side effects happen only through the
 * injected dep functions, which makes it unit-testable.
 *
 * opts: { location, runId, abcMember, referrerAbcId, referrerContact, dryRun,
 *         today, fetchMemberInvoices, adjustInvoice, tagReferrer, recordReward }
 * Returns the referral_rewards row object that was (or would be) recorded.
 */
async function processReferralReward(opts) {
  const {
    location, runId, abcMember, referrerAbcId, referrerContact, dryRun,
    today, fetchMemberInvoices, adjustInvoice, tagReferrer, recordReward,
  } = opts;

  const friendName = `${abcMember.first_name || ''} ${abcMember.last_name || ''}`.trim();
  const row = {
    run_id: runId,
    club_number: location.clubNumber,
    location_id: location.id,
    new_member_id: abcMember.member_id,
    new_member_name: `${abcMember.first_name || ''} ${abcMember.last_name || ''}`.trim() || null,
    referrer_abc_id: referrerAbcId,
    referrer_ghl_contact_id: referrerContact?.id || null,
    dues_invoice_due_date: null,
    dues_status: 'error',
    sms_status: 'skipped',
    needs_review: false,
    dry_run: !!dryRun,
    error: null,
  };

  if (dryRun) {
    console.log(`[Referral] DRY_RUN would reward referrer ${referrerAbcId} for new member ${abcMember.member_id}`);
    return row;
  }

  // 1. Find the next DUES invoice for the referrer.
  let invoices;
  try {
    invoices = await fetchMemberInvoices(location.clubNumber, referrerAbcId);
  } catch (err) {
    row.dues_status = 'error';
    row.error = `fetch invoices failed: ${err.message}`;
    await recordReward(row);
    return row;
  }

  const invoice = pickNextDuesInvoice(invoices, today);
  if (!invoice) {
    row.dues_status = 'no_dues_invoice';
    row.sms_status = 'skipped';
    row.needs_review = true;
    await recordReward(row);
    return row;
  }
  row.dues_invoice_due_date = invoice.dueDate;

  // 2. Zero it. Must succeed before we touch the SMS-triggering tag.
  let result;
  try {
    result = await adjustInvoice(location.clubNumber, referrerAbcId, buildAdjustmentBody(invoice.dueDate));
  } catch (err) {
    row.dues_status = 'error';
    row.error = `invoice adjustment failed: ${err.message}`;
    await recordReward(row);
    return row;
  }
  if (!result.ok) {
    row.dues_status = 'error';
    row.error = `invoice adjustment not ok: ${JSON.stringify(result.data?.status || result.status)}`;
    await recordReward(row);
    return row;
  }
  row.dues_status = 'zeroed';

  // 3. Dues confirmed zeroed. Only now do we trigger the SMS via the tag.
  if (!referrerContact?.id) {
    row.sms_status = 'no_referrer_contact';
    row.needs_review = true;
    await recordReward(row);
    return row;
  }
  try {
    await tagReferrer(referrerContact.id, friendName);
    row.sms_status = 'tagged';
  } catch (err) {
    row.sms_status = 'error';
    row.needs_review = true;
    row.error = `tag write failed (dues already zeroed): ${err.message}`;
  }

  await recordReward(row);
  return row;
}

module.exports = { pickNextDuesInvoice, isEligibleCandidate, buildAdjustmentBody, processReferralReward };
