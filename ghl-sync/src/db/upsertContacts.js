const supabase = require('./supabase');

const BATCH_SIZE = 500;

async function upsertContacts(contacts) {
  let upserted = 0;
  const errors = [];

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from('ghl_contacts_v2')
      .upsert(batch, { onConflict: 'id', count: 'exact' });

    if (error) {
      console.error(`[DB] Contact upsert batch error:`, error.message);
      errors.push({ batch: Math.floor(i / BATCH_SIZE), error: error.message });
    } else {
      upserted += count || batch.length;
    }
  }

  return { upserted, errors };
}

module.exports = { upsertContacts };
