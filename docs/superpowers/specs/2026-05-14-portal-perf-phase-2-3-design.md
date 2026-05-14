# Portal performance — Phase 2 & 3 design (continuation)

**Date:** 2026-05-14
**Author:** Justin Huttinger (w/ Claude)
**Status:** Drafted — not started. Phase 1 shipped in PRs #153/#154/#155.
**Predecessor:** `2026-05-14-portal-perf-foundation-design.md` (Phase 1)

This doc is a self-contained pickup point for a future session. It captures
*what's done*, *what's next*, *where to start*, and the *non-obvious gotchas*
discovered while shipping Phase 1.

---

## Where we are

Phase 1 — client-side foundation — is **shipped**:

- **PR #153** (`feat/perf-foundation`) merged: client cache (`portal/src/lib/apiCache.js`),
  global progress bar (`portal/src/components/GlobalProgressBar.jsx`),
  `useCancellableFetch` hook, `DesktopLoading` skeleton component, one
  exemplar migration (`DeactivatedPTReport`).
- **PR #154** (`feat/perf-foundation-1b`) merged: 12 desktop reports migrated.
- **PR #155** (`feat/perf-foundation-1c-mobile`) merged: 17 mobile reports +
  `WebsiteSubmissionsReport` migrated; Meta Ads, Google Business/Analytics,
  Operandio, and Website Submissions API helpers accept `options` so callers
  can opt into cache + AbortSignal.

**What Phase 1 fixed:** Navigation *feels* fast. Repeat visits to a report
within its TTL render instantly from cache. In-flight requests cancel on
unmount. Skeletons replace "Loading…" text.

**What Phase 1 did NOT fix:** First-visit latency. A cold load of Deactivated
PT or PT Health for "All Locations" still takes 30–90s because the backend
hits ABC's API live in 180-day chunks, sequentially per location. That's
what Phase 2/3 are for.

---

## Phase 2 — backend warm cache (stale-while-revalidate)

### Goal

The *first* user to hit a slow report each TTL window pays the latency cost.
Every subsequent user (including the same user across page refreshes or
different sessions) gets an instant response from the server-side cache.
Background refresh keeps the cache warm so even the "first" request usually
hits a recently-warmed entry rather than truly cold.

Expected impact: Deactivated PT for All Locations drops from ~60s to <500ms
for any user who hits the cached path. A nightly warmup cron eliminates
the cold path entirely.

### Architecture

We already have a tiny in-memory TTL cache: `auth/src/services/memoryCache.js`.
It exposes `get`, `set`, `del`, and `wrap(key, ttl, producer)`. Currently
only used by `routes/driveFolders.js` and `routes/hrDocuments.js`.

This is the right building block — we extend it with stale-while-revalidate
semantics and wire it into the slow report routes.

```
┌────────────────────────────────────────────────────────────┐
│  auth/src/services/memoryCache.js (modify)                 │
│  ─ keep get/set/del/wrap                                   │
│  ─ add wrapSWR(key, freshMs, staleMs, producer)            │
│     • fresh  → return cached, no refresh                   │
│     • stale  → return cached, kick off bg refresh          │
│     • miss   → fetch + return + cache                      │
│     • singleflight: dedupe concurrent producers per key    │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  auth/src/routes/{deactivatedPT,ptNewClients,ptHealth,     │
│    ptRoster,ptSessions,checkinsReport,dayOneTracker}.js    │
│                                                            │
│  Inside each GET handler, AFTER auth/role check:           │
│    const key = cacheKey(req)                               │
│    const data = await wrapSWR(key, fresh, stale, async () =>│
│      ...existing fetcher logic                             │
│    )                                                       │
│    res.json(data)                                          │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  auth/src/services/cacheWarmer.js (new)                    │
│  Cron-scheduled warmup. Calls each slow endpoint's         │
│  fetcher with common param sets so the cache is hot        │
│  before users arrive each morning.                         │
└────────────────────────────────────────────────────────────┘
```

### Important constraints

- **Auth gate runs every request.** The cache key must NOT include the
  caller's identity — that defeats sharing. But the route's existing
  `requireRole` middleware MUST run before consulting the cache so an
  unauthorized user never sees data they shouldn't.
- **Cache key = path + sorted query params + location filter.** Two users
  asking for the same `(location_slug, start_date, end_date, status)`
  share a cache entry. A user-specific param (e.g. trainer filter when
  the report filters to just *their* clients) belongs in the key.
- **Location-scoping: respect the user's location list.** When `location_slug=all`
  is requested by a corporate-level user, the cached "all" entry is fine
  to serve. When a single-location user requests their own location, the
  per-location entry is fine. The auth middleware already rejects
  cross-location requests, so the cache never serves data to someone
  unauthorized — but verify this assumption per-route.
- **Singleflight.** When the cache is cold and 5 users hit it
  simultaneously, only ONE should run the expensive fetcher. The other 4
  await the same promise. Implement with a `Map<key, Promise>` of
  in-flight producers in `memoryCache.js`.
