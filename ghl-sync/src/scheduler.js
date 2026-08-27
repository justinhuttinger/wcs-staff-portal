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
const { emailStatsSync } = require('./sync/emailStatsSync');
const { smsStatsSync } = require('./sync/smsStatsSync');
const { enrichAll: enrichAttributionAll } = require('./sync/attributionEnrich');
const { runLapsedTaggingAll } = require('./abc/lapsedTaggingJob');
const { runNpsAll } = require('./nps/npsJob');

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

  // Member check-in months — nightly. This table is what the conditional
  // membership rule reads (A2 CORE and Active and Fit Limited count only if
  // they visited in the last two months), and what the check-in charts on Club
  // Activity Trends and Topline draw from.
  //
  // It had NO refresh job at all: it was backfilled by hand and would have
  // decayed from the day that stopped, silently dropping members out of every
  // headcount in the Analytics tab as their last recorded visit aged past the
  // window. Runs after the ABC sync so the day's check-ins are already posted.
  const checkinMonthsHour = Number(process.env.CHECKIN_MONTHS_SYNC_HOUR || 5); // PST
  const checkinMonthsHourUTC = (checkinMonthsHour + 8) % 24;
  cron.schedule(`15 ${checkinMonthsHourUTC} * * *`, async () => {
    console.log('[Scheduler] Starting member check-in months refresh...');
    try {
      const { refreshRecentMonths } = require('../scripts/backfill-member-checkin-months');
      const summary = await refreshRecentMonths({ count: 2 });
      const visits = summary.reduce((a, s) => a + s.visits, 0);
      console.log(`[Scheduler] Check-in months refreshed: ${summary.length} club-months, ${visits.toLocaleString()} check-ins`);
    } catch (err) {
      console.error('[Scheduler] Check-in months refresh failed:', err.message);
      await alertSyncFailed(err).catch(() => {});
    }
  });

  // Attribution enrichment — nightly incremental pass over recently added
  // contacts. The bulk contact sync (GET /contacts/) never returns
  // attributionSource, so without this the attribution_source columns only
  // ever get populated by a manual full backfill (the FB ROAS "memberships
  // sold" count silently went to 0 when the May 2026 backfill aged out).
  // The lookback window re-scans each contact for ~5 weeks, catching leads
  // that convert (get retagged) well after their first touch.
  const attributionSyncHour = Number(process.env.ATTRIBUTION_SYNC_HOUR || 5); // PST
  const attributionSyncHourUTC = (attributionSyncHour + 8) % 24;
  const attributionLookbackDays = Number(process.env.ATTRIBUTION_LOOKBACK_DAYS || 35);
  let attributionRunning = false;
  cron.schedule(`0 ${attributionSyncHourUTC} * * *`, async () => {
    if (attributionRunning) {
      console.warn('[Scheduler] Previous attribution enrichment still running — skipping');
      return;
    }
    attributionRunning = true;
    console.log('[Scheduler] Starting attribution enrichment...');
    try {
      await enrichAttributionAll({ sinceDays: attributionLookbackDays });
    } catch (err) {
      console.error('[Scheduler] Attribution enrichment failed:', err.message);
      await alertSyncFailed(err).catch(() => {});
    } finally {
      attributionRunning = false;
    }
  });

  // GHL email campaign stats — every N minutes (default 30; stats don't need to
  // be fresher than the other syncs). Logged-and-skipped on failure, never fatal.
  const emailStatsIntervalMinutes = process.env.EMAIL_STATS_INTERVAL_MINUTES || 30;
  cron.schedule(`*/${emailStatsIntervalMinutes} * * * *`, async () => {
    console.log('[Scheduler] Starting email stats sync...');
    try {
      await emailStatsSync();
    } catch (err) {
      console.error('[Scheduler] Email stats sync failed:', err.message);
    }
  });

  // SMS message sync can walk up to 20k conversations with a ~120ms sleep per
  // fetch, so a run can plausibly outlast the default 60-minute interval
  // (especially the first run for a location). Unlike email-stats, this needs
  // an overlap guard so a slow run doesn't get a second one stacked on top.
  const smsStatsIntervalMinutes = process.env.SMS_STATS_INTERVAL_MINUTES || 60;
  let smsStatsRunning = false;
  cron.schedule(`*/${smsStatsIntervalMinutes} * * * *`, async () => {
    if (smsStatsRunning) {
      console.warn('[Scheduler] Previous SMS stats sync still running — skipping this tick');
      return;
    }
    smsStatsRunning = true;
    try {
      await smsStatsSync();
    } catch (err) {
      console.error('[Scheduler] SMS stats sync failed:', err.message);
    } finally {
      smsStatsRunning = false;
    }
  });

  // Lapsed check-in tagging — nightly, dark-launched behind LAPSED_TAGGING_ENABLED
  // (default off). Tags active members lapsed 10/21/30 days for GHL win-back
  // workflows. Defaults to dry-run (log-only, no tag writes) until the rollout
  // flips LAPSED_TAGGING_DRY_RUN=false. See ghl-sync/src/abc/lapsedTaggingJob.js.
  if (process.env.LAPSED_TAGGING_ENABLED === 'true') {
    const lapsedTaggingHour = Number(process.env.LAPSED_TAGGING_HOUR || 5); // PST
    const lapsedTaggingHourUTC = (lapsedTaggingHour + 8) % 24;
    const lapsedTaggingDryRun = process.env.LAPSED_TAGGING_DRY_RUN !== 'false'; // default true
    let lapsedTaggingRunning = false;
    cron.schedule(`0 ${lapsedTaggingHourUTC} * * *`, async () => {
      if (lapsedTaggingRunning) {
        console.warn('[Scheduler] Previous lapsed tagging run still running — skipping');
        return;
      }
      lapsedTaggingRunning = true;
      console.log('[Scheduler] Starting lapsed check-in tagging...');
      try {
        const summary = await runLapsedTaggingAll({ dryRun: lapsedTaggingDryRun });
        console.log('[Scheduler] Lapsed tagging results:', JSON.stringify(summary));
      } catch (err) {
        console.error('[Scheduler] Lapsed tagging failed:', err.message);
        await alertSyncFailed(err).catch(() => {});
      } finally {
        lapsedTaggingRunning = false;
      }
    });
    console.log(`[Scheduler] Lapsed tagging scheduled daily at ${lapsedTaggingHour}:00 PST (${lapsedTaggingHourUTC}:00 UTC), dryRun=${lapsedTaggingDryRun}`);
  }

  // NPS lifecycle surveys — nightly, dark-launched behind NPS_ENABLED (default
  // off). Creates nps_invites rows for members hitting a milestone and tags
  // them in GHL so a workflow sends the email. Defaults to dry-run (invites
  // recorded, no GHL writes) until the rollout flips NPS_TAGGING_DRY_RUN=false.
  // See ghl-sync/src/nps/npsJob.js.
  if (process.env.NPS_ENABLED === 'true') {
    const npsHour = Number(process.env.NPS_HOUR || 7); // PST
    const npsHourUTC = (npsHour + 8) % 24;
    const npsDryRun = process.env.NPS_TAGGING_DRY_RUN !== 'false'; // default true
    let npsRunning = false;
    cron.schedule(`0 ${npsHourUTC} * * *`, async () => {
      if (npsRunning) {
        console.warn('[Scheduler] Previous NPS run still running — skipping');
        return;
      }
      npsRunning = true;
      console.log('[Scheduler] Starting NPS cohort job...');
      try {
        const summary = await runNpsAll({ dryRun: npsDryRun });
        console.log('[Scheduler] NPS results:', JSON.stringify(summary));
      } catch (err) {
        console.error('[Scheduler] NPS job failed:', err.message);
        await alertSyncFailed(err).catch(() => {});
      } finally {
        npsRunning = false;
      }
    });
    console.log(`[Scheduler] NPS scheduled daily at ${npsHour}:00 PST (${npsHourUTC}:00 UTC), dryRun=${npsDryRun}`);
  }

  console.log(`[Scheduler] Check-in months refresh daily at ${checkinMonthsHour}:15 PST (${checkinMonthsHourUTC}:15 UTC)`);
  console.log(`[Scheduler] Delta sync every ${intervalMinutes}m, full sync daily at ${fullSyncHour}:00 PST (${fullSyncHourUTC}:00 UTC)`);
  console.log(`[Scheduler] Email stats sync every ${emailStatsIntervalMinutes}m`);
  console.log(`[Scheduler] SMS stats sync every ${smsStatsIntervalMinutes}m`);
  console.log(`[Scheduler] Attribution enrichment daily at ${attributionSyncHour}:00 PST (${attributionSyncHourUTC}:00 UTC), lookback ${attributionLookbackDays}d`);
  console.log(`[Scheduler] Recurring PT sync daily at ${recurringPtHour}:30 PST (${recurringPtHourUTC}:30 UTC)`);
  console.log(`[Scheduler] Revenue gap check daily at ${revenueGapCheckHour}:00 UTC`);
  console.log(`[Scheduler] Payroll recurring sync daily at ${payrollSyncHour}:00 PST (${payrollSyncHourUTC}:00 UTC)`);
  console.log(`[Scheduler] ABC sync every ${abcIntervalMinutes}m (DRY_RUN=${process.env.DRY_RUN || 'true'})`);
}

module.exports = { startScheduler };
