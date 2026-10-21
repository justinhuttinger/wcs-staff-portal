// ghl-sync/src/abc/referralRewards.js
const referral = require('../config/referral');

// A reward was applied (or there was nothing to apply it to): never retried.
const TERMINAL_DUES_STATUSES = ['zeroed', 'discounted', 'no_dues_invoice'];

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
function isEligibleCandidate({ abcMember, referredByValue, existingRow, programStartDate, requireNewMember }) {
  const ref = (referredByValue || '').trim();
  if (!ref) return { eligible: false, reason: 'no_referrer' };
  if (!abcMember || abcMember.is_active !== true) return { eligible: false, reason: 'inactive' };
  if (ref === abcMember.member_id) return { eligible: false, reason: 'self_referral' };
  const signDate = abcMember.sign_date || abcMember.since_date || '';
  if (!signDate || signDate < programStartDate) return { eligible: false, reason: 'before_program_start' };
  // sign_date moves when an existing member re-signs, and the agreement keeps
  // its old referral. since_date is the original join, so it stops a re-sign
  // from paying out the same referral again.
  if (requireNewMember && abcMember.since_date && abcMember.since_date < programStartDate) {
    return { eligible: false, reason: 'before_program_start' };
  }
  if (existingRow) {
    if (TERMINAL_DUES_STATUSES.includes(existingRow.dues_status)) return { eligible: false, reason: 'terminal' };
    // 'error' (or anything else) → retry
  }
  return { eligible: true, reason: 'ok' };
}

/** The reward the referrer's home club gives: a free month unless configured otherwise. */
function rewardFor(clubNumber) {
  const r = referral.REWARD_BY_CLUB[String(clubNumber)];
  return r && r.amountOff > 0 ? { amountOff: r.amountOff } : { amountOff: null };
}

/**
 * What the DUES invoice becomes, as ABC's "0.00" string. Never below zero.
 * Returns null when an amount-off reward meets an invoice with no usable amount.
 */
function rewardedAmount(reward, originalAmount) {
  if (!reward.amountOff) return referral.ADJUST_AMOUNT;
  const orig = Number(originalAmount);
  if (originalAmount == null || originalAmount === '' || Number.isNaN(orig)) return null;
  return Math.max(0, orig - reward.amountOff).toFixed(2);
}

/** Body for POST /agreements/invoiceadjustment that sets one DUES invoice's amount. */
function buildAdjustmentBody(dueDate, invoiceAmount = referral.ADJUST_AMOUNT) {
  return {
    startDate: dueDate,
    profitCenterAbcCode: referral.DUES_PROFIT_CENTER,
    invoiceAmount,
    numberOfInvoices: referral.NUMBER_OF_INVOICES,
  };
}

function usDate(ymd) {
  const [y, m, d] = String(ymd || '').split('-');
  return y && m && d ? `${m}/${d}/${y}` : String(ymd || '');
}

/** Note left on the referrer's ABC profile once their dues are adjusted. */
function referralNote({ dueDate, originalAmount, newAmount = referral.ADJUST_AMOUNT, amountOff = null, friendName }) {
  const from = originalAmount != null && !Number.isNaN(Number(originalAmount))
    ? ` from $${Number(originalAmount).toFixed(2)}` : '';
  const friend = friendName ? ` for referring ${friendName}` : '';
  const what = amountOff ? `$${amountOff} off next month` : 'next month free';
  return `VIP referral reward${friend}: ${what}. DUES invoice due ${usDate(dueDate)} `
    + `adjusted${from} to $${Number(newAmount).toFixed(2)} automatically by WCS.`;
}

/**
 * Note left on a NEW member who came in as a VIP referral but whose ABC
 * agreement has no referring member. ABC's referral field itself can't be set:
 * PUT /members/{id}/referral is 401 for our API key.
 */
function vipWritebackNote({ referrerName, referrerAbcId }) {
  const who = referrerName || `member ${referrerAbcId}`;
  return `VIP referral: referred by ${who}. Added automatically by WCS from the VIP referral form.`;
}

/**
 * Process one referral reward end-to-end. Side effects happen only through the
 * injected dep functions, which makes it unit-testable.
 *
 * opts: { location, runId, abcMember, referrerAbcId, referrerClubNumber, referrerContact,
 *         source, writeback, dryRun, today, fetchMemberInvoices, adjustInvoice, addNote,
 *         tagReferrer, recordReward }
 *   referrerClubNumber  the referrer's ABC home club (defaults to this location's)
 *   source              'ghl' | 'abc', recorded on the row
 *   writeback           { referrerName, done } when the new member is a VIP referral whose
 *                       ABC agreement names no referrer; done = already noted on a prior run
 * Returns the referral_rewards row object that was (or would be) recorded.
 */
