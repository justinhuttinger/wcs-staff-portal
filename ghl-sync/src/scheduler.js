const cron = require('node-cron');
const { fullSync } = require('./sync/fullSync');
const { deltaSync } = require('./sync/deltaSync');
const { crossLocCleanup } = require('./sync/crossLocCleanup');
const { abcSync } = require('./abc/abcSync');
const { syncPayrollRecurringWindow } = require('./abc/recurringServices');
const { syncRecurringPtServices } = require('./abc/recurringPtServices');
const { alertSyncFailed } = require('./alerts');
const { runMediaIndex } = require('./media/mediaIndex');
const { checkRevenueGaps } = require('./revenue/gapCheck');

function startScheduler() {
  const intervalMinutes = process.env.SYNC_INTERVAL_MINUTES || 10;
  const fullSyncHour = process.env.FULL_SYNC_HOUR || 3; // PST
  // Convert PST to UTC: PST + 8 = UTC (or +7 during PDT)
  const fullSyncHourUTC = (parseInt(fullSyncHour) + 8) % 24;

  const abcIntervalMinutes = process.env.ABC_SYNC_INTERVAL_MINUTES || 30;

  // Run-locks: node-cron does not prevent overlapping runs, so a slow run could
  // otherwise start a second concurrent pass and double-touch the shared cursor.
  let deltaRunning = false;
  let fullRunning = false;

  // Delta sync every N minutes. Cross-location lead cleanup piggybacks
  // on the delta cycle — it needs the freshly synced contact data to
  // detect new drift (people who just got the `sale` tag at a sister
  // club). Failures on either step are logged but never bring the cron
  // down.
  cron.schedule(`*/${intervalMinutes} * * * *`, async () => {
    if (deltaRunning) {
      console.warn('[Scheduler] Previous delta sync still running — skipping this tick');
      return;
    }
    deltaRunning = true;
    console.log('[Scheduler] Starting delta sync...');
    let deltaOk = false;
    try {
      await deltaSync();
      deltaOk = true;
    } catch (err) {
      console.error('[Scheduler] Delta sync failed:', err.message);
    }
    if (deltaOk) {
      try {
        await crossLocCleanup();
      } catch (err) {
        console.error('[Scheduler] Cross-loc cleanup failed:', err.message);
      }
    }
    deltaRunning = false;
  });

  // Full re-sync daily
  cron.schedule(`0 ${fullSyncHourUTC} * * *`, async () => {
    if (fullRunning) {
      console.warn('[Scheduler] Previous full sync still running — skipping');
      return;
    }
    fullRunning = true;
    console.log('[Scheduler] Starting daily full sync...');
    try {
      await fullSync();
    } catch (err) {
      console.error('[Scheduler] Full sync failed:', err.message);
    } finally {
      fullRunning = false;
    }
  });

  // ABC sync every N minutes (default 30)
  cron.schedule(`*/${abcIntervalMinutes} * * * *`, async () => {
    console.log('[Scheduler] Starting ABC sync...');
    try {
      await abcSync();
    } catch (err) {
      console.error('[Scheduler] ABC sync failed:', err.message);
      await alertSyncFailed(err).catch(() => {});
    }
  });

  // PT sales commissions (ABC recurring services) — daily, previous + current
  // month, so the Payroll report stays fresh intra-month and late-posted
  // sales keep reconciling after the month closes. Replaces the manual
  // scripts/sync-payroll-recurring.js run (still available for backfills).
  const payrollSyncHour = process.env.PAYROLL_SYNC_HOUR || 4; // PST
  const payrollSyncHourUTC = (parseInt(payrollSyncHour) + 8) % 24;
  cron.schedule(`0 ${payrollSyncHourUTC} * * *`, async () => {
    console.log('[Scheduler] Starting payroll recurring sync...');
    try {
      await syncPayrollRecurringWindow();
    } catch (err) {
      console.error('[Scheduler] Payroll recurring sync failed:', err.message);
      await alertSyncFailed(err).catch(() => {});
    }
  });

  // Media library index — daily at MEDIA_INDEX_HOUR UTC (default 08:00 UTC ~ 1am PT).
  const mediaIndexHour = Number(process.env.MEDIA_INDEX_HOUR || 8)
  cron.schedule(`0 ${mediaIndexHour} * * *`, () => {
    console.log('[Scheduler] Starting media index...')
    runMediaIndex().catch((err) => console.error('[Scheduler] Media index failed:', err.message))
  })

  // Revenue report gap check — daily. ABC's daily "Revenue by Profit Center"
  // email feeds the Revenue report; a missed email leaves a silent hole (no row
  // is logged for a no-show). Run late enough that the day's email has surely
  // arrived (observed latest ~18:00 UTC), then SMS-alert on any gap.
  const revenueGapCheckHour = Number(process.env.REVENUE_GAP_CHECK_HOUR || 20); // UTC
  cron.schedule(`0 ${revenueGapCheckHour} * * *`, () => {
    console.log('[Scheduler] Starting revenue gap check...');
    checkRevenueGaps().catch((err) => console.error('[Scheduler] Revenue gap check failed:', err.message));
  });

  // Active recurring PT agreements (PT Projections report) — daily. Heavy
  // 2020->today ABC scan per club; run it in the background so the report just
  // reads the table. Default 4:30am PST.
  const recurringPtHour = Number(process.env.RECURRING_PT_SYNC_HOUR || 4); // PST
  const recurringPtHourUTC = (recurringPtHour + 8) % 24;
  cron.schedule(`30 ${recurringPtHourUTC} * * *`, async () => {
    console.log('[Scheduler] Starting recurring PT services sync...');
    try {
      await syncRecurringPtServices();
    } catch (err) {
      console.error('[Scheduler] Recurring PT sync failed:', err.message);
      await alertSyncFailed(err).catch(() => {});
    }
  });

  console.log(`[Scheduler] Delta sync every ${intervalMinutes}m, full sync daily at ${fullSyncHour}:00 PST (${fullSyncHourUTC}:00 UTC)`);
  console.log(`[Scheduler] Recurring PT sync daily at ${recurringPtHour}:30 PST (${recurringPtHourUTC}:30 UTC)`);
  console.log(`[Scheduler] Revenue gap check daily at ${revenueGapCheckHour}:00 UTC`);
  console.log(`[Scheduler] Payroll recurring sync daily at ${payrollSyncHour}:00 PST (${payrollSyncHourUTC}:00 UTC)`);
  console.log(`[Scheduler] ABC sync every ${abcIntervalMinutes}m (DRY_RUN=${process.env.DRY_RUN || 'true'})`);
}

module.exports = { startScheduler };
