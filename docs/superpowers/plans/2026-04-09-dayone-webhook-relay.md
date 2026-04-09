# Day One Completion Webhook Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll GHL Day One calendar events during each delta sync cycle and POST webhooks to per-location GHL workflow URLs when appointments complete, bypassing unreliable GHL automations.

**Architecture:** New module in ghl-sync fetches today's Day One events per location, filters to completed (past endTime, not cancelled), deduplicates via a Supabase tracking table, and POSTs to per-location webhook URLs. Admin portal gets a new tile to view webhook history. Auth API gets a new endpoint to query the webhook log.

**Tech Stack:** Node.js (ghl-sync service), Supabase (Postgres), React 19 + Tailwind 4 (portal), Express (auth API)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `ghl-sync/src/config/locations.js` | Modify | Add `dayOneWebhookUrl` per location from env |
| `ghl-sync/src/webhooks/dayOneWebhook.js` | Create | Core logic: fetch events, filter, send webhooks, record results |
| `ghl-sync/src/scheduler.js` | Modify | Call dayOneWebhook.run() after each delta sync |
| `auth/src/routes/admin.js` | Modify | Add GET /admin/webhook-logs endpoint |
| `portal/src/lib/api.js` | Modify | Add getWebhookLogs() function |
| `portal/src/components/admin/WebhookLogs.jsx` | Create | Webhook log viewer component |
| `portal/src/components/AdminPanel.jsx` | Modify | Add Webhooks tile to admin panel |

---

### Task 1: Create Supabase Table

**Files:**
- No code file — SQL migration run directly in Supabase

- [ ] **Step 1: Create the ghl_dayone_webhooks table**

Run this SQL in the Supabase SQL Editor (project `ybopxxydsuwlbwxiuzve`):

```sql
CREATE TABLE ghl_dayone_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  location_id text NOT NULL,
  contact_id text,
  webhook_url text,
  payload jsonb,
  status text NOT NULL DEFAULT 'pending',
  error text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (event_id, location_id)
);

CREATE INDEX idx_dayone_webhooks_location ON ghl_dayone_webhooks (location_id);
CREATE INDEX idx_dayone_webhooks_status ON ghl_dayone_webhooks (status);
CREATE INDEX idx_dayone_webhooks_sent_at ON ghl_dayone_webhooks (sent_at DESC);
```

- [ ] **Step 2: Verify the table was created**

Run: `SELECT * FROM ghl_dayone_webhooks LIMIT 1;` — should return 0 rows, no error.

- [ ] **Step 3: Commit a note about the migration**

```bash
git add -A
git commit -m "docs: note ghl_dayone_webhooks table creation (run in Supabase)"
```

---

### Task 2: Add Webhook URLs to Location Config

**Files:**
- Modify: `ghl-sync/src/config/locations.js`

- [ ] **Step 1: Add dayOneWebhookUrl to each location**

Replace the full contents of `ghl-sync/src/config/locations.js`:

```javascript
require('dotenv').config();

const LOCATIONS = [
  { id: process.env.GHL_LOCATION_SALEM,       apiKey: process.env.GHL_API_KEY_SALEM,       name: 'Salem',       slug: 'salem',       dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_SALEM },
  { id: process.env.GHL_LOCATION_KEIZER,      apiKey: process.env.GHL_API_KEY_KEIZER,      name: 'Keizer',      slug: 'keizer',      dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_KEIZER },
  { id: process.env.GHL_LOCATION_EUGENE,      apiKey: process.env.GHL_API_KEY_EUGENE,      name: 'Eugene',      slug: 'eugene',      dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_EUGENE },
  { id: process.env.GHL_LOCATION_SPRINGFIELD, apiKey: process.env.GHL_API_KEY_SPRINGFIELD, name: 'Springfield', slug: 'springfield', dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_SPRINGFIELD },
  { id: process.env.GHL_LOCATION_CLACKAMAS,   apiKey: process.env.GHL_API_KEY_CLACKAMAS,   name: 'Clackamas',   slug: 'clackamas',   dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_CLACKAMAS },
  { id: process.env.GHL_LOCATION_MILWAUKIE,   apiKey: process.env.GHL_API_KEY_MILWAUKIE,   name: 'Milwaukie',   slug: 'milwaukie',   dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_MILWAUKIE },
  { id: process.env.GHL_LOCATION_MEDFORD,     apiKey: process.env.GHL_API_KEY_MEDFORD,     name: 'Medford',     slug: 'medford',     dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_MEDFORD },
].filter(loc => loc.id && loc.apiKey); // Skip locations without configured IDs or API keys

module.exports = LOCATIONS;
```

