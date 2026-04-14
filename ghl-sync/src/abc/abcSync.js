const crypto = require('crypto');
const LOCATIONS = require('../config/locations');
const { fetchAllABCMembers, transformABCMember } = require('./client');
const { upsertABCMembers } = require('./upsertMembers');
const { reconcileLocation } = require('./reconcile');

// Prevent concurrent sync runs (cron overlap or manual + cron)
let abcSyncRunning = false;
let abcSyncAbort = false;

function stopAbcSync() {
  if (!abcSyncRunning) return false;
  abcSyncAbort = true;
  console.log('[ABC Sync] Abort requested — will stop after current location');
  return true;
}

function isAbcSyncRunning() { return abcSyncRunning; }
const { employeeSync } = require('./employeeSync');
const { writeSyncLog } = require('../sync/syncLog');
const { alertSyncFailed, alertSyncErrors } = require('../alerts');

/**
 * Run the full ABC sync for all locations:
 * 1. Fetch all members from ABC API per club
 * 2. Upsert into abc_members table
 * 3. Reconcile against GHL contacts (tags + custom fields)
 * 4. Sync employee dropdowns
 */
async function abcSync() {
  if (abcSyncRunning) {
    console.log('[ABC Sync] Already running — skipping this cycle');
    return null;
  }
  abcSyncRunning = true;

  abcSyncAbort = false;
  try {
    return await _runAbcSync();
  } finally {
    abcSyncRunning = false;
    abcSyncAbort = false;
  }
}

async function _runAbcSync() {
  const runId = crypto.randomUUID();
  const locationsWithClub = LOCATIONS.filter(l => l.clubNumber);

  console.log(`[ABC Sync] Starting run ${runId} for ${locationsWithClub.length} locations (DRY_RUN=${process.env.DRY_RUN || 'true'})`);
  const start = Date.now();

  const locationErrors = {};
  let totalErrors = 0;

  for (const location of locationsWithClub) {
    if (abcSyncAbort) {
      console.log('[ABC Sync] Aborted by user');
      break;
    }
    const syncStart = new Date().toISOString();
    try {
      // Step 1: Fetch from ABC API
      console.log(`[ABC Sync] Fetching ABC members for ${location.name} (club ${location.clubNumber})...`);
      const rawMembers = await fetchAllABCMembers(location.clubNumber);
      console.log(`[ABC Sync] ${location.name}: ${rawMembers.length} members fetched from ABC`);

      // Step 2: Transform and upsert into Supabase
      const transformed = rawMembers.map(m => transformABCMember(m, location.clubNumber));
      const upsertResult = await upsertABCMembers(transformed);
      console.log(`[ABC Sync] ${location.name}: ${upsertResult.upserted} members upserted to Supabase`);

      // Step 3: Reconcile against GHL contacts
      const reconcileResult = await reconcileLocation(location, runId);

      const errors = [
        ...upsertResult.errors,
        ...(reconcileResult.errors > 0 ? [{ ghl_errors: reconcileResult.errors }] : []),
      ];

      if (errors.length > 0) {
        locationErrors[location.name] = errors.length;
        totalErrors += errors.length;
      }

      await writeSyncLog({
        syncType: 'abc',
        entity: 'abc_members',
        locationId: location.id,
        recordsFetched: rawMembers.length,
        recordsUpserted: upsertResult.upserted,
        errors,
        startedAt: syncStart,
      });

    } catch (err) {
      console.error(`[ABC Sync] ${location.name} failed:`, err.message);
      locationErrors[location.name] = 1;
      totalErrors++;

      await writeSyncLog({
        syncType: 'abc',
        entity: 'abc_members',
        locationId: location.id,
        recordsFetched: 0,
        recordsUpserted: 0,
        errors: [{ error: err.message }],
        startedAt: syncStart,
      });
    }
  }

  // Step 4: Employee dropdown sync (runs once daily, not every 30 min)
  const hour = new Date().getUTCHours();
  if (hour >= 10 && hour <= 11) { // ~3-4am PST
    try {
      console.log('[ABC Sync] Running employee dropdown sync...');
      const empResults = await employeeSync(locationsWithClub);
      const empErrors = empResults.filter(r => !r.success);
      if (empErrors.length > 0) {
        for (const e of empErrors) {
          locationErrors[e.location] = (locationErrors[e.location] || 0) + 1;
          totalErrors++;
        }
      }
    } catch (err) {
      console.error('[ABC Sync] Employee sync failed:', err.message);
      totalErrors++;
    }
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[ABC Sync] Run ${runId} complete in ${duration}s`);

  // Send alerts if there were errors
  if (totalErrors > 0) {
    await alertSyncErrors({ locationErrors, totalErrors });
  }

  return runId;
}

/**
 * Run ABC sync for a single location by slug.
 */
async function abcSyncForLocation(slug) {
  const location = LOCATIONS.find(l => l.slug === slug);
  if (!location) throw new Error(`Location not found: ${slug}`);
  if (!location.clubNumber) throw new Error(`No clubNumber configured for ${slug}`);

  const runId = crypto.randomUUID();
  console.log(`[ABC Sync] Single location run ${runId} for ${location.name}`);

  try {
    const rawMembers = await fetchAllABCMembers(location.clubNumber);
    const transformed = rawMembers.map(m => transformABCMember(m, location.clubNumber));
    await upsertABCMembers(transformed);
    await reconcileLocation(location, runId);
  } catch (err) {
    await alertSyncFailed(err);
    throw err;
  }

  return runId;
}

module.exports = { abcSync, abcSyncForLocation, stopAbcSync, isAbcSyncRunning };
