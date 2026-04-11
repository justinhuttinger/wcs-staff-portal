# Gamification Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a point-based leaderboard that ranks staff monthly by memberships, day ones, VIPs, and same-day sales — with a personal score card on the home screen.

**Architecture:** New API endpoint (`/reports/leaderboard`) aggregates points from existing `ghl_contacts_report` view. No new DB tables. Desktop gets a score card in ToolGrid + LeaderboardView component. Mobile gets a score card in HomeScreen + MobileLeaderboard component.

**Tech Stack:** Node/Express (auth API), React (portal), Supabase (data), Tailwind CSS (styling)

**Spec:** `docs/superpowers/specs/2026-04-11-gamification-leaderboard-design.md`

---

## File Structure

**Auth API (backend):**
- Create: `auth/src/routes/leaderboard.js` — leaderboard endpoint with point aggregation + caching

**Portal (desktop frontend):**
- Create: `portal/src/components/LeaderboardView.jsx` — full leaderboard view with month navigation
- Modify: `portal/src/components/ToolGrid.jsx` — add score card above tiles + leaderboard tile
- Modify: `portal/src/App.jsx` — add leaderboard view routing + state
- Modify: `portal/src/lib/api.js` — add `getLeaderboard()` function

**Portal (mobile frontend):**
- Create: `portal/src/mobile/components/MobileLeaderboard.jsx` — mobile leaderboard view
- Modify: `portal/src/mobile/components/HomeScreen.jsx` — add score card + leaderboard tile
- Modify: `portal/src/mobile/MobileApp.jsx` — add leaderboard route

---

### Task 1: API Endpoint — Leaderboard

**Files:**
- Create: `auth/src/routes/leaderboard.js`
- Modify: `auth/src/index.js` (add route mount)

- [ ] **Step 1: Create the leaderboard route file**

Create `auth/src/routes/leaderboard.js`:

```javascript
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, ROLE_HIERARCHY } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('front_desk'))

// Point values (hardcoded)
const POINTS = {
  day_one_booked: 10,
  membership: 5,
  same_day_sale: 5,
  vip: 2,
}

// Cache: key -> { data, cachedAt }
const cache = {}
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Pacific timezone offset for custom field date alignment
const PACIFIC_OFFSET_MS = 7 * 3600000

function monthToRange(monthStr) {
  // monthStr = "YYYY-MM"
  const [year, month] = monthStr.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
  return {
    startMs: (start.getTime() + PACIFIC_OFFSET_MS).toString(),
    endMs: (end.getTime() + PACIFIC_OFFSET_MS).toString(),
    startISO: new Date(start.getTime() + PACIFIC_OFFSET_MS).toISOString(),
    endISO: new Date(end.getTime() + PACIFIC_OFFSET_MS).toISOString(),
  }
}

function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

router.get('/', async (req, res) => {
  const month = req.query.month || getCurrentMonth()
  const locationSlug = req.query.location_slug
  const userEmail = req.staff.email?.toLowerCase()
  const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
  const isManager = userLevel >= ROLE_HIERARCHY.indexOf('manager')

  // Validate month format
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' })
  }

  try {
    // Cross-location view for managers
    if ((!locationSlug || locationSlug === 'all') && isManager) {
      const cacheKey = `all-${month}`
      const cached = cache[cacheKey]
      if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL) {
        return res.json(cached.data)
      }

      const { startMs, endMs, startISO, endISO } = monthToRange(month)

      // Get all locations
      const { data: locations } = await supabaseAdmin
        .from('ghl_locations').select('id, name, slug')
      if (!locations) return res.json({ month, locations: [] })

      const locationResults = []

      for (const loc of locations) {
        const stats = await aggregateLocationStats(loc.slug, startMs, endMs, startISO, endISO, loc.id)
        const ranked = rankStaff(stats)
        const topPerformer = ranked[0]

        locationResults.push({
          location: loc.name,
          location_slug: loc.slug,
          total_points: ranked.reduce((sum, r) => sum + r.points, 0),
          top_performer: topPerformer?.name || 'None',
          top_performer_points: topPerformer?.points || 0,
          staff_count: ranked.length,
        })
      }

      locationResults.sort((a, b) => b.total_points - a.total_points)
      locationResults.forEach((l, i) => { l.rank = i + 1 })

      const result = { month, locations: locationResults }
      cache[cacheKey] = { data: result, cachedAt: Date.now() }
      return res.json(result)
    }

    // Single location view
    const slug = locationSlug || req.staff.locations?.find(l => l.is_primary)?.name?.toLowerCase() || 'salem'
    const cacheKey = `${slug}-${month}`
    const cached = cache[cacheKey]
    if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL) {
      const data = { ...cached.data }
      // Add user-specific fields
      const userRanking = data.rankings.find(r =>
        r.name.toLowerCase() === req.staff.display_name?.toLowerCase() ||
        r.name.toLowerCase() === `${req.staff.first_name} ${req.staff.last_name}`.toLowerCase()
      )
      data.user_rank = userRanking ? data.rankings.indexOf(userRanking) + 1 : null
      data.user_points = userRanking?.points || 0
      return res.json(data)
    }

    const { startMs, endMs, startISO, endISO } = monthToRange(month)

    // Resolve location ID for VIP query
    let locationId = null
    const { data: loc } = await supabaseAdmin
      .from('ghl_locations').select('id')
      .ilike('name', '%' + slug + '%').limit(1).maybeSingle()
    if (loc) locationId = loc.id

    const stats = await aggregateLocationStats(slug, startMs, endMs, startISO, endISO, locationId)
    const rankings = rankStaff(stats)

    // Find current user in rankings
    const staffName = req.staff.display_name || `${req.staff.first_name || ''} ${req.staff.last_name || ''}`.trim()
    const userRanking = rankings.find(r =>
      r.name.toLowerCase() === staffName.toLowerCase()
    )

    const result = {
      month,
      location: slug,
      rankings,
      user_rank: userRanking ? rankings.indexOf(userRanking) + 1 : null,
      user_points: userRanking?.points || 0,
    }

    cache[cacheKey] = { data: result, cachedAt: Date.now() }
    res.json(result)
  } catch (err) {
    console.error('[Leaderboard] Error:', err.message)
    res.status(500).json({ error: 'Failed to fetch leaderboard: ' + err.message })
  }
})

async function aggregateLocationStats(slug, startMs, endMs, startISO, endISO, locationId) {
  const stats = {} // name -> { memberships, day_ones, same_day, vips }

  function ensure(name) {
    if (!name || name === 'Unassigned' || name === '') return null
    if (!stats[name]) stats[name] = { memberships: 0, day_ones: 0, same_day: 0, vips: 0 }
    return stats[name]
  }

  // 1. Memberships + Same Day Sales (by sale_team_member, filtered by member_sign_date)
  let memberQ = supabaseAdmin
    .from('ghl_contacts_report')
    .select('sale_team_member, same_day_sale')
    .not('member_sign_date', 'is', null)
    .eq('location_slug', slug)
    .gte('member_sign_date', startMs)
    .lte('member_sign_date', endMs)

  const { data: members } = await memberQ
  for (const c of (members || [])) {
    const s = ensure(c.sale_team_member)
    if (!s) continue
    s.memberships++
    if (c.same_day_sale === 'Sale') s.same_day++
  }

  // 2. Day Ones Booked (by day_one_booking_team_member, filtered by day_one_booking_date)
  let dayOneQ = supabaseAdmin
    .from('ghl_contacts_report')
    .select('day_one_booking_team_member')
    .eq('day_one_booked', 'Yes')
    .not('day_one_booking_date', 'is', null)
    .eq('location_slug', slug)
    .gte('day_one_booking_date', startMs)
    .lte('day_one_booking_date', endMs)

  const { data: dayOnes } = await dayOneQ
  for (const c of (dayOnes || [])) {
    const s = ensure(c.day_one_booking_team_member)
    if (!s) continue
    s.day_ones++
  }

  // 3. VIPs (contacts with "vip" tag created in month, attributed to sale_team_member)
  if (locationId) {
    // Join via report view to get sale_team_member + tags from base table
    let vipQ = supabaseAdmin
      .from('ghl_contacts_v2')
      .select('id, tags')
      .contains('tags', ['vip'])
      .eq('location_id', locationId)
      .gte('created_at_ghl', startISO)
      .lte('created_at_ghl', endISO)

    const { data: vipContacts } = await vipQ
    if (vipContacts && vipContacts.length > 0) {
      // Get sale_team_member from report view for these contacts
      const vipIds = vipContacts.map(c => c.id)
      const { data: vipReport } = await supabaseAdmin
        .from('ghl_contacts_report')
        .select('id, sale_team_member')
        .in('id', vipIds)

      for (const c of (vipReport || [])) {
        const s = ensure(c.sale_team_member)
        if (!s) continue
        s.vips++
      }
    }
  }

  return stats
}

function rankStaff(stats) {
  const rankings = Object.entries(stats).map(([name, s]) => {
    const points =
      s.day_ones * POINTS.day_one_booked +
      s.memberships * POINTS.membership +
      s.same_day * POINTS.same_day_sale +
      s.vips * POINTS.vip
    return {
      name,
      points,
      memberships: s.memberships,
      day_ones: s.day_ones,
      same_day: s.same_day,
      vips: s.vips,
    }
  })

  rankings.sort((a, b) => b.points - a.points)
  rankings.forEach((r, i) => { r.rank = i + 1 })
  return rankings
}

module.exports = router
```