- [ ] **Step 2: Commit**

```bash
git add ghl-sync/src/config/locations.js
git commit -m "feat: add dayOneWebhookUrl to ghl-sync location config"
```

---

### Task 3: Build the Day One Webhook Module

**Files:**
- Create: `ghl-sync/src/webhooks/dayOneWebhook.js`

- [ ] **Step 1: Create the webhooks directory and module**

Create `ghl-sync/src/webhooks/dayOneWebhook.js`:

```javascript
const axios = require('axios');
const { get } = require('../ghl/client');
const supabase = require('../db/supabase');
const LOCATIONS = require('../config/locations');

const CAL_VERSION = '2021-04-15';

// Cache: locationId -> { calendarIds, groupId }
const calendarCache = {};

/**
 * Discover Day One calendars at a location.
 * Searches for calendars with "day one", "dayone", or "day 1" in the name.
 */
async function getDayOneCalendarInfo(locationId, apiKey) {
  if (calendarCache[locationId]) return calendarCache[locationId];

  const data = await get('/calendars/', { locationId }, apiKey);
  const calendars = data.calendars || [];

  const dayOneCalendars = calendars.filter(cal => {
    const name = (cal.name || '').toLowerCase();
    return name.includes('day one') || name.includes('dayone') || name.includes('day 1');
  });

  if (dayOneCalendars.length > 0) {
    const groupId = dayOneCalendars[0].groupId || null;
    const result = { calendarIds: dayOneCalendars.map(c => c.id), groupId };
    calendarCache[locationId] = result;
    console.log(`[DayOneWebhook] Found ${result.calendarIds.length} Day One calendars for ${locationId}, groupId: ${groupId}`);
    return result;
  }

  console.log(`[DayOneWebhook] No Day One calendars found for ${locationId}`);
  return { calendarIds: [], groupId: null };
}

/**
 * Fetch today's Day One events for a location.
 * Returns array of event objects.
 */
async function fetchTodayEvents(location) {
  const calInfo = await getDayOneCalendarInfo(location.id, location.apiKey);
  if (calInfo.calendarIds.length === 0) return [];

  // Today's boundaries in UTC (covers full day)
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

  const params = {
    locationId: location.id,
    startTime: startOfDay.getTime().toString(),
    endTime: endOfDay.getTime().toString(),
  };

  let events = [];

  if (calInfo.groupId) {
    params.groupId = calInfo.groupId;
    const data = await get('/calendars/events', params, location.apiKey);
    events = data.events || [];
  } else {
    for (const calId of calInfo.calendarIds) {
      const data = await get('/calendars/events', { ...params, calendarId: calId }, location.apiKey);
      events.push(...(data.events || []));
    }
  }

  return events;
}

/**
 * Fetch GHL users for a location. Returns map: userId -> { name, email, phone }
 */
async function fetchUserMap(location) {
  const userMap = {};
  try {
    const data = await get('/users/', { locationId: location.id }, location.apiKey);
    for (const u of (data.users || [])) {
      userMap[u.id] = {
        name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim(),
        email: (u.email || '').toLowerCase(),
        phone: u.phone || null,
      };
    }
  } catch (e) {
    console.warn(`[DayOneWebhook] Could not fetch users for ${location.slug}:`, e.message);
  }
  return userMap;
}

/**
 * Check which event IDs have already been successfully webhooks for a location.
 * Returns a Set of event_ids.
 */
async function getAlreadySent(eventIds, locationId) {
  if (eventIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('ghl_dayone_webhooks')
    .select('event_id')
    .eq('location_id', locationId)
    .eq('status', 'sent')
    .in('event_id', eventIds);

  if (error) {
    console.error(`[DayOneWebhook] Error checking sent webhooks:`, error.message);
    return new Set();
  }

  return new Set((data || []).map(r => r.event_id));
}

/**
 * Send a webhook and record the result.
 */
async function sendWebhook(location, event, userMap) {
  const trainerInfo = userMap[event.assignedUserId] || {};
  const payload = {
    contactId: event.contactId || null,
    contactName: event.title || event.contactName || 'Unknown',
    contactEmail: event.contactEmail || null,
    contactPhone: event.contactPhone || null,
    trainerName: trainerInfo.name || null,
    trainerPhone: trainerInfo.phone || null,
    appointmentId: event.id,
    appointmentStart: event.startTime ? new Date(parseInt(event.startTime)).toISOString() : event.start || null,
    appointmentEnd: event.endTime ? new Date(parseInt(event.endTime)).toISOString() : event.end || null,
    locationSlug: location.slug,
  };

  let status = 'sent';
  let error = null;

  try {
    await axios.post(location.dayOneWebhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    console.log(`[DayOneWebhook] Sent webhook for event ${event.id} at ${location.slug} — contact: ${payload.contactName}`);
  } catch (err) {
    status = 'failed';
    error = err.response ? `${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
    console.error(`[DayOneWebhook] Failed for event ${event.id} at ${location.slug}: ${error}`);
  }

  // Upsert — if a previous failed attempt exists, update it
  await supabase
    .from('ghl_dayone_webhooks')
    .upsert({
      event_id: event.id,
      location_id: location.id,
      contact_id: event.contactId || null,
      webhook_url: location.dayOneWebhookUrl,
      payload,
      status,
      error,
      sent_at: new Date().toISOString(),
    }, { onConflict: 'event_id,location_id' });
}

