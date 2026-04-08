const LOCATIONS = require('../config/locations');
const supabase = require('../db/supabase');
const { fetchCustomFields } = require('../ghl/customFields');
const { fetchPipelines } = require('../ghl/pipelines');
const { fetchAllContacts, transformContact } = require('../ghl/contacts');
const { fetchAllOpportunities, transformOpportunity } = require('../ghl/opportunities');
const { upsertContacts } = require('../db/upsertContacts');
const { upsertOpportunities } = require('../db/upsertOpportunities');
const { upsertPipelines } = require('../db/upsertPipelines');
const { upsertCustomFields } = require('../db/upsertCustomFields');
const { writeSyncLog } = require('./syncLog');

async function syncLocation(location, syncType) {
  console.log(`[Sync] Starting ${syncType} sync for ${location.name} (${location.id})`);

  // 1. Upsert location record
  await supabase.from('ghl_locations').upsert({
    id: location.id,
    name: location.name,
    slug: location.slug,
  }, { onConflict: 'id' });

  // 2. Custom fields
  let cfStart = new Date().toISOString();
  try {
    const rawFields = await fetchCustomFields(location.id);
    const cfResult = await upsertCustomFields(rawFields, location.id);
    console.log(`[Sync] ${location.name}: ${cfResult.upserted} custom field defs`);
    await writeSyncLog({ syncType, entity: 'custom_fields', locationId: location.id, recordsFetched: rawFields.length, recordsUpserted: cfResult.upserted, errors: cfResult.errors, startedAt: cfStart });
  } catch (err) {
    console.error(`[Sync] ${location.name} custom fields failed:`, err.message);
    await writeSyncLog({ syncType, entity: 'custom_fields', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: cfStart });
  }

  // 3. Pipelines + stages
  let pipStart = new Date().toISOString();
  try {
    const rawPipelines = await fetchPipelines(location.id);
    const pipResult = await upsertPipelines(rawPipelines, location.id);
    console.log(`[Sync] ${location.name}: ${pipResult.pipelinesUpserted} pipelines, ${pipResult.stagesUpserted} stages`);
    await writeSyncLog({ syncType, entity: 'pipelines', locationId: location.id, recordsFetched: rawPipelines.length, recordsUpserted: pipResult.pipelinesUpserted, errors: pipResult.errors, startedAt: pipStart });
  } catch (err) {
    console.error(`[Sync] ${location.name} pipelines failed:`, err.message);
    await writeSyncLog({ syncType, entity: 'pipelines', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: pipStart });
  }

  // 4. Contacts
  let ctStart = new Date().toISOString();
  try {
    const rawContacts = await fetchAllContacts(location.id);
    const contacts = rawContacts.map(c => transformContact(c, location.id));
    const ctResult = await upsertContacts(contacts);
    console.log(`[Sync] ${location.name}: ${rawContacts.length} contacts fetched, ${ctResult.upserted} upserted`);
    await writeSyncLog({ syncType, entity: 'contacts', locationId: location.id, recordsFetched: rawContacts.length, recordsUpserted: ctResult.upserted, errors: ctResult.errors, startedAt: ctStart });
  } catch (err) {
    console.error(`[Sync] ${location.name} contacts failed:`, err.message);
    await writeSyncLog({ syncType, entity: 'contacts', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: ctStart });
  }

  // 5. Opportunities
  let opStart = new Date().toISOString();
  try {
    const rawOpps = await fetchAllOpportunities(location.id);
    const opps = rawOpps.map(o => transformOpportunity(o, location.id));
    const opResult = await upsertOpportunities(opps);
    console.log(`[Sync] ${location.name}: ${rawOpps.length} opportunities fetched, ${opResult.upserted} upserted`);
    await writeSyncLog({ syncType, entity: 'opportunities', locationId: location.id, recordsFetched: rawOpps.length, recordsUpserted: opResult.upserted, errors: opResult.errors, startedAt: opStart });
  } catch (err) {
    console.error(`[Sync] ${location.name} opportunities failed:`, err.message);
    await writeSyncLog({ syncType, entity: 'opportunities', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: opStart });
  }

  console.log(`[Sync] Completed ${syncType} sync for ${location.name}`);
}

async function fullSync() {
  console.log(`[Sync] Starting full sync for ${LOCATIONS.length} locations`);
  const start = Date.now();

  for (const location of LOCATIONS) {
    await syncLocation(location, 'full');
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Sync] Full sync complete in ${duration}s`);
}

async function fullSyncForLocation(slug) {
  const location = LOCATIONS.find(l => l.slug === slug);
  if (!location) throw new Error(`Location not found: ${slug}`);
  await syncLocation(location, 'full');
}

module.exports = { fullSync, fullSyncForLocation };
