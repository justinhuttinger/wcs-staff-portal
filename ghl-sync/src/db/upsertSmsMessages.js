const supabase = require('./supabase');
const { templateKey } = require('../sms/templateKey');

const BATCH_SIZE = 500;

// Build a WHOLE ghl_sms_messages row from a GHL message. Returns null for
// anything that is not an SMS: the conversation feed also carries TYPE_CALL and
// TYPE_ACTIVITY_* rows, which are not sends and must never reach the table.
function messageRow(msg, loc) {
  if (!msg || msg.messageType !== 'TYPE_SMS') return null;
  if (!msg.id || !msg.dateAdded) return null;
  const direction = msg.direction === 'inbound' ? 'inbound' : 'outbound';
  return {
    id: msg.id,
    location: loc.slug,
    location_id: loc.id,
    conversation_id: msg.conversationId || '',
    contact_id: msg.contactId || null,
    direction,
    source: msg.source || null,
    status: msg.status || null,
    body: msg.body || null,
    // Inbound bodies are what a member typed; clustering them is meaningless.
    template_key: direction === 'outbound' ? templateKey(msg.body) : null,
    date_added: msg.dateAdded,
    synced_at: new Date().toISOString(),
  };
}

async function batchUpsert(table, rows, onConflict, keyFn) {
  let upserted = 0;
  const errors = [];

  const seen = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    seen.set(k, r); // last occurrence wins
  }
  const deduped = Array.from(seen.values());

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from(table)
      .upsert(batch, { onConflict, count: 'exact' });

    if (error) {
      console.error(`[DB] ${table} upsert batch error:`, error.message);
      errors.push({ batch: Math.floor(i / BATCH_SIZE), error: error.message });
    } else {
      upserted += count || batch.length;
    }
  }

  return { upserted, errors };
}

const upsertSmsMessages = rows =>
  batchUpsert('ghl_sms_messages', rows, 'id', r => r.id);

const upsertSmsTemplates = rows =>
  batchUpsert('sms_templates', rows, 'template_key', r => r.template_key || null);

const upsertSmsReplies = rows =>
  batchUpsert('sms_replies', rows, 'inbound_id', r => r.inbound_id);

module.exports = { messageRow, upsertSmsMessages, upsertSmsTemplates, upsertSmsReplies };