/**
 * Main entry point — called after each delta sync.
 * Checks all locations for completed Day One appointments and sends webhooks.
 */
async function run() {
  console.log('[DayOneWebhook] Checking for completed Day One appointments...');
  const now = Date.now();
  let totalSent = 0;
  let totalSkipped = 0;

  for (const location of LOCATIONS) {
    if (!location.dayOneWebhookUrl) {
      continue; // No webhook URL configured — skip silently
    }

    try {
      const events = await fetchTodayEvents(location);

      // Filter: endTime has passed AND not cancelled
      const completedEvents = events.filter(evt => {
        const endMs = evt.endTime ? parseInt(evt.endTime) : (evt.end ? new Date(evt.end).getTime() : 0);
        const isCancelled = (evt.appointmentStatus || '').toLowerCase() === 'cancelled';
        return endMs > 0 && endMs <= now && !isCancelled;
      });

      if (completedEvents.length === 0) continue;

      // Check which have already been sent
      const eventIds = completedEvents.map(e => e.id);
      const alreadySent = await getAlreadySent(eventIds, location.id);

      const toSend = completedEvents.filter(e => !alreadySent.has(e.id));
      totalSkipped += completedEvents.length - toSend.length;

      if (toSend.length === 0) continue;

      // Fetch user map for trainer info
      const userMap = await fetchUserMap(location);

      for (const event of toSend) {
        await sendWebhook(location, event, userMap);
        totalSent++;
      }
    } catch (err) {
      console.error(`[DayOneWebhook] Error processing ${location.slug}:`, err.message);
    }
  }

  if (totalSent > 0 || totalSkipped > 0) {
    console.log(`[DayOneWebhook] Done. Sent: ${totalSent}, Already sent: ${totalSkipped}`);
  }
}

module.exports = { run };
```

- [ ] **Step 2: Verify the file requires resolve correctly**

```bash
cd /c/Users/justi/wcs-staff-portal/ghl-sync && node -e "require('./src/webhooks/dayOneWebhook')"
```

Expected: No errors (it will fail on missing env vars at runtime, but the require/parse should succeed).

- [ ] **Step 3: Commit**

```bash
git add ghl-sync/src/webhooks/dayOneWebhook.js
git commit -m "feat: add Day One completion webhook module"
```

---

### Task 4: Wire Webhook into Scheduler

**Files:**
- Modify: `ghl-sync/src/scheduler.js`

- [ ] **Step 1: Import and call dayOneWebhook after delta sync**

Replace the full contents of `ghl-sync/src/scheduler.js`:

```javascript
const cron = require('node-cron');
const { fullSync } = require('./sync/fullSync');
const { deltaSync } = require('./sync/deltaSync');
const { run: runDayOneWebhook } = require('./webhooks/dayOneWebhook');

function startScheduler() {
  const intervalMinutes = process.env.SYNC_INTERVAL_MINUTES || 10;
  const fullSyncHour = process.env.FULL_SYNC_HOUR || 3; // PST
  // Convert PST to UTC: PST + 8 = UTC (or +7 during PDT)
  const fullSyncHourUTC = (parseInt(fullSyncHour) + 8) % 24;

  // Delta sync every N minutes, then check for completed Day One appointments
  cron.schedule(`*/${intervalMinutes} * * * *`, async () => {
    console.log('[Scheduler] Starting delta sync...');
    try {
      await deltaSync();
    } catch (err) {
      console.error('[Scheduler] Delta sync failed:', err.message);
    }
    // Run webhook check after delta sync completes (regardless of sync success)
    try {
      await runDayOneWebhook();
    } catch (err) {
      console.error('[Scheduler] Day One webhook check failed:', err.message);
    }
  });

  // Full re-sync daily
  cron.schedule(`0 ${fullSyncHourUTC} * * *`, () => {
    console.log('[Scheduler] Starting daily full sync...');
    fullSync().catch(err => console.error('[Scheduler] Full sync failed:', err.message));
  });

  console.log(`[Scheduler] Delta sync every ${intervalMinutes}m, full sync daily at ${fullSyncHour}:00 PST (${fullSyncHourUTC}:00 UTC)`);
}

