const LOCATIONS = require('../config/locations');
const supabase = require('../db/supabase');
const { sleep } = require('../ghl/client');
const { fetchAllMessages, searchConversations } = require('../ghl/conversations');
const { messageRow, upsertSmsMessages, upsertSmsTemplates, upsertSmsReplies } = require('../db/upsertSmsMessages');
const { attributeReplies, DEFAULT_WINDOW_HOURS } = require('../sms/replyAttribution');
const { writeSyncLog } = require('./syncLog');

const PAGE_SIZE = 100;
const MAX_PAGES = 200; // 20k conversations per run; the backfill needs the headroom
const FETCH_DELAY_MS = Number(process.env.SMS_FETCH_DELAY_MS || 120);
const WINDOW_HOURS = Number(process.env.SMS_REPLY_WINDOW_HOURS || DEFAULT_WINDOW_HOURS);
// Re-walk a little before the last run so a conversation that moved mid-sync
// is not missed. Cheap: an already-stored message just upserts over itself.
const OVERLAP_MS = 2 * 60 * 60 * 1000;
// First-ever run for a location (no ghl_sync_log row yet) gets a bounded
// default floor instead of walking all history. The full historical walk is
// meant to be a deliberate, off-hours, one-location-at-a-time operation (see
// scripts/backfillSmsMessages.js), not something that happens automatically
// on the first top-of-hour tick after deploy.
const FIRST_RUN_DAYS = Number(process.env.SMS_FIRST_RUN_DAYS || 7);

// When did this location last finish an sms-messages run without errors?
// Returns null on the first ever run, which the caller reads as "no watermark".
async function lastSuccessfulRun(locationId) {
  const { data, error } = await supabase
    .from('ghl_sync_log')
    .select('started_at')
    .eq('sync_type', 'sms-messages')
    .eq('location_id', locationId)
    .is('errors', null)
    .order('started_at', { ascending: false })
    .limit(1);

  if (error) {
    console.warn('[SmsStats] watermark lookup failed:', error.message);
    return null;
  }
  const iso = data?.[0]?.started_at;
  if (!iso) return null;
  return new Date(new Date(iso).getTime() - OVERLAP_MS).toISOString();
}

// Recompute reply linkage for the contacts we just touched. Attribution needs
// a contact's neighbouring messages, not just the new ones, so reload each
// contact's window from the DB rather than attributing the fetched page alone.
async function attributeForContacts(contactIds, sinceIso) {
  const rows = [];
  const ids = Array.from(contactIds).filter(Boolean);

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);

    // PostgREST caps a single response at ~1000 rows. At the old 72h window
    // that rarely mattered; once the reload spans a 180-day backfill floor
    // (see below) a single chunk can easily hold more than 1000 messages, and
    // a silent truncation drops reply links. Page explicitly until a short
    // page comes back, matching the idiom in auth/src/routes/checkinsReport.js.
    const data = [];
    let from = 0;
    let pageError = false;
    for (;;) {
      const { data: page, error } = await supabase
        .from('ghl_sms_messages')
        .select('id, contact_id, direction, body, date_added, location')
        .in('contact_id', chunk)
        .gte('date_added', sinceIso)
        .order('date_added', { ascending: true })
        .range(from, from + 999);

      if (error) {
        console.warn('[SmsStats] attribution reload failed:', error.message);
        pageError = true;
        break;
      }
      if (!page || !page.length) break;
      data.push(...page);
      if (page.length < 1000) break;
      from += 1000;
    }
    if (pageError) continue; // skip this chunk entirely rather than attribute on a partial reload

    const byContact = new Map();
    for (const m of data || []) {
      if (!byContact.has(m.contact_id)) byContact.set(m.contact_id, []);
      byContact.get(m.contact_id).push(m);
    }
    for (const [, msgs] of byContact) {
      for (const a of attributeReplies(msgs, { windowHours: WINDOW_HOURS })) {
        rows.push({
          inbound_id: a.inbound_id,
          send_id: a.send_id,
          location: msgs[0].location,
          reply_minutes: a.reply_minutes,
          is_opt_out: a.is_opt_out,
          computed_at: new Date().toISOString(),
        });
      }
    }
  }

  return rows;
}

