require('dotenv').config();
const express = require('express');
const { fullSync, fullSyncForLocation, stopGhlSync } = require('./sync/fullSync');
const { deltaSync } = require('./sync/deltaSync');
const { abcSync, abcSyncForLocation, stopAbcSync } = require('./abc/abcSync');
const { employeeSync } = require('./abc/employeeSync');
const { enrichAll: enrichAttributionAll, enrichForLocation: enrichAttributionForLocation } = require('./sync/attributionEnrich');
const { refreshCurrentHourCheckins, fetchCheckinsForRange, backfillClub, pacificNowAsUtc } = require('./abc/checkins');
const { backfillFirstContact } = require('./sync/computeFirstContact');
const axios = require('axios');
const LOCATIONS = require('./config/locations');
const { startScheduler } = require('./scheduler');
const supabase = require('./db/supabase');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SYNC_SECRET = process.env.SYNC_SECRET;

// Auth middleware for POST endpoints
function requireSecret(req, res, next) {
  if (!SYNC_SECRET) return next(); // No secret configured = no auth (dev mode)
  if (req.headers['x-sync-secret'] !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Invalid sync secret' });
  }
  next();
}

// Track running syncs to prevent overlap
let syncRunning = false;

// GET /health
app.get('/health', async (req, res) => {
  const { data: lastDelta } = await supabase
    .from('ghl_sync_log')
    .select('completed_at')
    .eq('sync_type', 'delta')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  const { data: lastFull } = await supabase
    .from('ghl_sync_log')
    .select('completed_at')
    .eq('sync_type', 'full')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  // Latest check-in hour per club + the most recent ghl_sync_log entry for
  // entity='checkins' so we can see at a glance whether the silent failure
  // path is firing.
  const { data: checkinRows } = await supabase
    .from('checkins_hourly')
    .select('club_number, hour_start, fetched_at')
    .order('hour_start', { ascending: false })
    .limit(200);
  const latestByClub = {};
  for (const r of (checkinRows || [])) {
    if (!latestByClub[r.club_number]) {
      latestByClub[r.club_number] = { hour_start: r.hour_start, fetched_at: r.fetched_at };
    }
  }
  const { data: lastCheckinLog } = await supabase
    .from('ghl_sync_log')
    .select('completed_at, records_fetched, records_upserted, errors')
    .eq('entity', 'checkins')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    syncRunning,
    lastDelta: lastDelta?.completed_at || null,
    lastFull: lastFull?.completed_at || null,
    checkins: {
      latestByClub,
      lastSyncLogEntry: lastCheckinLog || null,
    },
  });
});

// POST /api/sync/full
app.post('/api/sync/full', requireSecret, (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync already in progress' });
  syncRunning = true;
  res.json({ status: 'started', message: 'Full sync running in background' });
  fullSync()
    .catch(err => console.error('[API] Full sync failed:', err.message))
    .finally(() => { syncRunning = false; });
});

// POST /api/sync/delta
app.post('/api/sync/delta', requireSecret, (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync already in progress' });
  syncRunning = true;
  res.json({ status: 'started', message: 'Delta sync running in background' });
  deltaSync()
    .catch(err => console.error('[API] Delta sync failed:', err.message))
    .finally(() => { syncRunning = false; });
});

// POST /api/sync/full/:locationSlug
app.post('/api/sync/full/:locationSlug', requireSecret, (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync already in progress' });
  syncRunning = true;
  res.json({ status: 'started', message: `Full sync for ${req.params.locationSlug} running` });
  fullSyncForLocation(req.params.locationSlug)
    .catch(err => console.error(`[API] Full sync for ${req.params.locationSlug} failed:`, err.message))
    .finally(() => { syncRunning = false; });
});

