// auth/src/services/kpiDigest/config.js
// Static config for the weekly Operandio KPI digest.
'use strict'

module.exports = {
  // Operandio placement. Category "Resources", area of work "Corporate"
  // (Justin + corporate staff — the tightest existing group; Operandio has no
  // API to create a solo group, and admins see restricted articles regardless).
  CATEGORY_ID: '68ed517d4a4a7b306f022687',
  GROUP_ID: '68e745b44a40788106a874b8',

  // Title is also the dedupe key. Every article whose title matches this exactly
  // is deleted after a successful create, which also cleans up a renamed
  // predecessor (e.g. the old "Daily KPI Digest ...").
  ARTICLE_TITLE: 'Weekly KPI Digest - Sales and Day One Bookings by Club',

  // A person is listed in the roster if they hit either bar in the week.
  MIN_SALES: 5,
  MIN_DAYONES: 2,

  // Cron: Monday 08:00 America/Los_Angeles. Gated behind the enable flag.
  CRON: '0 8 * * 1',
  TZ: 'America/Los_Angeles',
  ENABLED_ENV: 'OPERANDIO_KPI_DIGEST_ENABLED',
}
