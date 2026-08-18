// Pure trigger-rule and date logic for the NPS cohort job.
//
// Everything here is a string-in / string-out function over 'YYYY-MM-DD' dates
// so the nightly job can be reasoned about and tested without a database, a
// clock, or a timezone surprise. abc_members.begin_date and .member_status_date
// are `date` columns, so string comparison is exact.

const PACIFIC = 'America/Los_Angeles';

// en-CA formats as YYYY-MM-DD, which is what we want to compare against a
// Postgres `date`. Doing this with getUTC* would be off by a day for the whole
// evening in Pacific, every day.
const pacificFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit',
});

function pacificToday(now = new Date()) {
  return pacificFormatter.format(now);
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Calendar-month subtraction with end-of-month clamping: six months before
// 2026-08-31 is 2026-02-28, because 2026-02-31 does not exist.
//
// The clamp means a member who joined 2026-02-28 matches on BOTH 2026-08-28
// (their true anniversary) and 2026-08-31 (the clamped one). The global
// resend_cooldown_days suppression is what stops that becoming a second email;
// the unique index does not, because the two trigger_dates genuinely differ.
function subMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let ty = y;
  let tm = m - months;
  while (tm <= 0) { tm += 12; ty -= 1; }
  // Day 0 of the following month is the last day of month `tm`.
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

// The back-window: today first, then backwards. A night the worker was down
// self-heals on the next run instead of silently dropping that day's cohort.
function targetDates(today, windowDays) {
  const days = Math.max(1, Number(windowDays) || 1);
  return Array.from({ length: days }, (_, i) => addDays(today, -i));
}

function isJobTrigger(triggerType) {
  return triggerType === 'tenure_days'
    || triggerType === 'tenure_months'
    || triggerType === 'status_change';
}

// Translate one survey's rule into the filters the cohort query applies.
function cohortFilters(survey, targetDate) {
  const type = survey.trigger_type;
  if (type === 'tenure_days') {
    return { beginDate: addDays(targetDate, -Number(survey.trigger_value)), requireActive: true };
  }
  if (type === 'tenure_months') {
    return { beginDate: subMonths(targetDate, Number(survey.trigger_value)), requireActive: true };
  }
  if (type === 'status_change') {
    return {
      memberStatus: survey.trigger_status,
      memberStatusDate: targetDate,
      // A cancelled member is by definition not active — requiring it would
      // return an empty cohort every night.
      requireActive: false,
    };
  }
  throw new Error(`cohortFilters: walkup surveys have no cohort (trigger_type=${type})`);
}

module.exports = {
  pacificToday, addDays, subMonths, targetDates, cohortFilters, isJobTrigger,
};
