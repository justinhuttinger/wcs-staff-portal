/*
 * POST /ghl/log-call
 * Body: { locationId, contactId, outcome, userId }
 *
 * Writes the call outcome to the contact's "Last Call Outcome" custom field, the staff
 * member who logged it to "Last Call Logged By", and adds a note to the contact for
 * history, since the fields only hold the latest call.
 * Called by the "Log call" button on Manual Actions in the GHL custom JS.
 *
 * Mounted in index.js BEFORE the global cors() so this route's own CORS answers
 * the GHL origins (the global whitelist would otherwise swallow the preflight).
 *
 * Setup in GHL (Milwaukie):
 *   Create a contact custom field named "Last Call Outcome" as a Single Option dropdown
 *   with exactly these options: Answer, No Answer, Not Interested.
 *   Its key should be contact.last_call_outcome.
 *   Also create a Single Line text field named "Last Call Logged By",
 *   key contact.last_call_logged_by.
 *   If GHL gives either a different key, update FIELD_KEYS below.
 *
 *   Create a Custom Object for dashboard reporting (Settings > Objects):
 *     Singular "Call Log", plural "Call Logs", object key custom_objects.call_logs
 *     Primary display field: "Summary" (text), key summary
 *     Fields: "Outcome" (dropdown: Answer, No Answer, Not Interested), key outcome
 *             "Logged By" (dropdown: one option per staff member, plus Unknown), key logged_by
 *             "Call Date" (date), key call_date
 *     Association: Call Logs <-> Contacts
 *   If any key differs, update CALL_LOG below.
 *
 * Token scopes needed for the location's Private Integration Token:
 *   contacts.readonly, contacts.write, locations/customFields.readonly, users.readonly,
 *   objects/record.write, associations.readonly, associations/relation.write
 *
 * Tokens come from config/ghlLocations (GHL_API_KEY_<CLUB>).
 */
const express = require('express');
const { getLocationById } = require('../config/ghlLocations');

const router = express.Router();

const ALLOWED_ORIGINS = [
  'https://app.gohighlevel.com',
  'https://app.westcoaststrength.com',
];

// This endpoint writes to the CRM, so it only serves clubs listed here (by slug).
const ALLOWED_SLUGS = ['milwaukie'];
const OUTCOMES = ['Answer', 'No Answer', 'Not Interested'];
const FIELD_KEYS = {
  outcome: 'contact.last_call_outcome',
  loggedBy: 'contact.last_call_logged_by',
};
const UNKNOWN_USER = 'Unknown';

// One Call Log record per call, for dashboard widgets. Property keys are the fields'
// short keys from Settings > Objects, without the custom_objects.call_logs. prefix.
const CALL_LOG = {
  enabled: true,
  schemaKey: 'custom_objects.call_logs',
  props: { summary: 'summary', outcome: 'outcome', loggedBy: 'logged_by', callDate: 'call_date' },
  timeZone: 'America/Los_Angeles',
};
const USER_CACHE_MS = 60 * 60 * 1000;

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const ID_PATTERN = /^[A-Za-z0-9]{8,64}$/;

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 60; // per client per minute
const hits = new Map();
const fieldIds = new Map();
const userNames = new Map();
const associations = new Map();

