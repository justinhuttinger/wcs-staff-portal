// ghl-sync/src/config/referral.js
/**
 * Referral Rewards configuration.
 * Field keys are identical across all 7 GHL sub-accounts.
 */
module.exports = {
  // Master on/off. Ship dark; enable after the GHL workflow exists.
  ENABLED: process.env.REFERRAL_REWARDS_ENABLED === 'true',
  // Back-catalog fence: only members who signed on/after this date are eligible.
  PROGRAM_START_DATE: process.env.REFERRAL_PROGRAM_START_DATE || '2026-05-28',
  // New member's contact field holding the referrer's ABC member id.
  REFERRED_BY_FIELD_KEY: 'contact.referred_by_abc_id',
  // Referrer's contact field we write the new member's first name into (for the SMS).
  FRIEND_NAME_FIELD_KEY: 'contact.referral_friend_name',
  // Tag added to the referrer's contact to trigger the GHL SMS workflow.
  REWARD_TAG: 'referral reward',
  // ABC invoice adjustment params.
  DUES_PROFIT_CENTER: 'DUES',
  ADJUST_AMOUNT: '0.00',
  NUMBER_OF_INVOICES: '1',
};
