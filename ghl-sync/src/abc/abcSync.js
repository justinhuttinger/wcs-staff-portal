const crypto = require('crypto');
const LOCATIONS = require('../config/locations');
const { fetchAllABCMembers, transformABCMember } = require('./client');
const { upsertABCMembers } = require('./upsertMembers');
const { reconcileLocation } = require('./reconcile');
const { writeSyncLog } = require('../sync/syncLog');

/**
 * Run the full ABC sync for all locations:
 * 1. Fetch all members from ABC API per club
 * 2. Upsert into abc_members table
 * 3. Reconcile against GHL contacts (tags + custom fields)
 */
async function abcSync() {
  const runId = crypto.randomUUID();
  const locationsWithClub = LOCATIONS.filter(l => l.clubNumber);

  console.log(`[ABC Sync] Starting run ${runId} for ${locationsWithClub.length} locations (DRY_RUN=${process.env.DRY_RUN || 'true'})`);
  const start = Date.now();

  for (const location of locationsWithClub) {
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

      await writeSyncLog({
        syncType: 'abc',
        entity: 'abc_members',
        locationId: location.id,
        recordsFetched: rawMembers.length,
        recordsUpserted: upsertResult.upserted,
        errors: [
          ...upsertResult.errors,
          ...(reconcileResult.errors > 0 ? [{ ghl_errors: reconcileResult.errors }] : []),
        ],
        startedAt: syncStart,
      });

    } catch (err) {
      console.error(`[ABC Sync] ${location.name} failed:`, err.message);
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

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[ABC Sync] Run ${runId} complete in ${duration}s`);
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

  const rawMembers = await fetchAllABCMembers(location.clubNumber);
  const transformed = rawMembers.map(m => transformABCMember(m, location.clubNumber));
  await upsertABCMembers(transformed);
  await reconcileLocation(location, runId);

  return runId;
}

module.exports = { abcSync, abcSyncForLocation };