// POST /api/sync/checkins — run only the current-hour check-in refresh so we
// can isolation-test ABC's /members/checkins/summaries endpoint without
// kicking off a full delta. Synchronous (fast — one ABC call per club).
app.post('/api/sync/checkins', requireSecret, async (req, res) => {
  try {
    const clubs = LOCATIONS.map(l => l.clubNumber).filter(Boolean);
    const summary = await refreshCurrentHourCheckins(clubs);
    res.json({ status: 'ok', ...summary });
  } catch (err) {
    console.error('[API] Checkins refresh failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Format a Date as ABC's expected string but using the Pacific clock digits
// instead of UTC. The migration comment in 004_checkins_hourly.sql says ABC
// interprets the checkInTimestampRange parameter as **club local time**, so
// we should send Pacific digits even though we think of times in UTC.
function fmtAbcPacific(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value || '00';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

function fmtAbcUtc(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
    pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds())
  );
}

async function probeAbc(clubNumber, fromStr, toStr) {
  const url = `${process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'}/${clubNumber}/members/checkins/summaries`;
  const r = await axios.get(url, {
    params: { checkInTimestampRange: `${fromStr},${toStr}`, size: 5000 },
    headers: { app_id: process.env.ABC_APP_ID, app_key: process.env.ABC_APP_KEY, Accept: 'application/json' },
    timeout: 60000,
  });
  const data = r.data || {};
  const members = Array.isArray(data.members) ? data.members : [];
  let totalCheckins = 0;
  for (const m of members) {
    const arr = m.checkInCounts?.checkInCount || [];
    for (const entry of arr) {
      const n = parseInt(entry.count, 10);
      if (!isNaN(n)) totalCheckins += n;
    }
  }
  return {
    sent: { from: fromStr, to: toStr },
    httpStatus: r.status,
    topLevelKeys: Object.keys(data),
    abcStatus: data.status || null,
    abcRequest: data.request || null,
    memberCount: members.length,
    totalCheckins,
    firstMember: members[0] || null,
  };
}

// Track backfill state so we can poll status without overlapping runs.
let checkinsBackfillState = { running: false, startedAt: null, from: null, to: null, clubs: null, finishedAt: null, errors: [] };

// POST /api/sync/checkins/backfill — fill historical hours in checkins_hourly
// using the same Pacific-aware backfillClub() helper as the live sync. Runs in
// background; poll `GET /api/sync/checkins/backfill/status` for completion.
//
// Defaults to filling from MAX(hour_start) currently in checkins_hourly up to
// "now". Override via ?from=YYYY-MM-DD, ?to=YYYY-MM-DD, ?clubs=all|csv.
app.post('/api/sync/checkins/backfill', requireSecret, async (req, res) => {
  if (checkinsBackfillState.running) {
    return res.status(409).json({ error: 'Backfill already in progress', state: checkinsBackfillState });
  }
  try {
    const allClubs = LOCATIONS.map(l => l.clubNumber).filter(Boolean);
    let clubs = allClubs;
    if (req.query.clubs && req.query.clubs !== 'all') {
      clubs = req.query.clubs.split(',').map(s => s.trim()).filter(Boolean);
    }

    let fromDate;
    if (req.query.from) {
      fromDate = new Date(req.query.from + 'T00:00:00Z');
    } else {
      // Default: pick up from the latest hour we already have. Backfill is
      // idempotent so re-running the same hour is harmless.
      const { data } = await supabase
        .from('checkins_hourly')
        .select('hour_start')
        .order('hour_start', { ascending: false })
        .limit(1)
        .maybeSingle();
      fromDate = data?.hour_start ? new Date(data.hour_start) : new Date(Date.now() - 7 * 86400000);
    }
    // `to` defaults to "now in Pacific-disguised UTC" so the iteration in
    // backfillClub doesn't try to fetch future Pacific hours.
    const toDate = req.query.to ? new Date(req.query.to + 'T23:59:59Z') : pacificNowAsUtc();

    checkinsBackfillState = {
      running: true,
      startedAt: new Date().toISOString(),
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      clubs,
      finishedAt: null,
      errors: [],
    };

    res.json({ status: 'started', state: checkinsBackfillState });

    // Fan out: one club at a time concurrently (so all 7 progress in parallel)
    // with a short per-hour sleep inside each. Total wall time ≈ hours × 100ms.
    Promise.all(clubs.map(c =>
      backfillClub(c, fromDate, toDate, 100).catch(err => {
        console.error(`[API] backfill ${c} failed:`, err.message);
        checkinsBackfillState.errors.push({ club: c, error: err.message });
      })
    )).finally(() => {
      checkinsBackfillState.running = false;
      checkinsBackfillState.finishedAt = new Date().toISOString();
      console.log('[API] Check-ins backfill complete');
    });
  } catch (err) {
    checkinsBackfillState.running = false;
    console.error('[API] backfill kickoff failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sync/checkins/backfill/status', requireSecret, (req, res) => {
  res.json(checkinsBackfillState);
});

// --- Speed to Lead: one-time historical backfill of ghl_first_contact -------
let firstContactBackfillState = { running: false, startedAt: null, windowDays: null, checked: 0, resolved: 0, locationsDone: 0, errors: [], finishedAt: null };

// POST /api/sync/first-contact/backfill?days=180 — compute first human contact
// for every membership-pipeline opportunity in the window that lacks a resolved
// row. Runs in background; poll GET .../status. Idempotent (skips resolved rows).
app.post('/api/sync/first-contact/backfill', requireSecret, (req, res) => {
  if (firstContactBackfillState.running) {
    return res.status(409).json({ error: 'Backfill already in progress', state: firstContactBackfillState });
  }
  const days = parseInt(req.query.days || '180', 10);
  firstContactBackfillState = { running: true, startedAt: new Date().toISOString(), windowDays: days, checked: 0, resolved: 0, locationsDone: 0, errors: [], finishedAt: null };
  res.json({ status: 'started', state: firstContactBackfillState });

  backfillFirstContact(days, firstContactBackfillState)
    .catch(err => { firstContactBackfillState.errors.push({ error: err.message }); })
    .finally(() => {
      firstContactBackfillState.running = false;
      firstContactBackfillState.finishedAt = new Date().toISOString();
      console.log('[API] Speed to Lead backfill complete');
    });
});

app.get('/api/sync/first-contact/backfill/status', requireSecret, (req, res) => {
  res.json(firstContactBackfillState);
});

// POST /api/sync/checkins/cleanup?from=YYYY-MM-DD&to=YYYY-MM-DD
// Deletes "polluted" rows (total_checkins=0) inside the window. These come
// from earlier syncs that sent UTC timestamps to ABC (which ABC interpreted
// as Pacific local in the future, returning "No records found"). Real
// quiet hours can also produce total_checkins=0, but for gym data within
// open hours that's rare — and the backfill below will re-populate any
// genuine zeros with the same zero anyway.
app.post('/api/sync/checkins/cleanup', requireSecret, async (req, res) => {
  try {
    if (!req.query.from || !req.query.to) {
      return res.status(400).json({ error: 'from and to (YYYY-MM-DD) required' });
    }
    const fromIso = req.query.from + 'T00:00:00.000Z';
    const toIso = req.query.to + 'T23:59:59.999Z';
    const { data, error, count } = await supabase
      .from('checkins_hourly')
      .delete({ count: 'exact' })
      .gte('hour_start', fromIso)
      .lte('hour_start', toIso)
      .eq('total_checkins', 0)
      .select('club_number, hour_start');
    if (error) throw new Error(error.message);
    res.json({ status: 'ok', deleted: count ?? (data || []).length, window: { from: fromIso, to: toIso } });
  } catch (err) {
    console.error('[API] cleanup failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/checkins/probe — hits ABC for the previous complete hour to
// rule out "partial-hour query returns zero" and dumps the raw ABC response
// (truncated) for one sample club so we can see the actual response shape.
// SECRET-gated. Does NOT write to checkins_hourly.
app.post('/api/sync/checkins/probe', requireSecret, async (req, res) => {
  try {
    const clubs = LOCATIONS.map(l => l.clubNumber).filter(Boolean);
    // Previous complete hour: floor(now) - 1h.
    const now = new Date();
    const end = new Date(now);
    end.setUTCMinutes(0, 0, 0);
    const start = new Date(end);
    start.setUTCHours(start.getUTCHours() - 1);

    // Aggregated counts per club (parsed via the same helper as the live sync).
    const aggregated = []
    for (const clubNumber of clubs) {
      try {
        const { totalCheckins, uniqueMembers } = await fetchCheckinsForRange(clubNumber, start, end);
        aggregated.push({ clubNumber, ok: true, totalCheckins, uniqueMembers });
      } catch (err) {
        aggregated.push({ clubNumber, ok: false, error: err.message });
      }
    }

    // Hypothesis test: same window, both timestamp interpretations, side by
    // side. If `pacific` returns non-zero and `utc` returns zero, we've
    // confirmed ABC reads checkInTimestampRange as Pacific local time —
    // which is what the migration comment in 004_checkins_hourly.sql says.
    const sampleClub = req.query.club || clubs[0];
    const probes = {};
    try {
      probes.utc = await probeAbc(sampleClub, fmtAbcUtc(start), fmtAbcUtc(end));
    } catch (err) {
      probes.utc = { error: err.message, response: err.response?.data || null };
    }
    try {
      probes.pacific = await probeAbc(sampleClub, fmtAbcPacific(start), fmtAbcPacific(end));
    } catch (err) {
      probes.pacific = { error: err.message, response: err.response?.data || null };
    }

    res.json({
      probedWindow: { start: start.toISOString(), end: end.toISOString() },
      aggregated,
      sampleClub,
      probes,
    });
  } catch (err) {
    console.error('[API] Checkins probe failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/attribution — enrich attribution_source / last_attribution_source
// for all locations using POST /contacts/search. Additive: does not touch other
// contact fields. Long-running (full pass across all locations is ~hours).
app.post('/api/sync/attribution', requireSecret, (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync already in progress' });
  syncRunning = true;
  res.json({ status: 'started', message: 'Attribution enrichment running in background' });
  enrichAttributionAll()
    .then(results => console.log('[API] Attribution enrichment results:', JSON.stringify(results)))
    .catch(err => console.error('[API] Attribution enrichment failed:', err.message))
    .finally(() => { syncRunning = false; });
});

// POST /api/sync/attribution/:locationSlug — enrich a single location
app.post('/api/sync/attribution/:locationSlug', requireSecret, (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync already in progress' });
  syncRunning = true;
  const slug = req.params.locationSlug;
  res.json({ status: 'started', message: `Attribution enrichment for ${slug} running` });
  enrichAttributionForLocation(slug)
    .then(result => console.log(`[API] Attribution enrichment ${slug} result:`, JSON.stringify(result)))
    .catch(err => console.error(`[API] Attribution enrichment ${slug} failed:`, err.message))
    .finally(() => { syncRunning = false; });
});

// POST /api/sync/abc
app.post('/api/sync/abc', requireSecret, (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync already in progress' });
  syncRunning = true;
  res.json({ status: 'started', message: 'ABC sync running in background' });
  abcSync()
    .catch(err => console.error('[API] ABC sync failed:', err.message))
    .finally(() => { syncRunning = false; });
});

// POST /api/sync/abc/:locationSlug
app.post('/api/sync/abc/:locationSlug', requireSecret, (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync already in progress' });
  syncRunning = true;
  res.json({ status: 'started', message: `ABC sync for ${req.params.locationSlug} running` });
  abcSyncForLocation(req.params.locationSlug)
    .catch(err => console.error(`[API] ABC sync for ${req.params.locationSlug} failed:`, err.message))
    .finally(() => { syncRunning = false; });
});

// POST /api/sync/employees — run only the ABC → GHL employee dropdown sync
// (no member/contact/opp work). Optional ?slug=medford to scope to one location.
app.post('/api/sync/employees', requireSecret, (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync already in progress' });
  const slug = (req.query.slug || req.body?.slug || '').toLowerCase();
  const targets = slug
    ? LOCATIONS.filter(l => l.clubNumber && l.slug === slug)
    : LOCATIONS.filter(l => l.clubNumber);
  if (targets.length === 0) {
    return res.status(404).json({ error: slug ? `Unknown location: ${slug}` : 'No locations configured' });
  }
  syncRunning = true;
  res.json({ status: 'started', message: `Employee sync running for ${targets.map(l => l.name).join(', ')}` });
  employeeSync(targets)
    .then(results => console.log('[API] Employee sync results:', JSON.stringify(results)))
    .catch(err => console.error('[API] Employee sync failed:', err.message))
    .finally(() => { syncRunning = false; });
});

// POST /api/sync/abc/stop — abort a running ABC sync
app.post('/api/sync/abc/stop', requireSecret, (req, res) => {
  const stopped = stopAbcSync();
  if (stopped) {
    res.json({ status: 'stopping', message: 'ABC sync will stop after current location finishes' });
  } else {
    res.json({ status: 'not_running', message: 'No ABC sync is currently running' });
  }
});

// POST /api/sync/stop — abort any running GHL sync (full or delta)
app.post('/api/sync/stop', requireSecret, (req, res) => {
  if (!syncRunning) {
    return res.json({ status: 'not_running', message: 'No sync is currently running' });
  }
  stopGhlSync();
  syncRunning = false;
  res.json({ status: 'stopping', message: 'GHL sync will stop after current location finishes' });
});

// GET /api/sync/logs
app.get('/api/sync/logs', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const { data, error } = await supabase
    .from('ghl_sync_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/sync/status
app.get('/api/sync/status', async (req, res) => {
  const { data: lastDelta } = await supabase
    .from('ghl_sync_log')
    .select('*')
    .eq('sync_type', 'delta')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  const { data: lastFull } = await supabase
    .from('ghl_sync_log')
    .select('*')
    .eq('sync_type', 'full')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  const { count: contactCount } = await supabase
    .from('ghl_contacts_v2')
    .select('*', { count: 'exact', head: true });

  const { count: oppCount } = await supabase
    .from('ghl_opportunities_v2')
    .select('*', { count: 'exact', head: true });

  res.json({
    syncRunning,
    lastDelta,
    lastFull,
    recordCounts: {
      contacts: contactCount || 0,
      opportunities: oppCount || 0,
    },
  });
});

// Startup
async function main() {
  console.log('[Startup] GHL Sync Service starting...');

  // 1. Verify Supabase connection
  const { error } = await supabase.from('ghl_sync_state').select('key').limit(1);
  if (error) {
    console.error('[Startup] Supabase connection failed:', error.message);
    process.exit(1);
  }
  console.log('[Startup] Supabase connected');

  // 2. Start Express FIRST so Render detects the port
  app.listen(PORT, () => console.log(`[API] Listening on :${PORT}`));

  // 3. Start scheduler
  startScheduler();

  // 4. Skip startup full sync — delta sync runs every 10 min and daily full sync at 3am.
  //    Starting a full sync on every deploy blocks all other syncs for ~14 min.
  console.log('[Startup] Ready — delta sync will run on schedule, full sync daily at 3am');
}

main();