async function processReferralReward(opts) {
  const {
    location, runId, abcMember, referrerAbcId, referrerContact, source, writeback, dryRun,
    today, fetchMemberInvoices, adjustInvoice, addNote, tagReferrer, recordReward,
  } = opts;
  const referrerClub = opts.referrerClubNumber || location.clubNumber;
  const reward = rewardFor(referrerClub);

  const friendName = `${abcMember.first_name || ''} ${abcMember.last_name || ''}`.trim();
  const row = {
    run_id: runId,
    club_number: referrerClub,
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
    source: source || 'ghl',
    original_amount: null,
    new_amount: null,
    abc_writeback_status: writeback ? null : 'not_needed',
  };
  const appendError = (msg) => { row.error = [row.error, msg].filter(Boolean).join('; '); };

  if (dryRun) {
    console.log(`[Referral] DRY_RUN would reward referrer ${referrerAbcId} for new member ${abcMember.member_id}`);
    return row;
  }

  // 0. VIP referral that ABC doesn't know about: note it on the new member.
  // Best effort and independent of the reward.
  if (writeback) {
    if (writeback.done) {
      row.abc_writeback_status = 'noted';
    } else if (addNote) {
      try {
        const r = await addNote(location.clubNumber, abcMember.member_id,
          vipWritebackNote({ referrerName: writeback.referrerName, referrerAbcId }));
        row.abc_writeback_status = r.ok ? 'noted' : 'error';
        if (!r.ok) appendError(`abc writeback not ok: ${JSON.stringify(r.data?.status || r.status)}`);
      } catch (err) {
        row.abc_writeback_status = 'error';
        appendError(`abc writeback failed: ${err.message}`);
      }
    }
  }

  // 1. Find the next DUES invoice for the referrer.
  let invoices;
  try {
    invoices = await fetchMemberInvoices(referrerClub, referrerAbcId);
  } catch (err) {
    row.dues_status = 'error';
    appendError(`fetch invoices failed: ${err.message}`);
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
  const originalNum = Number(invoice.invoiceAmount);
  row.original_amount = invoice.invoiceAmount == null || Number.isNaN(originalNum) ? null : originalNum;

  const newAmount = rewardedAmount(reward, invoice.invoiceAmount);
  if (newAmount == null) {
    row.dues_status = 'error';
    row.needs_review = true;
    appendError(`DUES invoice ${invoice.dueDate} has no amount to take $${reward.amountOff} off`);
    await recordReward(row);
    return row;
  }

  // 2. Adjust it. Must succeed before we touch the SMS-triggering tag.
  let result;
  try {
    result = await adjustInvoice(referrerClub, referrerAbcId, buildAdjustmentBody(invoice.dueDate, newAmount));
  } catch (err) {
    row.dues_status = 'error';
    appendError(`invoice adjustment failed: ${err.message}`);
    await recordReward(row);
    return row;
  }
  if (!result.ok) {
    row.dues_status = 'error';
    appendError(`invoice adjustment not ok: ${JSON.stringify(result.data?.status || result.status)}`);
    await recordReward(row);
    return row;
  }
  row.new_amount = Number(newAmount);
  row.dues_status = reward.amountOff ? 'discounted' : 'zeroed';

  // Note the referrer's ABC profile so staff see why the invoice changed.
  // Best effort: a failed note never undoes the reward or blocks the SMS.
  if (addNote) {
    try {
      const noteResult = await addNote(referrerClub, referrerAbcId, referralNote({
        dueDate: invoice.dueDate, originalAmount: invoice.invoiceAmount,
        newAmount, amountOff: reward.amountOff, friendName,
      }));
      if (!noteResult.ok) appendError(`abc note not ok: ${JSON.stringify(noteResult.data?.status || noteResult.status)}`);
    } catch (err) {
      appendError(`abc note failed: ${err.message}`);
    }
  }

  // 3. Dues confirmed adjusted. Only now do we trigger the SMS via the tag.
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
    appendError(`tag write failed (dues already adjusted): ${err.message}`);
  }

  await recordReward(row);
  return row;
}

module.exports = {
  TERMINAL_DUES_STATUSES, pickNextDuesInvoice, isEligibleCandidate, rewardFor, rewardedAmount,
  buildAdjustmentBody, referralNote, vipWritebackNote, processReferralReward,
};
