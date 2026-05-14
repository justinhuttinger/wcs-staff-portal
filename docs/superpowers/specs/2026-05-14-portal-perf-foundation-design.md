# Portal performance foundation — design (Phase 1)

**Date:** 2026-05-14
**Author:** Justin Huttinger (w/ Claude)
**Status:** Approved
**Phase:** 1 of 3 (foundation; phases 2-3 are follow-up PRs)

## Problem

The portal has three perf-and-feel issues that show up across most reports:

1. **Slow reports feel broken.** Reports like Deactivated PT, PT New Clients, PT Health, and Revenue can take 10–30+ seconds because the backend hits ABC's API live in 180-day chunks. Users sometimes hit timeouts.
2. **No progress indication.** A `<p>Loading…</p>` (or worse, a blank panel) leaves users unsure if anything's happening. Mobile has a rich `MobileLoading` skeleton system; desktop has nothing equivalent.
3. **Every navigation re-fetches.** No client cache. Bouncing between two reports refetches both each time, even though nothing changed.

Phase 1 doesn't make the slow backend queries faster. It makes the portal *feel* significantly faster by hiding repeat-fetch latency entirely (cache), making first-fetch wait time legible (progress bar + skeletons), and stopping wasted server work when users navigate away mid-load (cancellation).

## Non-goals (deferred to Phase 2/3)

- Backend warm cache (stale-while-revalidate on the server, like `/tickets/status` already does).
- Sync ABC data into Supabase so live ABC API calls disappear.
- Pre-aggregated SQL views/RPCs for the heaviest reports.
- Bulk migration of every existing report to the new patterns — this PR ships one exemplar; the rest follow.

## Architecture

Four loosely-coupled units, each with a single purpose and a well-defined surface:

```
┌──────────────────────────────────────────────────────────────────────┐
│  portal/src/lib/api.js  (existing, modified)                         │
│  └─ pendingRequests counter + subscribe() for progress observers     │
│  └─ optional cache integration (reads/writes apiCache by request)    │
└────┬───────────────────────────────────────────────────────────────┬─┘
     │                                                               │
     ▼                                                               ▼
┌────────────────────────┐                            ┌────────────────────────────┐
│  portal/src/lib/       │                            │  portal/src/components/    │
│    apiCache.js  (new)  │                            │    GlobalProgressBar.jsx   │
│  in-memory TTL cache   │                            │     (new)                  │
│  stale-while-revalidate│                            │  subscribes to api.js,     │
│  invalidate(pattern)   │                            │  fades thin bar on idle    │
└────────────────────────┘                            └────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  portal/src/hooks/useCancellableFetch.js   (new)                    │
│  AbortController + auto-cancel on unmount + dep-driven refetch      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  portal/src/components/DesktopLoading.jsx   (new)                   │
│  skeleton variants: list, stats, report, appointments,              │
│  ranking, card-grid                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### `lib/apiCache.js`

```ts
type CacheEntry = { value: unknown; expiresAt: number }
const store = new Map<string, CacheEntry>()

