# Google Marketing Report (GBP + GA4) — Design

**Status:** Approved 2026-04-28, pending implementation
**Owner:** Justin
**Audience:** Corporate / admin only (inherits Marketing tile gate)

## Goal

Build a combined Google Business Profile + Google Analytics 4 report inside the
Marketing hub, with date comparison vs. the prior equivalent period and per-location
filtering.

## Placement

The existing **Marketing → Google** tile currently renders `GoogleBusinessView`.
That branch is replaced with a new `GoogleMarketingView` that contains both GBP
and GA4 in a single sectioned page (mirroring how Club Health is split into
Membership / PT).

Marketing tile visibility unchanged: corporate + admin only
(`portal/src/components/ToolGrid.jsx`).

## Layout

Header card (date controls + location selector) on top. Then:

1. **Connect Google** banner — only renders if tokens missing or scope incomplete.
2. **Section: Google Business Profile** — the existing per-location performance
   table (searches, website clicks, calls, directions), restyled to match the
   sectioned look.
3. **Section: Google Analytics** — six panels:
   - Stat-card row: Sessions, Users, New Users, Engagement Rate, Avg Session Duration
   - Sources: top 10 by `sessionDefaultChannelGroup` and top 10 by `sessionSource`
   - Top pages: top 10 by `pagePath` (views, sessions, users)
   - Devices: pie of `deviceCategory`
   - Top cities: list of top 5 by sessions
   - Key events: shows configured key events; empty-state "No key events
     configured yet" if none

Date controls support a `compare` toggle (default on). Each stat card and the
GBP table show a `+12% ▲` / `−4% ▼` chip computed against the prior equivalent
period.

## GA4 configuration

- **Single GA4 property** for `westcoaststrength.com`. Property ID stored in
  Render env var `GA4_PROPERTY_ID`, with fallback to
  `app_config.ga4_property_id` in Supabase so it can be changed without redeploy.
- **Location filter:** `pagePath` regex filter `^/<slug>(/|$)` where slug is
  one of `salem | keizer | eugene | springfield | clackamas | milwaukie | medford`.
  "All Locations" applies no filter.
- **Date comparison:** when `compare=true`, the backend computes a same-length
  window ending the day before `start_date` and returns both periods.
- **Key events:** report uses `eventName` dimension with `isKeyEvent` filter
  (or `keyEvents` metric where supported). Empty array if none configured.

## Backend

### Auth (extending existing OAuth)

`auth/src/routes/googleBusiness.js`:
- Add `https://www.googleapis.com/auth/analytics.readonly` to `SCOPES`.
- Existing `/google-business/authorize` already uses `prompt: 'consent'`, so
  reconnecting cleanly upgrades scope.
- Token storage unchanged (single `app_config.google_business_tokens` row).
- Export `getAccessToken()` so the GA route can reuse it (or factor into a
  shared helper).

### New file: `auth/src/routes/googleAnalytics.js`

Mounted at `/google-analytics`, all endpoints behind
`authenticate` + `requireRole('corporate')`.

| Endpoint                          | Purpose |
|-----------------------------------|---------|
| `GET /status`                     | `{ authorized, scope_missing, has_property_id }` |
| `GET /overview`                   | sessions, users, new_users, engagement_rate, avg_session_duration + per-day time series |
| `GET /sources`                    | top channels + top sources |
| `GET /pages`                      | top pages |
| `GET /devices-geo`                | device category breakdown + top 5 cities |
| `GET /key-events`                 | configured key events (or `[]`) |

Query params: `start_date`, `end_date`, `location_slug`, `compare` (bool).
When `compare=true`, response shape is `{ current: {...}, previous: {...} }`.

Implementation: GA4 Data API
`POST https://analyticsdata.googleapis.com/v1beta/properties/{PROPERTY_ID}:runReport`
with `dateRanges`, `metrics`, `dimensions`, `dimensionFilter`. Same in-memory
10-min cache pattern as GBP.

### Register route in `auth/src/index.js`

One line: `app.use('/google-analytics', require('./routes/googleAnalytics'))`.

## Frontend

### New file: `portal/src/components/GoogleMarketingView.jsx`

Combined view. Inline its date+location filter bar (no premature abstraction).
Section 1 reuses the existing GBP performance table layout from
`GoogleBusinessView`. Section 2 is new.

Renders:
- `<ConnectBanner>` if `/google-business/status` or `/google-analytics/status`
  shows missing auth or missing scope. One button: "Connect Google" → opens
  `/google-business/authorize`.
- `<DeltaChip value=12 trend="up" />` helper for comparison chips (green up
  for sessions/users/engagement, red up for bounce-style metrics — keeping it
  simple: green = increase good, red = decrease).

### `portal/src/components/MarketingView.jsx`

Change `'google'` branch from `<GoogleBusinessView>` to `<GoogleMarketingView>`.

### `portal/src/lib/api.js`

Add wrappers: `getGoogleAnalyticsStatus`, `getGoogleAnalyticsOverview`,
`getGoogleAnalyticsSources`, `getGoogleAnalyticsPages`,
`getGoogleAnalyticsDevicesGeo`, `getGoogleAnalyticsKeyEvents`. Each accepts
the same param shape: `{ start_date, end_date, location_slug, compare }`.

### Standalone `GoogleBusinessView`

Stays for now — not deleted. The Marketing tile no longer points to it, but
nothing else breaks. Can be retired in a later cleanup.

## Configuration / deployment

- Render env var `GA4_PROPERTY_ID` set on the auth-api service.
- After deploy, click **Reconnect Google** once in the portal to upgrade the
  OAuth scope.

## Error handling

| Condition                               | Behavior |
|-----------------------------------------|----------|
| No Google tokens                        | Connect banner; both sections empty |
| Tokens but missing analytics scope      | Reconnect banner; GBP section works, GA4 section disabled |
| Property ID not configured              | GA4 section shows config notice; GBP works |
| GA4 API error on a specific endpoint    | That panel shows inline error; other panels render |
| Empty data for date range               | Each panel shows its own "no data" placeholder |

## Out of scope

- Creating GA4 events (done in GTM / GA4 admin)
- Marking events as key events (done in GA4 admin)
- CSV export (future)
- Cross-property aggregation (we have one property)

## Files touched

- `auth/src/routes/googleBusiness.js` (scope expansion + export)
- `auth/src/routes/googleAnalytics.js` (new)
- `auth/src/index.js` (register route)
- `portal/src/components/GoogleMarketingView.jsx` (new)
- `portal/src/components/MarketingView.jsx` (swap branch)
- `portal/src/lib/api.js` (new wrappers)

Avoid touching these files in parallel sessions to prevent merge conflicts.