async function ghl(token, method, path, body, version = GHL_VERSION) {
  const res = await fetch(GHL_API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`GHL ${method} ${path} responded ${res.status}: ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? {} : res.json();
}

async function resolveFieldIds(token, locationId) {
  if (fieldIds.has(locationId)) return fieldIds.get(locationId);
  const body = await ghl(token, 'GET', `/locations/${locationId}/customFields?model=contact`);
  const byKey = (key) => (body.customFields || []).find((f) => f.fieldKey === key);
  const outcome = byKey(FIELD_KEYS.outcome);
  if (!outcome) throw new Error(`Custom field ${FIELD_KEYS.outcome} not found in location ${locationId}`);
  const loggedBy = byKey(FIELD_KEYS.loggedBy);
  if (!loggedBy) console.warn(`[log-call] ${FIELD_KEYS.loggedBy} not found in ${locationId}; skipping who logged it`);
  const ids = { outcome: outcome.id, loggedBy: loggedBy ? loggedBy.id : null };
  fieldIds.set(locationId, ids);
  return ids;
}

// Staff name for a GHL user ID, only if that user has access to this location.
// The ID comes from the browser, so it isn't trusted until GHL confirms it.
async function lookupUserName(token, userId, locationId) {
  if (!ID_PATTERN.test(String(userId || ''))) return UNKNOWN_USER;
  const cacheKey = `${locationId}:${userId}`;
  const cached = userNames.get(cacheKey);
  if (cached && Date.now() - cached.at < USER_CACHE_MS) return cached.name;

  let name = UNKNOWN_USER;
  try {
    const body = await ghl(token, 'GET', `/users/${userId}`);
    const user = body.user || body;
    const roles = user.roles || {};
    const locations = Array.isArray(roles.locationIds) ? roles.locationIds : null;
    // Agency users can have no location list; sub-account users must include this location.
    const allowed = roles.type === 'agency' || !locations || locations.includes(locationId);
    if (allowed) {
      name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || user.email || UNKNOWN_USER;
    } else {
      console.warn(`[log-call] user ${userId} has no access to ${locationId}`);
    }
  } catch (err) {
    console.warn('[log-call] user lookup failed:', err.message);
  }
  // Only cache real names, so a fixed scope or permission takes effect right away.
  if (name !== UNKNOWN_USER) userNames.set(cacheKey, { at: Date.now(), name });
  return name;
}

// Finds the Contacts <-> Call Logs association and which side the contact is on.
async function resolveAssociation(token, locationId) {
  if (associations.has(locationId)) return associations.get(locationId);
  const body = await ghl(token, 'GET', `/associations/?locationId=${locationId}&skip=0&limit=100`, null, '2021-04-15');
  const list = body.associations || (Array.isArray(body) ? body : []);
  const match = list.find((a) =>
    (a.firstObjectKey === 'contact' && a.secondObjectKey === CALL_LOG.schemaKey) ||
    (a.secondObjectKey === 'contact' && a.firstObjectKey === CALL_LOG.schemaKey));
  if (!match) throw new Error(`No association between contacts and ${CALL_LOG.schemaKey} in ${locationId}`);
  const info = { id: match.id, contactFirst: match.firstObjectKey === 'contact' };
  associations.set(locationId, info);
  return info;
}

function localDate(timeZone) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Creates the Call Log record and links it to the contact.
// If GHL rejects the staff name (not yet a dropdown option), it saves as Unknown and
// logs whose name to add. The staff member is kept as the record owner either way.
async function createCallLog(token, { locationId, contactId, outcome, staffName, userId }) {
  const P = CALL_LOG.props;
  const validUser = ID_PATTERN.test(String(userId || ''));
  const attempts = [
    { name: staffName, owner: validUser },
    { name: UNKNOWN_USER, owner: validUser },
    { name: staffName, owner: false },
    { name: UNKNOWN_USER, owner: false },
  ].filter((a, i, all) => all.findIndex((b) => b.name === a.name && b.owner === a.owner) === i);

  let created = null;
  let lastErr = null;
  for (const attempt of attempts) {
    const body = {
      locationId,
      properties: {
        [P.summary]: `${outcome} by ${attempt.name}`,
        [P.outcome]: outcome,
        [P.loggedBy]: attempt.name,
        [P.callDate]: localDate(CALL_LOG.timeZone),
      },
    };
    if (attempt.owner) body.owner = [userId];
    try {
      created = await ghl(token, 'POST', `/objects/${CALL_LOG.schemaKey}/records`, body);
      if (attempt.name !== staffName) {
        console.warn(`[log-call] Saved call log as ${UNKNOWN_USER}. Add "${staffName}" to the Logged By dropdown.`);
      }
      break;
    } catch (err) {
      lastErr = err;
      if (!err.status || err.status >= 500) throw err; // only retry when GHL rejected the data
    }
  }
  if (!created) throw lastErr;

  const recordId = (created.record || created).id;
  const assoc = await resolveAssociation(token, locationId);
  await ghl(token, 'POST', '/associations/relations', {
    locationId,
    associationId: assoc.id,
    firstRecordId: assoc.contactFirst ? contactId : recordId,
    secondRecordId: assoc.contactFirst ? recordId : contactId,
  }, '2021-04-15');
}

function rateLimited(key) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > RATE_MAX;
}

router.use('/ghl/log-call', (req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    return res.sendStatus(204);
  }
  next();
});

router.post('/ghl/log-call', express.json({ limit: '2kb' }), async (req, res) => {
  // Behind Render's proxy, req.ip is only the real client if the app sets trust proxy.
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many requests' });

  const { locationId, contactId, outcome, userId } = req.body || {};
  const location = getLocationById(locationId);
  if (!location || !ALLOWED_SLUGS.includes(location.slug)) return res.status(403).json({ error: 'Location not enabled' });
  if (!ID_PATTERN.test(String(contactId || ''))) return res.status(400).json({ error: 'Invalid contact' });
  if (!OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'Invalid outcome' });

  const token = location.apiKey;

  try {
    // Only write to contacts that actually belong to this location.
    const found = await ghl(token, 'GET', `/contacts/${contactId}`);
    if (!found.contact || found.contact.locationId !== locationId) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const fields = await resolveFieldIds(token, locationId);
    const staffName = await lookupUserName(token, userId, locationId);
    const customFields = [{ id: fields.outcome, field_value: outcome }];
    if (fields.loggedBy) customFields.push({ id: fields.loggedBy, field_value: staffName });
    await ghl(token, 'PUT', `/contacts/${contactId}`, { customFields });

    // The note keeps a history of every call. Best effort: the outcome is already saved.
    const note = { body: `Call outcome: ${outcome} (logged from Manual Actions)` };
    const validUser = ID_PATTERN.test(String(userId || ''));
    try {
      await ghl(token, 'POST', `/contacts/${contactId}/notes`, validUser ? { ...note, userId } : note);
    } catch (err) {
      if (!validUser) throw err;
      // Attribute to the staff member when possible; fall back to an unattributed note.
      await ghl(token, 'POST', `/contacts/${contactId}/notes`, note).catch((e) => {
        console.warn('[log-call] note failed:', e.message);
      });
    }

    // Reporting record. Best effort: the outcome is already on the contact, so a failure
    // here never blocks the call from being logged or the task from completing.
    let callLog = false;
    if (CALL_LOG.enabled) {
      try {
        await createCallLog(token, { locationId, contactId, outcome, staffName, userId });
        callLog = true;
      } catch (err) {
        console.error('[log-call] call log record failed:', err.message);
      }
    }

    res.json({ ok: true, callLog });
  } catch (err) {
    console.error('[log-call]', err.message);
    res.status(502).json({ error: 'Could not log call' });
  }
});

module.exports = router;