function keyFor(path, params) // path + sorted query string
function get(key)             // null if missing or expired
function set(key, value, ttlMs)
function invalidate(pattern)  // string prefix OR RegExp; removes matching entries
function clear()              // wipe (e.g. on logout)
```

TTL strategy:
- Per-endpoint TTL config in a single map, easy to tune. Initial values:
  ```
  '/tickets/status':              5 * 60_000   // already server-cached 1h, client adds 5m
  '/reports/club-health':         60_000
  '/reports/checkins':            120_000
  '/reports/revenue':             60_000
  '/reports/membership':          60_000
  '/reports/cancels':             60_000
  '/reports/pt-roster':           120_000
  '/reports/payroll':             5 * 60_000
  '/reports/website-submissions/filter-options': 5 * 60_000
  // anything not in the map: no cache, fetch every time
  ```
- The cache is **opt-in per endpoint**. Endpoints not listed never cache. This means writes don't have to worry about stale cache for endpoints we haven't explicitly cached.

Invalidation:
- After a write call to an endpoint family, callers explicitly call `invalidate('/reports/website-submissions')` etc. We don't auto-invalidate based on HTTP method; the caller knows best.
- Logout calls `apiCache.clear()`.

### `lib/api.js` (modified)

Two surgical additions, fully backward-compatible:

1. **Request counter + subscribers.** A simple integer increments on every fetch start, decrements on resolve/reject. A subscriber list is notified on every change. `GlobalProgressBar` is the first subscriber.

2. **Cache opt-in.** Accept a `cache` option:
   ```js
   api('/reports/club-health?start=…&end=…', { cache: true })
   ```
   Behavior when `cache: true`:
   - Compute key. Check cache.
   - If fresh hit: return cached value synchronously (as a resolved Promise).
   - If stale hit (entry exists but expired) OR miss: kick off network fetch; on success, write to cache.
   - If `cache: 'stale-while-revalidate'`: if a stale entry exists, return it AND kick off a background refresh; the caller's first render uses stale, the second `useEffect` tick replaces it with fresh. (Implemented as the default behavior for `cache: true` — there is no `stale: false` variant in Phase 1.)

No other callsite needs to change. Existing `api(path)` calls keep working unchanged.

### `hooks/useCancellableFetch.js`

```js
function useCancellableFetch(fn, deps) {
  // returns { data, loading, error, refetch, cached }
  // - creates an AbortController per dep-change
  // - calls fn(signal); cleanup aborts the in-flight request
  // - if fn throws AbortError, ignore (component unmounted)
}
```

API mirrors the simplest version of `useQuery` from React Query without the dependency. Reports adopt it incrementally; nothing forces all of them at once.

### `components/GlobalProgressBar.jsx`

- Single thin bar, full width, `position: fixed; top: 0; height: 3px`.
- Subscribes to `api.js` pending count on mount.
- States:
  - `count === 0` → bar is `width: 0`, fully transparent.
  - `count > 0` → bar animates `width: 0 → 80%` over ~2s, then trickles toward 95% asymptotically.
  - `count` drops to 0 → bar finishes to 100%, fades, resets.
- Colored `--color-wcs-red` to match the brand accent already used elsewhere.
- Mounted once in `App.jsx` so it's visible everywhere.

### `components/DesktopLoading.jsx`

Mirrors `MobileLoading`'s API exactly so we can reason about both surfaces with one mental model. Variants for Phase 1:

| Variant | Shape | Used for |
|---|---|---|
| `list` (default) | Stacked card rows with shimmer | generic lists |
| `stats` | Grid of stat cards | Tile-row reports (Club Health KPIs) |
| `report` | Stat grid + 2 chart cards | Mixed reports (Membership, Revenue) |
| `appointments` | Rows with title + meta + status pill | Day One Tracker, Tours |
| `ranking` | Rank pill + name + score | Leaderboard, Top Salespeople |
| `card-grid` | 2-col card grid | PT Roster, Tickets Status |

Shimmer animation done with a single CSS keyframe; no JS animation loop.

## Data flow — a typical report after migration

```
1. User clicks "Revenue" tile.
2. RevenueReport mounts, calls useCancellableFetch((signal) =>
     api('/reports/revenue?start=…&end=…', { cache: true, signal })
   ).
3. api():
   a. Increments pendingRequests → GlobalProgressBar starts.
   b. apiCache.get(key):
      - hit + fresh: resolve cached value synchronously.
        Decrement pending; bar finishes.
        Report renders with cached data instantly. STOP.
      - hit + stale: resolve cached value synchronously, AND kick off
        background fetch (no second pending increment).
      - miss: fetch.
   c. On network success: apiCache.set(); resolve with fresh value.