- **No serving stale on error.** If the background revalidate throws,
  keep the stale value in the cache until TTL expires — but log the
  error to `auditLog` for visibility. Don't crash the request that
  triggered the revalidate.

### Per-route TTLs

Match the client-side TTLs in `portal/src/lib/apiCache.js` so the two
layers compose cleanly (client miss → server hit → client cache fills):

| Endpoint | Fresh | Stale-allowed | Notes |
|---|---|---|---|
| `/reports/deactivated-pt` | 5 min | 30 min | Slow ABC loop; warmup-eligible |
| `/reports/pt-new-clients` | 5 min | 30 min | Slow ABC loop; warmup-eligible |
| `/reports/pt-health` | 5 min | 30 min | Slow ABC + GHL; warmup-eligible |
| `/reports/pt-roster` | 2 min | 15 min | Less slow but still ABC-bound |
| `/reports/pt-sessions` | 2 min | 15 min | |
| `/reports/checkins` | 2 min | 15 min | Pacific-time gotcha applies (see refs) |
| `/reports/club-health` | 1 min | 10 min | Cheap-ish, but heavily used |
| `/reports/membership` | 1 min | 10 min | |
| `/reports/cancels` | 1 min | 10 min | |
| `/tickets/status` | 5 min | already cached | leave as-is |

### Pickup checklist for a future session

1. Read `auth/src/services/memoryCache.js` end-to-end (~35 lines).
2. Read `auth/src/routes/deactivatedPT.js` to understand the route shape
   — it's the prime candidate for the first migration (largest win,
   most-felt slowness).
3. Add `wrapSWR(key, freshMs, staleMs, producer)` to `memoryCache.js`
   with singleflight (Map of in-flight promises keyed by cache key).
   Tests should cover: hit/fresh, hit/stale-triggers-bg-refresh,
   miss/single-flight (two concurrent calls → one producer call),
   producer-throws-on-stale-keeps-old-value.
4. Wire `/reports/deactivated-pt` through `wrapSWR`. Verify with a
   curl: first request slow, second request <50ms.
5. Repeat for the other slow endpoints in the table above. Order:
   `pt-new-clients`, `pt-health`, `pt-roster`, `pt-sessions`,
   `checkins`. The cheaper ones (club-health, membership, cancels)
   are lower-priority but trivial to add.
6. Build `auth/src/services/cacheWarmer.js`:
   - On startup (after a 30s grace period so the app is healthy first),
     fire off the slow-report fetchers for `location_slug=all` and
     each of the 7 locations using the "this month" date range.
   - Schedule a repeat every (freshMs - 30s) so entries never go fully
     cold during business hours.
   - Skip warmup outside 6am–10pm Pacific to avoid burning ABC API
     quota overnight.
7. Add a `/admin/cache/stats` endpoint (corp+admin only) so we can
   inspect cache hits/misses/size in production.

### Render deploy notes

- This is in-memory cache, NOT Redis. Render Starter is single-instance,
  so this works. **If we ever scale to multiple instances, this all needs
  to move to Redis.** Document this assumption in `memoryCache.js`.
- Render auto-deploys from `master`. Land the SWR helper + first route
  migration in one PR so the change is reviewable; subsequent route
  migrations can each be small follow-up PRs.

---

## Phase 3 — Sync ABC into Supabase

### Goal

Eliminate live ABC API calls from the report path entirely. Reports query
Supabase tables that a background job keeps in sync with ABC. First-load
latency drops to <200ms even for "All Locations / past 90 days" queries.

### Architecture sketch

We already have prior art for this pattern:
- `abc_revenue_transactions` powers Revenue / Daily Snapshot (sync via
  `auth/src/services/revenueIngest.js` and the hourly check-ins backfill).
- `abc_members` powers Daily Snapshot's membership-sign-date logic.
- `ghl_contacts_v2` / `ghl_opportunities_v2` power all GHL-derived reports
  (sync via the standalone `ghl-sync` service).

Phase 3 extends the same pattern to ABC's recurring-services / cancels /
sessions data:

```
ABC API   ─────────────►   abc-sync (new background job)   ─────►   Supabase
                                                                       │
                                                                       ▼
                              auth/routes/*.js  query Supabase  ◄──────┘
```

### Tables to create / extend

- `abc_recurring_services` — feeds Deactivated PT + PT New Clients + PT Roster +
  PT Health. Columns roughly: `member_id, club_number, service_id, service_item,
  sale_date, start_date, cancel_date, last_used_date, monthly_revenue, total_periods,
  status, commission_employee, service_employee, type` (recurring vs PIF).
- `abc_sessions` — feeds PT Sessions, Session Frequency. Columns: `event_id,
  member_id, club_number, employee_id, event_type, event_timestamp_local,
  status, attended_status, duration_minutes`.
- Probably extend `abc_members` with the contact fields that
  `getDeactivatedPTMember` currently fetches live (email, primary phone,
  mobile phone) so the modal drill-down doesn't need a live ABC call either.

### Sync strategy

