/*
 * POST /ghl/log-call
 * Body: { locationId, contactId, outcome, userId }
 *
 * Writes the call outcome to the contact's "Last Call Outcome" custom field and adds
 * a note to the contact for history, since the field only holds the latest outcome.
 * Called by the "Log call" button on Manual Actions in the GHL custom JS.
 *
 * Mounted in index.js BEFORE the global cors() so this route's own CORS answers
 * the GHL origins (the global whitelist would otherwise swallow the preflight).
 *
 * Setup in GHL (Milwaukie):
 *   Create a contact custom field named "Last Call Outcome" as a Single Option dropdown
 *   with exactly these options: Answer, No Answer, Not Interested.
 *   Its key should be contact.last_call_outcome. If GHL gives it a different key,
 *   update FIELD_KEY below.
 *
 * Token scopes needed for the location's Private Integration Token:
 *   contacts.readonly, contacts.write, locations/customFields.readonly
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
const FIELD_KEY = 'contact.last_call_outcome';

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const ID_PATTERN = /^[A-Za-z0-9]{8,64}$/;

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 60; // per client per minute
const hits = new Map();
const fieldIds = new Map();

async function ghl(token, method, path, body) {
  const res = await fetch(GHL_API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
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

async function resolveFieldId(token, locationId) {
  if (fieldIds.has(locationId)) return fieldIds.get(locationId);
  const body = await ghl(token, 'GET', `/locations/${locationId}/customFields?model=contact`);
  const field = (body.customFields || []).find((f) => f.fieldKey === FIELD_KEY);
  if (!field) throw new Error(`Custom field ${FIELD_KEY} not found in location ${locationId}`);
  fieldIds.set(locationId, field.id);
  return field.id;
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

    const fieldId = await resolveFieldId(token, locationId);
    await ghl(token, 'PUT', `/contacts/${contactId}`, {
      customFields: [{ id: fieldId, field_value: outcome }],
    });

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

    res.json({ ok: true });
  } catch (err) {
    console.error('[log-call]', err.message);
    res.status(502).json({ error: 'Could not log call' });
  }
});

module.exports = router;