4. Report's useEffect picks up the fresh value, re-renders. Done.
5. User clicks "Back" mid-load: useCancellableFetch's cleanup aborts the
   in-flight fetch. Render stops. Pending count decrements.
```

## Migrations in this PR

To prove the foundation works, **one** report migrates end-to-end:

- **`DeactivatedPTReport.jsx`** (desktop). Reasons:
  - It's slow (multi-chunk ABC fetch) so cache + skeleton gains are most visible.
  - Already has loading state today, so the diff is constrained to: add `useCancellableFetch`, swap `<p>Loading…</p>` for `<DesktopLoading variant="report" />`, mark the endpoint cacheable.

Documentation of the migration pattern goes inline in code comments + a short "How to migrate a report" section in the spec (this doc).

**All other reports keep their current loading code** until later PRs migrate them one at a time.

## "How to migrate a report" pattern

For future PRs:

1. Add the endpoint to the TTL config in `lib/apiCache.js` with a sensible TTL.
2. In the report component, swap:
   ```js
   useEffect(() => { setLoading(true); api(...).then(setData).finally(() => setLoading(false)) }, [deps])
   ```
   for:
   ```js
   const { data, loading, error } = useCancellableFetch(
     (signal) => api('/path', { cache: true, signal }),
     [deps]
   )
   ```
3. Swap the `<p>Loading…</p>` placeholder for the matching `<DesktopLoading variant="…" />`.
4. If the report has a "Refresh" button, hook it to the returned `refetch()` which bypasses cache.
5. If the report mutates data (form submit), call `apiCache.invalidate('/path')` after the write.

## Error handling

- `useCancellableFetch` distinguishes `AbortError` (silent, expected on unmount) from real errors (surface to the report's `error` state).
- `api()` cache write failures are non-fatal: log + skip cache write. Fresh data still returns.
- `apiCache.invalidate(pattern)` is a no-op if no matches — never throws.
- `GlobalProgressBar` is resilient to subscriber leaks (unsubscribe cleanup in `useEffect` return).

## Testing

- **Manual smoke (in lieu of unit tests for v1):**
  - Open Reporting → click Club Health → wait for load → click another tile → click back to Club Health. Second visit renders instantly (cache hit). Bar still ticks during background refresh.
  - Click Deactivated PT → before it finishes, click another tile. Confirm Render logs no further work for the abandoned fetch (cancellation worked).
  - Open desktop Deactivated PT → confirm skeleton renders before data lands.
- **Telemetry (cheap):** add a `console.debug('[cache]', hit ? 'hit' : 'miss', key)` line to apiCache in dev only, removed before merge.

## Out of scope

- Backend cache changes (Phase 2).
- ABC data sync into Supabase (Phase 3).
- Mobile equivalents — `MobileLoading` already exists; mobile already uses `signal` in some places. Mobile-side cache hookup can ride on the same `api.js` change but no skeleton/UX work needed.
- Per-report query optimization (Phase 2/3).
- Service-worker caching (overkill for this app's traffic).
- Persistent cross-session cache (localStorage) — out for now to keep complexity low.

## File inventory

| File | Status | Purpose |
|---|---|---|
| `portal/src/lib/api.js` | modified | progress subscribers + cache opt-in |
| `portal/src/lib/apiCache.js` | new | in-memory TTL cache |
| `portal/src/hooks/useCancellableFetch.js` | new | AbortController + cleanup hook |
| `portal/src/components/GlobalProgressBar.jsx` | new | top-of-screen progress bar |
| `portal/src/components/DesktopLoading.jsx` | new | skeleton variants for desktop |
| `portal/src/App.jsx` | modified | mount `<GlobalProgressBar/>` |
| `portal/src/components/reports/DeactivatedPTReport.jsx` | modified | first migration exemplar |

Mobile: `MobileApp.jsx` also mounts `<GlobalProgressBar/>` so the bar shows on both surfaces. `MobileLoading` stays as-is.
