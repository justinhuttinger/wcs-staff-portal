require('dotenv').config();
const express = require('express');
const { fullSync, fullSyncForLocation } = require('./sync/fullSync');
const { deltaSync } = require('./sync/deltaSync');
const { run: runDayOneWebhook } = require('./webhooks/dayOneWebhook');
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

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    syncRunning,
    lastDelta: lastDelta?.completed_at || null,
    lastFull: lastFull?.completed_at || null,
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

// POST /api/webhooks/dayone — manually trigger Day One webhook relay
app.post('/api/webhooks/dayone', requireSecret, (req, res) => {
  res.json({ status: 'started', message: 'Day One webhook relay running in background' });
  runDayOneWebhook()
    .catch(err => console.error('[API] Day One webhook relay failed:', err.message));
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

  // 4. Run initial full sync in background (don't block startup)
  console.log('[Startup] Running initial full sync in background...');
  syncRunning = true;
  fullSync()
    .catch(err => console.error('[Startup] Initial full sync failed:', err.message))
    .finally(() => { syncRunning = false; });
}

main();