module.exports = { startScheduler };
```

- [ ] **Step 2: Commit**

```bash
git add ghl-sync/src/scheduler.js
git commit -m "feat: run Day One webhook check after each delta sync"
```

---

### Task 5: Add Webhook Logs API Endpoint

**Files:**
- Modify: `auth/src/routes/admin.js`

- [ ] **Step 1: Read the full current admin.js to find the end of the file**

Read `auth/src/routes/admin.js` to find where to add the new route.

- [ ] **Step 2: Add the webhook-logs GET endpoint**

Add this route to `auth/src/routes/admin.js` before `module.exports = router`:

```javascript
// GET /admin/webhook-logs — manager+ (webhook send history)
router.get('/webhook-logs', requireRole('manager'), async (req, res) => {
  try {
    const { location_slug, status, start_date, end_date, page = 1, limit = 25 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = supabaseAdmin
      .from('ghl_dayone_webhooks')
      .select('*', { count: 'exact' })
      .order('sent_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (location_slug) query = query.eq('payload->>locationSlug', location_slug)
    if (status) query = query.eq('status', status)
    if (start_date) query = query.gte('sent_at', start_date + 'T00:00:00Z')
    if (end_date) query = query.lte('sent_at', end_date + 'T23:59:59Z')

    const { data, count, error } = await query
    if (error) throw error

    res.json({ logs: data || [], total: count || 0 })
  } catch (err) {
    console.error('[Admin] webhook-logs error:', err.message)
    res.status(500).json({ error: 'Failed to fetch webhook logs' })
  }
})
```

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/admin.js
git commit -m "feat: add GET /admin/webhook-logs endpoint"
```

---

### Task 6: Add API Helper to Portal

**Files:**
- Modify: `portal/src/lib/api.js`

- [ ] **Step 1: Add getWebhookLogs function**

Add this at the end of `portal/src/lib/api.js`, before the final line or at the bottom:

```javascript
// Webhook Logs
export async function getWebhookLogs(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/admin/webhook-logs' + (qs ? '?' + qs : ''))
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat: add getWebhookLogs API helper"
```

---

### Task 7: Build WebhookLogs Admin Component

**Files:**
- Create: `portal/src/components/admin/WebhookLogs.jsx`

- [ ] **Step 1: Create the admin subdirectory if needed and the component**

```bash
ls /c/Users/justi/wcs-staff-portal/portal/src/components/admin/ 2>/dev/null || mkdir -p /c/Users/justi/wcs-staff-portal/portal/src/components/admin/
```

Create `portal/src/components/admin/WebhookLogs.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { getWebhookLogs } from '../../lib/api'

const LOCATION_OPTIONS = [
  { label: 'All Locations', value: '' },
  { label: 'Salem', value: 'salem' },
  { label: 'Keizer', value: 'keizer' },
  { label: 'Eugene', value: 'eugene' },
  { label: 'Springfield', value: 'springfield' },
  { label: 'Clackamas', value: 'clackamas' },
  { label: 'Milwaukie', value: 'milwaukie' },
  { label: 'Medford', value: 'medford' },
]

const STATUS_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Sent', value: 'sent' },
  { label: 'Failed', value: 'failed' },
]

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function WebhookLogs() {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [locationFilter, setLocationFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const limit = 25

  useEffect(() => {
    loadLogs()
  }, [page, locationFilter, statusFilter])

  async function loadLogs() {
    setLoading(true)
    try {
      const params = { page, limit }
      if (locationFilter) params.location_slug = locationFilter
      if (statusFilter) params.status = statusFilter
      const res = await getWebhookLogs(params)
      setLogs(res.logs || [])
      setTotal(res.total || 0)
    } catch (err) {
      console.error('Failed to load webhook logs:', err)
    }
    setLoading(false)
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={locationFilter}
          onChange={e => { setLocationFilter(e.target.value); setPage(1) }}
          className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary"
        >
          {LOCATION_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary"
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={() => { setPage(1); loadLogs() }}
          className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary"
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg text-text-muted text-left">
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Location</th>
              <th className="px-4 py-2 font-medium">Contact</th>
              <th className="px-4 py-2 font-medium">Trainer</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted">Loading...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted">No webhook logs found</td></tr>
            ) : logs.map(log => (
              <>
                <tr
                  key={log.id}
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  className="border-t border-border hover:bg-bg/50 cursor-pointer"
                >
                  <td className="px-4 py-2">{formatDate(log.sent_at)}</td>
                  <td className="px-4 py-2 capitalize">{log.payload?.locationSlug || '—'}</td>
                  <td className="px-4 py-2">{log.payload?.contactName || '—'}</td>
                  <td className="px-4 py-2">{log.payload?.trainerName || '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      log.status === 'sent'
                        ? 'bg-green-500/10 text-green-400'
                        : 'bg-red-500/10 text-red-400'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-text-muted text-xs truncate max-w-[200px]">{log.error || '—'}</td>
                </tr>
                {expandedId === log.id && (
                  <tr key={log.id + '-detail'} className="border-t border-border bg-bg/30">
                    <td colSpan={6} className="px-4 py-3">
                      <p className="text-xs text-text-muted mb-1 font-medium">Payload:</p>
                      <pre className="text-xs text-text-primary bg-bg rounded-lg p-3 overflow-x-auto">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-text-muted">{total} total</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border border-border text-sm disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-sm text-text-muted px-2 py-1">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded border border-border text-sm disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/admin/WebhookLogs.jsx
git commit -m "feat: add WebhookLogs admin component"
```

---

### Task 8: Add Webhooks Tile to Admin Panel

**Files:**
- Modify: `portal/src/components/AdminPanel.jsx`

- [ ] **Step 1: Import WebhookLogs and add to ADMIN_TILES**

In `portal/src/components/AdminPanel.jsx`:

Add import at line 7 (after the SyncStatusTile import):

```javascript
import WebhookLogs from './admin/WebhookLogs'
```

Add a new entry to the `ADMIN_TILES` array after the `config` entry:

```javascript
  { key: 'webhooks', label: 'Webhooks', description: 'View Day One webhook history and payloads', icon: 'M7.5 7.5h-.75A2.25 2.25 0 0 0 4.5 9.75v7.5a2.25 2.25 0 0 0 2.25 2.25h7.5a2.25 2.25 0 0 0 2.25-2.25v-7.5a2.25 2.25 0 0 0-2.25-2.25h-.75m-6 3.75 3 3m0 0 3-3m-3 3V1.5m6 9h.75a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-7.5a2.25 2.25 0 0 1 2.25-2.25H9' },
```

Add the rendering case inside the `if (activeSection)` block, alongside the other section renderers (after the config line):

```javascript
        {activeSection === 'webhooks' && <WebhookLogs />}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/AdminPanel.jsx
git commit -m "feat: add Webhooks tile to admin panel"
```

---

### Task 9: Test End-to-End Locally

- [ ] **Step 1: Verify ghl-sync starts without errors**

```bash
cd /c/Users/justi/wcs-staff-portal/ghl-sync && node -e "
  require('dotenv').config();
  const { run } = require('./src/webhooks/dayOneWebhook');
  console.log('Module loaded OK');
"
```

Expected: `Module loaded OK`

- [ ] **Step 2: Verify portal builds**

```bash
cd /c/Users/justi/wcs-staff-portal/portal && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Verify auth API starts without errors**

```bash
cd /c/Users/justi/wcs-staff-portal/auth && node -e "
  require('./src/routes/admin');
  console.log('Admin routes loaded OK');
"
```

Expected: `Admin routes loaded OK`

- [ ] **Step 4: Final commit with all changes**

If any fixes were needed during testing, commit them:

```bash
git add -A
git commit -m "fix: address issues found during end-to-end testing"
```

---

### Task 10: Deploy and Configure

- [ ] **Step 1: Push to GitHub**

```bash
cd /c/Users/justi/wcs-staff-portal && git push origin master
```

- [ ] **Step 2: Add environment variables to Render ghl-sync service**

For each location where you have a GHL workflow ready, add the env var:
- `GHL_WEBHOOK_DAYONE_SALEM` = (your GHL webhook URL)
- (repeat for each location as workflows are created)

Locations without a webhook URL env var will be silently skipped.

- [ ] **Step 3: Verify on Render**

Check the ghl-sync logs on Render after the next delta sync cycle. Look for:
- `[DayOneWebhook] Checking for completed Day One appointments...`
- `[DayOneWebhook] Sent webhook for event...` (if there are completed appointments)

- [ ] **Step 4: Verify admin tile**

Open the portal, go to Admin Panel, click the Webhooks tile. Should show the log table (empty initially, populated after webhooks fire).
