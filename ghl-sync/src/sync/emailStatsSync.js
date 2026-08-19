const LOCATIONS = require('../config/locations');
const { EMAIL_SOURCES, STATS_DELAY_MS, listCampaigns, getCampaignStats, transformRow } = require('../ghl/emailCampaigns');
const { upsertEmailStats } = require('../db/upsertEmailStats');
const { upsertEmailStatsDaily, snapshotRow } = require('../db/upsertEmailStatsDaily');
const { writeSyncLog } = require('./syncLog');
const { sleep } = require('../ghl/client');

// Pull GHL email campaign performance for one location across all three sources,
// joining each send to its stats, then upsert. Partial failures (a source that
// errors, or a single send whose stats are unavailable e.g. non-Mailgun) are
// logged and skipped rather than failing the whole location.
async function emailStatsSyncForLocation(loc) {
  const startedAt = new Date().toISOString();
  const rows = [];
  const skipped = [];
  let fetched = 0;

  for (const { listSegment, statsSource } of EMAIL_SOURCES) {
    let records;
    try {
      records = await listCampaigns(loc.id, listSegment, loc.apiKey);
    } catch (err) {
      const code = err.response?.status || err.message;
      console.warn(`[EmailStats] ${loc.name}: list "${listSegment}" failed (${code}) — skipping source`);
      skipped.push({ source: statsSource, stage: 'list', reason: String(code) });
      continue;
    }

    for (const rec of records) {
      if (!rec.sourceId) continue;
      let stats;
      try {
        stats = await getCampaignStats(loc.id, statsSource, rec.sourceId, loc.apiKey);
      } catch (err) {
        const code = err.response?.status || err.message;
        console.warn(`[EmailStats] ${loc.name}: stats ${statsSource}/${rec.sourceId} failed (${code}) — skipping send`);
        skipped.push({ source: statsSource, sourceId: rec.sourceId, stage: 'stats', reason: String(code) });
        continue;
      }
      rows.push(transformRow(loc, statsSource, rec, stats));
      fetched++;
      await sleep(STATS_DELAY_MS); // ~120ms between stats calls -> under 100 req / 10s
    }
  }

  const { upserted, errors } = rows.length ? await upsertEmailStats(rows) : { upserted: 0, errors: [] };

  // Freeze today's cumulative counters so period figures are derivable later.
  // Snapshot failures are logged but never fail the run: email_stats (the
  // live view) is the primary write, this is the history feed.
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const snapshots = rows.map(r => snapshotRow(r, snapshotDate));
  const snap = snapshots.length
    ? await upsertEmailStatsDaily(snapshots)
    : { upserted: 0, errors: [] };
  if (snap.errors.length) {
    console.warn(`[EmailStats] ${loc.name}: ${snap.errors.length} snapshot batch error(s)`);
  }

  await writeSyncLog({
    syncType: 'email-stats',
    entity: 'email_stats',
    locationId: loc.id,
    recordsFetched: fetched,
    recordsUpserted: upserted,
    errors: [...errors, ...snap.errors, ...skipped],
    startedAt,
  });

  return { location: loc.name, fetched, upserted, skipped, errors };
}

// Sync every configured location, one fully before the next (simple rate-limit
// accounting). Returns a per-run summary; never throws out of the loop.
async function emailStatsSync() {
  const summary = [];
  for (const loc of LOCATIONS) {
    try {
      const r = await emailStatsSyncForLocation(loc);
      summary.push(r);
      console.log(`[EmailStats] ${loc.name}: fetched=${r.fetched} upserted=${r.upserted} skipped=${r.skipped.length}`);
    } catch (err) {
      console.error(`[EmailStats] ${loc.name}: FAILED — ${err.message}`);
      summary.push({ location: loc.name, error: err.message });
    }
  }
  console.log('[EmailStats] Run summary:', JSON.stringify(summary));
  return summary;
}

async function emailStatsSyncForSlug(slug) {
  const loc = LOCATIONS.find(l => l.slug === slug);
  if (!loc) throw new Error(`Unknown location slug: ${slug}`);
  return emailStatsSyncForLocation(loc);
}

module.exports = { emailStatsSync, emailStatsSyncForLocation, emailStatsSyncForSlug };