- Hourly incremental sync per location (cron in `auth/src/routes/abcScheduler.js`
  or a new standalone service if it gets heavy).
- Daily full reconciliation at 3am PT (mirrors the `ghl-sync` pattern).
- Track `last_synced_at` per (location, table) so we know freshness.
- Surface freshness in the UI — small "data current as of HH:MM" footer
  on the affected reports so users know they're not seeing live numbers.

### Pickup checklist for a future session

1. **Map every current ABC API call.** Grep `auth/src/routes/` for `abcGet`,
   `abc.com`, or the ABC client module. Each call is something a synced
   table needs to satisfy. The slow ones we care about:
   - `deactivatedPT.js`: loops `getRecurringServices` per location in
     180-day chunks
   - `ptNewClients.js`: same pattern
   - `ptHealth.js`: same pattern + GHL day-one data
   - `ptRoster.js`: same pattern
   - `ptSessions.js`: hits ABC sessions endpoint per location
   - `checkinsReport.js`: hits ABC checkins summaries endpoint
2. Design the schemas (see "Tables to create / extend" above) — favor
   one row per ABC entity rather than denormalized views; let SQL views
   layer on top for report shapes.
3. Build the sync workers. The existing `ghl-sync` repo at
   `https://github.com/justinhuttinger/ghl-sync` is a good template — it
   already runs on Render Web Service, has delta/full endpoints, and is
   protected by a `SYNC_SECRET`.
4. Migrate ONE report at a time to read from Supabase, with a
   GrowthBook-style feature flag (or env-var toggle) so we can flip back
   to live ABC if the synced data is wrong. Start with Deactivated PT —
   same reason as Phase 2: biggest win, most-felt slowness.
5. Once all reports are off live ABC, remove the live-fetch fallback
   code and the ABC API client from the report route layer entirely.

### Risks and gotchas

- **ABC API quota.** Sync jobs hit ABC harder than ad-hoc report
  requests. Verify quota limits with ABC support before turning on
  hourly cross-club sync.
- **Reconciliation drift.** If the sync misses an event, the report is
  wrong without anyone noticing. The daily full reconcile + the
  "current as of" footer mitigate this. Consider a nightly invariant
  check that compares (Supabase row count for last 24h) vs (ABC API
  row count for last 24h) and pages oncall on drift > 1%.
- **PII storage.** Member emails/phones live in Supabase already
  (`abc_members`), so this isn't a new exposure — but worth confirming
  the RLS policies on any new tables.
- **Existing reference memory:**
  - `reference_abc_checkins_pacific_time.md` — ABC reads checkin range
    timestamps as Pacific local time, not UTC. Don't lose this when
    rewriting the checkins sync.
  - `reference_paychex_company_id.md` — unrelated to ABC but the same
    "per-location IDs differ" gotcha applies. Medford's ABC club number
    is in the locations config; verify nothing hardcodes legacy IDs.

---

## Sequencing recommendation

1. **Phase 2 first.** It's smaller, lower-risk, doesn't touch data
   ownership. Ships a real win in 1–2 days. The SWR helper is reusable
   for Phase 3's "while sync is catching up" fallback path.
2. **Phase 3 incrementally.** One report at a time over several weeks,
   each behind a flag. Don't try to migrate all 6 slow reports in one
   PR — the schema-design + sync-correctness blast radius is too big.

## Open questions to resolve before starting Phase 2

(None blocking — these are nice-to-haves Justin can answer in a sentence.)

- Should the warmup cron skip locations Justin knows have low report
  traffic (e.g. tiny clubs)? Or warm all 7 uniformly?
- Acceptable stale window for Deactivated PT specifically — is 30 min
  too long if a member cancels at 8:01am and a manager opens the report
  at 8:15am to act on it? If yes, tighten `staleMs` for that route.

## Files touched in Phase 1 (for future context)

Client side (already migrated, don't redo):

- `portal/src/lib/api.js` — pendingCounter + onPendingChange + cache integration
- `portal/src/lib/apiCache.js` — opt-in TTL map per endpoint
- `portal/src/hooks/useCancellableFetch.js` — the standard hook
- `portal/src/components/GlobalProgressBar.jsx`
- `portal/src/components/DesktopLoading.jsx`
- `portal/src/mobile/components/MobileLoading.jsx` — predates Phase 1; the
  desktop version mirrors its API
- All `portal/src/components/reports/*.jsx` (12 files)
- All `portal/src/mobile/components/reports/Mobile*.jsx` (17 files)

Migration pattern (drop-in for any future report that wants the new shape):

```jsx
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'  // or MobileLoading on mobile
import { getMyReport } from '../../lib/api'

export default function MyReport({ startDate, endDate, locationSlug }) {
  const { data, loading, error } = useCancellableFetch(
    (signal) => getMyReport(
      { start_date: startDate, end_date: endDate, location_slug: locationSlug },
      { cache: true, signal }
    ),
    [startDate, endDate, locationSlug]
  )
  if (loading) return <DesktopLoading variant="report" />
  if (error) return <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>
  if (!data) return null
  // ...render
}
```
