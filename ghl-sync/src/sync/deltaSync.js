const LOCATIONS = require('../config/locations');
const supabase = require('../db/supabase');
const { fetchContactsDelta, transformContact } = require('../ghl/contacts');
const { fetchOpportunitiesDelta, transformOpportunity } = require('../ghl/opportunities');
const { upsertContacts } = require('../db/upsertContacts');
const { upsertOpportunities } = require('../db/upsertOpportunities');
const { writeSyncLog } = require('./syncLog');

async function getLastDeltaSync() {
  const { data } = await supabase
    .from('ghl_sync_state')
    .select('value')
    .eq('key', 'last_delta_sync')
    .single();

  return data?.value || null;
}

async function updateLastDeltaSync(timestamp) {
  await supabase
    .from('ghl_sync_state')
    .upsert({
      key: 'last_delta_sync',
      value: timestamp,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
}

async function deltaSync() {
  const lastSync = await getLastDeltaSync();

  if (!lastSync) {
    console.log('[Delta] No previous delta sync found — skipping (full sync needed first)');
    return;
  }

  console.log(`[Delta] Starting delta sync since ${lastSync}`);
  const start = Date.now();
  const syncTimestamp = new Date().toISOString();

  for (const location of LOCATIONS) {
    // Contacts delta
    let ctStart = new Date().toISOString();
    try {
      const rawContacts = await fetchContactsDelta(location.id, lastSync);
      if (rawContacts.length > 0) {
        const contacts = rawContacts.map(c => transformContact(c, location.id));
        const result = await upsertContacts(contacts);
        console.log(`[Delta] ${location.name}: ${rawContacts.length} contacts updated, ${result.upserted} upserted`);
        await writeSyncLog({ syncType: 'delta', entity: 'contacts', locationId: location.id, recordsFetched: rawContacts.length, recordsUpserted: result.upserted, errors: result.errors, startedAt: ctStart });
      }
    } catch (err) {
      console.error(`[Delta] ${location.name} contacts failed:`, err.message);
      await writeSyncLog({ syncType: 'delta', entity: 'contacts', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: ctStart });
    }

    // Opportunities delta
    let opStart = new Date().toISOString();
    try {
      const rawOpps = await fetchOpportunitiesDelta(location.id, lastSync);
      if (rawOpps.length > 0) {
        const opps = rawOpps.map(o => transformOpportunity(o, location.id));
        const result = await upsertOpportunities(opps);
        console.log(`[Delta] ${location.name}: ${rawOpps.length} opportunities updated, ${result.upserted} upserted`);
        await writeSyncLog({ syncType: 'delta', entity: 'opportunities', locationId: location.id, recordsFetched: rawOpps.length, recordsUpserted: result.upserted, errors: result.errors, startedAt: opStart });
      }
    } catch (err) {
      console.error(`[Delta] ${location.name} opportunities failed:`, err.message);
      await writeSyncLog({ syncType: 'delta', entity: 'opportunities', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: opStart });
    }
  }

  await updateLastDeltaSync(syncTimestamp);
  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Delta] Delta sync complete in ${duration}s`);
}

module.exports = { deltaSync };