// Walk one location's recently-active conversations, store their SMS, cluster
// the outbound ones into templates, and recompute reply linkage.
async function smsStatsSyncForLocation(loc, { sinceIso = null } = {}) {
  const startedAt = new Date().toISOString();
  let watermark = sinceIso || (await lastSuccessfulRun(loc.id));
  if (!watermark) {
    // No explicit override (the backfill always passes one) and no prior
    // successful run recorded: this is the first-ever tick for this location.
    // Left unbounded, `reachedWatermark` would never become true and the walk
    // would run to MAX_PAGES — the entire conversation history — on the first
    // scheduled tick after deploy. Bound it to a recent default instead; the
    // deliberate full-history walk is scripts/backfillSmsMessages.js.
    watermark = new Date(Date.now() - FIRST_RUN_DAYS * 24 * 3600 * 1000).toISOString();
  }
  const errors = [];

  // lastMessageDate comes back as epoch ms, so the watermark is compared as a
  // number. Converting the other way (ms -> ISO per row) would be a string
  // compare on every conversation for no benefit.
  const watermarkMs = watermark ? Date.parse(watermark) : null;

  const messages = [];
  const touchedContacts = new Set();
  let startAfterDate = null;
  let reachedWatermark = false;
  let conversations = 0;

  for (let page = 0; page < MAX_PAGES && !reachedWatermark; page++) {
    let batch;
    try {
      batch = await searchConversations(loc.id, loc.apiKey, { limit: PAGE_SIZE, startAfterDate });
    } catch (err) {
      const code = err.response?.status || err.message;
      console.warn(`[SmsStats] ${loc.name}: conversation search failed (${code})`);
      errors.push({ stage: 'search', reason: String(code) });
      break;
    }
    if (!batch.length) break;

    for (const c of batch) {
      // Conversations come newest-activity first, so the first one older than
      // the watermark means everything after it is older too.
      if (watermarkMs && c.lastMessageDate && Number(c.lastMessageDate) < watermarkMs) {
        reachedWatermark = true;
        break;
      }
      conversations++;
      try {
        const msgs = await fetchAllMessages(c.id, loc.apiKey);
        for (const m of msgs) {
          const row = messageRow(m, loc);
          if (!row) continue;
          messages.push(row);
          if (row.contact_id) touchedContacts.add(row.contact_id);
        }
      } catch (err) {
        const code = err.response?.status || err.message;
        errors.push({ stage: 'messages', conversationId: c.id, reason: String(code) });
      }
      await sleep(FETCH_DELAY_MS);
    }

    // Cursor is the oldest lastMessageDate on this page, in epoch ms.
    startAfterDate = batch[batch.length - 1]?.lastMessageDate || null;
    if (!startAfterDate || batch.length < PAGE_SIZE) break;
  }

  const msgResult = messages.length ? await upsertSmsMessages(messages) : { upserted: 0, errors: [] };
  errors.push(...msgResult.errors);

  // One template row per distinct key, carrying the earliest and latest sighting.
  // Template identity is GLOBAL (not per-location): the same fingerprint sent
  // from two different clubs is one template, one row.
  const templates = new Map();
  for (const m of messages) {
    if (m.direction !== 'outbound' || !m.template_key) continue;
    const prev = templates.get(m.template_key);
    if (!prev) {
      templates.set(m.template_key, {
        template_key: m.template_key,
        label: null,
        sample_body: m.body || '',
        first_seen_location: m.location,
        first_seen_at: m.date_added,
        last_seen_at: m.date_added,
      });
    } else {
      if (m.date_added < prev.first_seen_at) prev.first_seen_at = m.date_added;
      if (m.date_added > prev.last_seen_at) prev.last_seen_at = m.date_added;
    }
  }
  // Never clobber a label a human set: only insert templates we have not seen.
  // If the lookup itself fails, `known` would otherwise silently read as "no
  // templates known yet", and every template — including ones with a
  // human-set label — would get re-inserted with label: null on conflict.
  // Skip the template upsert entirely this run instead; it just re-tries
  // next run, and the recorded error keeps the watermark from advancing.
  //
  // Lookup is global (not scoped to this location): a template first seen at
  // another club must still be recognized as known here, or its label would
  // get clobbered the first time a second club sends the same text.
  //
  // Only ask about the keys THIS RUN actually saw, rather than paging the
  // whole sms_templates table. Production is already past PostgREST's ~1000
  // row cap (216 rows after one day; the backfill defaults to 180 days x 7
  // locations) — a `.select('template_key')` with no filter would silently
  // truncate, `knownKeys` would hold an arbitrary subset, every template
  // outside it would look "new", and the upsert would null out real labels.
  // Inverting the query to `.in('template_key', keys)` bounds the response by
  // this run's size, not the table's, no matter how large the table grows.
  const runKeys = Array.from(templates.keys());
  let known = [];
  let knownError = null;
  for (let i = 0; i < runKeys.length && !knownError; i += 1000) {
    const chunk = runKeys.slice(i, i + 1000);
    const { data, error } = await supabase
      .from('sms_templates')
      .select('template_key')
      .in('template_key', chunk);
    if (error) {
      knownError = error;
      break;
    }
    known.push(...(data || []));
  }
  let tplResult = { upserted: 0, errors: [] };
  if (knownError) {
    console.warn(`[SmsStats] ${loc.name}: known-template lookup failed:`, knownError.message);
    errors.push({ stage: 'templates-known', reason: String(knownError.message) });
  } else {
    const knownKeys = new Set(known.map(r => r.template_key));
    const newTemplates = Array.from(templates.values()).filter(t => !knownKeys.has(t.template_key));
    tplResult = newTemplates.length ? await upsertSmsTemplates(newTemplates) : { upserted: 0, errors: [] };
    errors.push(...tplResult.errors);
  }

  // Reload span must cover the full attribution window regardless of how
  // recently this location last synced — a reply arriving more than one
  // watermark-width after its send otherwise has no matching outbound in the
  // reloaded slice and its link is silently dropped (or misattributed).
  //
  // This function backs BOTH the incremental sync and the historical backfill
  // (scripts/backfillSmsMessages.js passes `sinceIso` = now - 180d, which
  // flows into `watermark`/`watermarkMs` above). A backfill run stores sends
  // back to that floor, so the reload has to reach back at least as far, or
  // backfilled replies never find their outbound send and silently link to
  // nothing (thousands of sends, ~0 replies). Use whichever bound is EARLIER:
  // the normal attribution window, or this run's own floor.
  const attrSince = new Date(
    watermarkMs != null ? Math.min(Date.now() - WINDOW_HOURS * 3600 * 1000, watermarkMs)
      : Date.now() - WINDOW_HOURS * 3600 * 1000
  ).toISOString();
  const replies = await attributeForContacts(touchedContacts, attrSince);
  const repResult = replies.length ? await upsertSmsReplies(replies) : { upserted: 0, errors: [] };
  errors.push(...repResult.errors);

  await writeSyncLog({
    syncType: 'sms-messages',
    entity: 'ghl_sms_messages',
    locationId: loc.id,
    recordsFetched: messages.length,
    recordsUpserted: msgResult.upserted,
    errors,
    startedAt,
  });

  return {
    location: loc.name,
    conversations,
    messages: messages.length,
    upserted: msgResult.upserted,
    templates: tplResult.upserted,
    replies: repResult.upserted,
    errors: errors.length,
  };
}

// Every location, one fully before the next, so rate-limit accounting stays simple.
async function smsStatsSync(opts = {}) {
  const summary = [];
  for (const loc of LOCATIONS) {
    try {
      const r = await smsStatsSyncForLocation(loc, opts);
      summary.push(r);
      console.log(`[SmsStats] ${loc.name}: convos=${r.conversations} msgs=${r.messages} replies=${r.replies} errors=${r.errors}`);
    } catch (err) {
      console.error(`[SmsStats] ${loc.name}: FAILED — ${err.message}`);
      summary.push({ location: loc.name, error: err.message });
    }
  }
  console.log('[SmsStats] Run summary:', JSON.stringify(summary));
  return summary;
}

async function smsStatsSyncForSlug(slug, opts = {}) {
  const loc = LOCATIONS.find(l => l.slug === slug);
  if (!loc) throw new Error(`Unknown location slug: ${slug}`);
  return smsStatsSyncForLocation(loc, opts);
}

module.exports = { smsStatsSync, smsStatsSyncForLocation, smsStatsSyncForSlug };