- [ ] **Step 2: Mount the route in index.js**

Add this line in `auth/src/index.js` alongside the other route mounts (near line 45):

```javascript
app.use('/reports/leaderboard', require('./routes/leaderboard'))
```

- [ ] **Step 3: Verify the server starts without errors**

Run: `cd auth && node src/index.js`
Expected: Server starts, no import errors. Kill the process after verifying.

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/leaderboard.js auth/src/index.js
git commit -m "feat: add leaderboard API endpoint with point aggregation"
```

---

### Task 2: Frontend API Function

**Files:**
- Modify: `portal/src/lib/api.js`

- [ ] **Step 1: Add getLeaderboard function**

Add to `portal/src/lib/api.js` alongside the other export functions:

```javascript
export async function getLeaderboard(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/leaderboard' + (qs ? '?' + qs : ''))
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat: add getLeaderboard API function"
```

---

### Task 3: Desktop Score Card in ToolGrid

**Files:**
- Modify: `portal/src/components/ToolGrid.jsx`

- [ ] **Step 1: Add leaderboard imports and score card state**

At the top of `ToolGrid.jsx`, add `getLeaderboard` to the import from `../lib/api`:

```javascript
import { getTiles, getDayOneTrackerAppointments, getTours, getLeaderboard } from '../lib/api'
```

Add a trophy icon to `TILE_ICONS`:

```javascript
  leaderboard: 'M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-4.5A3.375 3.375 0 0 0 13.125 10.875h-2.25A3.375 3.375 0 0 0 7.5 14.25v4.5m6-15V3.375c0-.621-.504-1.125-1.125-1.125h-.75a1.125 1.125 0 0 0-1.125 1.125V3.75m3 0h-3',
```

- [ ] **Step 2: Add score card state and data fetching**

Inside the `ToolGrid` component, add state after the existing badge states (around line 49):

```javascript
  const [leaderboardData, setLeaderboardData] = useState(null)
```

Add a useEffect to fetch leaderboard data (after existing badge useEffects):

```javascript
  useEffect(() => {
    if (!locationSlug) return
    getLeaderboard({ location_slug: locationSlug })
      .then(data => setLeaderboardData(data))
      .catch(() => {})
  }, [locationSlug])
```

Note: you'll need to compute `locationSlug`. Add this line after the existing props destructuring, near where `location` is used:

```javascript
  const locationSlug = (location || 'salem').toLowerCase()
```

- [ ] **Step 3: Add the score card component above the tile grid**

Find the main container div in ToolGrid's return (the `<div className="w-full px-8 max-w-3xl mx-auto">` or similar). Insert this score card section BEFORE the two-column grid:

```jsx
      {/* Score Card */}
      {leaderboardData && leaderboardData.user_rank && (
        <div className="w-full max-w-3xl mx-auto px-8 mb-6">
          <div className="bg-surface border border-border rounded-xl p-5 flex items-center gap-6">
            <div className="flex-1 min-w-0">
              <p className="text-lg font-bold text-text-primary">
                {leaderboardData.user_points} <span className="text-sm font-medium text-text-muted">pts</span>
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                {ordinal(leaderboardData.user_rank)} of {leaderboardData.rankings.length} at {(location || '').charAt(0).toUpperCase() + (location || '').slice(1)}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
              <span>Day One <strong className="text-text-primary">10</strong></span>
              <span>Membership <strong className="text-text-primary">5</strong></span>
              <span>Same Day <strong className="text-text-primary">5</strong></span>
              <span>VIP <strong className="text-text-primary">2</strong></span>
            </div>
          </div>
        </div>
      )}
```

Also add the `ordinal` helper function inside the component (or above it):

```javascript
function ordinal(n) {
  if (!n) return ''
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
```

- [ ] **Step 4: Add leaderboard tile to the Tools section**

In the Tools column of ToolGrid, add the leaderboard tile alongside the other `SvgTileButton` entries (near Day One, Tours, etc.):

```jsx
{onLeaderboard && (
  <SvgTileButton
    onClick={onLeaderboard}
    iconPath={TILE_ICONS.leaderboard}
    label="Leaderboard"
    desc="Rankings"
    badge={leaderboardData?.user_rank || 0}
  />
)}
```

Add `onLeaderboard` to the component's props:

```javascript
export default function ToolGrid({ abcUrl, location, visibleTools, locationId, onTours, onDayOneTracker, onDayOneCalendar, onTrainerAvail, onMetaAds, onLeaderboard }) {
```

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/ToolGrid.jsx
git commit -m "feat: add score card and leaderboard tile to desktop home"
```

---

### Task 4: Desktop LeaderboardView Component

**Files:**
- Create: `portal/src/components/LeaderboardView.jsx`

- [ ] **Step 1: Create the leaderboard view**

Create `portal/src/components/LeaderboardView.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { getLeaderboard } from '../lib/api'

function ordinal(n) {
  if (!n) return ''
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function formatMonth(monthStr) {
  const [year, month] = monthStr.split('-')
  return new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function navigateMonth(monthStr, offset) {
  const [year, month] = monthStr.split('-').map(Number)
  const d = new Date(year, month - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const RANK_COLORS = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
}

const POINT_LEGEND = [
  { label: 'Day One Booked', pts: 10 },
  { label: 'Membership', pts: 5 },
  { label: 'Same Day Sale', pts: 5 },
  { label: 'VIP', pts: 2 },
]

export default function LeaderboardView({ user, onBack, location }) {
  const [month, setMonth] = useState(getCurrentMonth())
  const [data, setData] = useState(null)
  const [locationData, setLocationData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('club') // 'club' or 'locations'

  const userLevel = ['front_desk', 'personal_trainer', 'lead', 'manager', 'director', 'admin']
  const isManager = userLevel.indexOf(user?.staff?.role) >= userLevel.indexOf('manager')
  const locationSlug = (location || 'salem').toLowerCase()

  useEffect(() => { loadData() }, [month, view])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      if (view === 'locations' && isManager) {
        const res = await getLeaderboard({ month, location_slug: 'all' })
        setLocationData(res)
      } else {
        const res = await getLeaderboard({ month, location_slug: locationSlug })
        setData(res)
      }
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const canGoForward = month < getCurrentMonth()

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-primary">Leaderboard</h2>
          {isManager && (
            <div className="flex gap-1 bg-bg rounded-lg p-1">
              <button
                onClick={() => setView('club')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === 'club' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
                }`}
              >My Club</button>
              <button
                onClick={() => setView('locations')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === 'locations' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
                }`}
              >All Locations</button>
            </div>
          )}
        </div>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-6 bg-surface border border-border rounded-xl px-4 py-3">
        <button onClick={() => setMonth(navigateMonth(month, -1))} className="text-text-muted hover:text-text-primary transition-colors p-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <p className="text-sm font-semibold text-text-primary">{formatMonth(month)}</p>
        <div className="flex items-center gap-2">
          {month !== getCurrentMonth() && (
            <button
              onClick={() => setMonth(getCurrentMonth())}
              className="px-3 py-1 text-xs font-medium rounded-lg border border-wcs-red text-wcs-red hover:bg-wcs-red hover:text-white transition-colors"
            >
              This Month
            </button>
          )}
          <button
            onClick={() => canGoForward && setMonth(navigateMonth(month, 1))}
            className={`p-1 transition-colors ${canGoForward ? 'text-text-muted hover:text-text-primary' : 'text-border cursor-not-allowed'}`}
            disabled={!canGoForward}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Point Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-6 text-xs text-text-muted">
        {POINT_LEGEND.map(p => (
          <span key={p.label}>{p.label}: <strong className="text-text-primary">{p.pts} pts</strong></span>
        ))}
      </div>

      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}
      {loading && <p className="text-text-muted text-sm py-8 text-center">Loading leaderboard...</p>}

      {/* Club Leaderboard */}
      {!loading && view === 'club' && data && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg">
                <th className="text-center px-3 py-3 text-xs font-semibold text-text-muted uppercase w-12">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Name</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-text-muted uppercase">Points</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-text-muted uppercase">Sales</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-text-muted uppercase">Day Ones</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-text-muted uppercase">Same Day</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-text-muted uppercase">VIPs</th>
              </tr>
            </thead>
            <tbody>
              {(data.rankings || []).map(r => {
                const isUser = r.rank === data.user_rank
                const medalColor = RANK_COLORS[r.rank]
                return (
                  <tr key={r.name} className={`border-b border-border transition-colors ${isUser ? 'bg-wcs-red/5' : 'hover:bg-bg/50'}`}>
                    <td className="px-3 py-3 text-center">
                      {medalColor ? (
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white" style={{ backgroundColor: medalColor }}>
                          {r.rank}
                        </span>
                      ) : (
                        <span className="text-text-muted font-medium">{r.rank}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-text-primary">{r.name}</td>
                    <td className="px-3 py-3 text-center font-bold text-wcs-red">{r.points}</td>
                    <td className="px-3 py-3 text-center text-text-muted">{r.memberships}</td>
                    <td className="px-3 py-3 text-center text-text-muted">{r.day_ones}</td>
                    <td className="px-3 py-3 text-center text-text-muted">{r.same_day}</td>
                    <td className="px-3 py-3 text-center text-text-muted">{r.vips}</td>
                  </tr>
                )
              })}
              {(!data.rankings || data.rankings.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted text-sm">No activity yet this month</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Cross-Location View */}
      {!loading && view === 'locations' && locationData && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg">
                <th className="text-center px-3 py-3 text-xs font-semibold text-text-muted uppercase w-12">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Location</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-text-muted uppercase">Total Points</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Top Performer</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-text-muted uppercase">Staff</th>
              </tr>
            </thead>
            <tbody>
              {(locationData.locations || []).map(l => {
                const medalColor = RANK_COLORS[l.rank]
                return (
                  <tr key={l.location_slug} className="border-b border-border hover:bg-bg/50 transition-colors">
                    <td className="px-3 py-3 text-center">
                      {medalColor ? (
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white" style={{ backgroundColor: medalColor }}>
                          {l.rank}
                        </span>
                      ) : (
                        <span className="text-text-muted font-medium">{l.rank}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-text-primary">{l.location}</td>
                    <td className="px-3 py-3 text-center font-bold text-wcs-red">{l.total_points}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {l.top_performer} <span className="text-xs">({l.top_performer_points} pts)</span>
                    </td>
                    <td className="px-3 py-3 text-center text-text-muted">{l.staff_count}</td>
                  </tr>
                )
              })}
              {(!locationData.locations || locationData.locations.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">No activity yet this month</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/LeaderboardView.jsx
git commit -m "feat: add desktop LeaderboardView component"
```

---

### Task 5: Wire Up Desktop Leaderboard in App.jsx

**Files:**
- Modify: `portal/src/App.jsx`

- [ ] **Step 1: Add import, state, and view routing**

Add import at top of App.jsx:

```javascript
import LeaderboardView from './components/LeaderboardView'
```

Add state alongside the other `show*` states (around line 33):

```javascript
const [showLeaderboard, setShowLeaderboard] = useState(false)
```

Add to the sign-out handler `handleLogout` (line ~124) and the Electron `onSignOut` handler (line ~70):

```javascript
setShowLeaderboard(false)
```

Add leaderboard view in the conditional rendering chain (around line 196, before the `showReporting` check):

```jsx
) : showLeaderboard ? (
  <LeaderboardView user={user} onBack={() => setShowLeaderboard(false)} location={location} />
```

Pass `onLeaderboard` to `ToolGrid` (line 199):

```jsx
<ToolGrid ... onLeaderboard={() => setShowLeaderboard(true)} />
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/App.jsx
git commit -m "feat: wire desktop leaderboard view into App routing"
```

---

### Task 6: Mobile Leaderboard Component

**Files:**
- Create: `portal/src/mobile/components/MobileLeaderboard.jsx`

- [ ] **Step 1: Create the mobile leaderboard view**

Create `portal/src/mobile/components/MobileLeaderboard.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { getLeaderboard } from '../../lib/api'

function ordinal(n) {
  if (!n) return ''
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function formatMonth(monthStr) {
  const [year, month] = monthStr.split('-')
  return new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function navigateMonth(monthStr, offset) {
  const [year, month] = monthStr.split('-').map(Number)
  const d = new Date(year, month - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const RANK_COLORS = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
}

export default function MobileLeaderboard({ user }) {
  const [month, setMonth] = useState(getCurrentMonth())
  const [data, setData] = useState(null)
  const [locationData, setLocationData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('club')

  const roles = ['front_desk', 'personal_trainer', 'lead', 'manager', 'director', 'admin']
  const isManager = roles.indexOf(user?.staff?.role) >= roles.indexOf('manager')
  const userLocations = user?.staff?.locations || []
  const locationSlug = (userLocations.find(l => l.is_primary)?.name || userLocations[0]?.name || 'Salem').toLowerCase()

  useEffect(() => { loadData() }, [month, view])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      if (view === 'locations' && isManager) {
        const res = await getLeaderboard({ month, location_slug: 'all' })
        setLocationData(res)
      } else {
        const res = await getLeaderboard({ month, location_slug: locationSlug })
        setData(res)
      }
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const canGoForward = month < getCurrentMonth()

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="bg-surface border-b border-border px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-text-primary">Leaderboard</h2>
          {isManager && (
            <div className="flex bg-bg rounded-lg p-0.5">
              <button
                onClick={() => setView('club')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === 'club' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted'
                }`}
              >My Club</button>
              <button
                onClick={() => setView('locations')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === 'locations' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted'
                }`}
              >All Locations</button>
            </div>
          )}
        </div>

        {/* Month Navigation */}
        <div className="flex items-center justify-between">
          <button onClick={() => setMonth(navigateMonth(month, -1))} className="p-2 text-text-muted active:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <p className="text-sm font-semibold text-text-primary">{formatMonth(month)}</p>
          <div className="flex items-center gap-1">
            {month !== getCurrentMonth() && (
              <button
                onClick={() => setMonth(getCurrentMonth())}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-wcs-red text-wcs-red active:bg-wcs-red active:text-white transition-colors"
              >
                This Month
              </button>
            )}
            <button
              onClick={() => canGoForward && setMonth(navigateMonth(month, 1))}
              className={`p-2 ${canGoForward ? 'text-text-muted active:text-text-primary' : 'text-border'}`}
              disabled={!canGoForward}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {error && <p className="text-sm text-wcs-red mb-3">{error}</p>}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-wcs-red border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Point Legend */}
        {!loading && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 text-[11px] text-text-muted">
            <span>Day One <strong className="text-text-primary">10</strong></span>
            <span>Membership <strong className="text-text-primary">5</strong></span>
            <span>Same Day <strong className="text-text-primary">5</strong></span>
            <span>VIP <strong className="text-text-primary">2</strong></span>
          </div>
        )}

        {/* Club Rankings */}
        {!loading && view === 'club' && data && (
          <div className="space-y-2">
            {(data.rankings || []).length === 0 && (
              <p className="text-text-muted text-sm py-12 text-center">No activity yet this month</p>
            )}
            {(data.rankings || []).map(r => {
              const isUser = r.rank === data.user_rank
              const medalColor = RANK_COLORS[r.rank]
              return (
                <div key={r.name} className={`bg-surface rounded-2xl border p-4 flex items-center gap-3 ${isUser ? 'border-wcs-red' : 'border-border'}`}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                    style={medalColor ? { backgroundColor: medalColor, color: '#fff' } : { backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
                  >
                    {r.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{r.name}</p>
                    <div className="flex gap-2 text-[11px] text-text-muted mt-0.5">
                      <span>{r.memberships} sales</span>
                      <span>{r.day_ones} D1</span>
                      <span>{r.same_day} SD</span>
                      <span>{r.vips} VIP</span>
                    </div>
                  </div>
                  <p className="text-lg font-bold text-wcs-red shrink-0">{r.points}</p>
                </div>
              )
            })}
          </div>
        )}

        {/* Cross-Location Rankings */}
        {!loading && view === 'locations' && locationData && (
          <div className="space-y-2">
            {(locationData.locations || []).length === 0 && (
              <p className="text-text-muted text-sm py-12 text-center">No activity yet this month</p>
            )}
            {(locationData.locations || []).map(l => {
              const medalColor = RANK_COLORS[l.rank]
              return (
                <div key={l.location_slug} className="bg-surface rounded-2xl border border-border p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                    style={medalColor ? { backgroundColor: medalColor, color: '#fff' } : { backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
                  >
                    {l.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{l.location}</p>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      MVP: {l.top_performer} ({l.top_performer_points} pts) — {l.staff_count} staff
                    </p>
                  </div>
                  <p className="text-lg font-bold text-wcs-red shrink-0">{l.total_points}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/mobile/components/MobileLeaderboard.jsx
git commit -m "feat: add mobile leaderboard component"
```

---

### Task 7: Mobile Home Screen Score Card + Routing

**Files:**
- Modify: `portal/src/mobile/components/HomeScreen.jsx`
- Modify: `portal/src/mobile/MobileApp.jsx`

- [ ] **Step 1: Add score card to mobile HomeScreen**

In `portal/src/mobile/components/HomeScreen.jsx`, add the import at the top:

```javascript
import { useState, useEffect } from 'react'
import { getLeaderboard } from '../../lib/api'
```

Change the component to use hooks and add score card:

Replace the existing `export default function HomeScreen` with a version that includes state + useEffect for leaderboard data, and add a score card section between the user info and tile grid.

Add a trophy icon component:

```jsx
function TrophyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.504-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-2.52.952m0 0a6.003 6.003 0 01-2.52-.952" />
    </svg>
  )
}
```

Add `{ label: 'Leaderboard', icon: <TrophyIcon />, route: 'leaderboard' }` to the `tiles` array.

Add the score card between the user info `<div className="mb-6">` and the tile grid `<div className="grid grid-cols-2 gap-4">`:

```jsx
      {/* Score Card */}
      {lbData && lbData.user_rank && (
        <div className="mb-4 bg-surface border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-text-primary">
                {lbData.user_points} <span className="text-sm font-medium text-text-muted">pts</span>
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                {ordinal(lbData.user_rank)} of {lbData.rankings.length}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-text-muted">
            <span>Day One <strong className="text-text-primary">10</strong></span>
            <span>Membership <strong className="text-text-primary">5</strong></span>
            <span>Same Day <strong className="text-text-primary">5</strong></span>
            <span>VIP <strong className="text-text-primary">2</strong></span>
          </div>
        </div>
      )}
```

Add the `ordinal` helper and state/effect:

```javascript
function ordinal(n) {
  if (!n) return ''
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
```

Inside the component:
```javascript
  const [lbData, setLbData] = useState(null)
  const locationSlug = (primaryLocation || 'salem').toLowerCase()

  useEffect(() => {
    getLeaderboard({ location_slug: locationSlug })
      .then(data => setLbData(data))
      .catch(() => {})
  }, [locationSlug])
```

- [ ] **Step 2: Add leaderboard route to MobileApp.jsx**

Add import at top of `MobileApp.jsx`:

```javascript
import MobileLeaderboard from './components/MobileLeaderboard'
```

Add case in `renderView()` switch (before the `default` case):

```javascript
      case 'leaderboard':
        return <MobileLeaderboard user={user} />
```

- [ ] **Step 3: Verify build succeeds**

Run: `cd portal && npx vite build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add portal/src/mobile/components/HomeScreen.jsx portal/src/mobile/MobileApp.jsx
git commit -m "feat: add mobile score card and leaderboard routing"
```

---

### Task 8: Final Build & Deploy

- [ ] **Step 1: Full build verification**

Run: `cd portal && npx vite build`
Expected: Clean build, no errors.

- [ ] **Step 2: Commit any remaining changes and push**

```bash
git push origin master
```

Expected: Render auto-deploys both auth API and portal.

- [ ] **Step 3: Verify on deployed site**

1. Open portal — score card should appear above tiles on both desktop and mobile
2. Click Leaderboard tile — should show staff rankings for current month
3. Navigate to previous months — data should update
4. If manager role — "All Locations" tab should show cross-location rankings
