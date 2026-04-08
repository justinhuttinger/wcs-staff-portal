# Reporting Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign reporting to open in its own Electron tab with tile-based navigation, fix trial conversion accuracy, add Club Health dashboard with pie charts, update salesperson stats and PT report layouts, and fix identified bugs.

**Architecture:** Hash-based routing added to the portal so `#reporting` renders the reporting view independently. Electron's tab system opens reporting in a new BrowserView. Backend endpoints fixed for accurate filtering and a new `/reports/club-health` endpoint added. Frontend gets tile grid navigation, Club Health pie charts (pure SVG), and updated table layouts.

**Tech Stack:** React 19, Vite 8, Tailwind 4, Node/Express, Supabase JS client, Electron 33

---

## Task 1: Bug Fixes — Backend Hardening

**Files:**
- Modify: `auth/src/routes/reports.js:38-42` (date validation)
- Modify: `auth/src/routes/syncStatus.js:22-45` (error handling)
- Modify: `portal/src/lib/api.js:17-31` (JSON parse guard)
- Modify: `portal/src/lib/export.js:30-32` (PDF title)

- [ ] **Step 1: Add date validation to `reports.js`**

In `auth/src/routes/reports.js`, replace the `dateToMs` function (lines 38-42):

```javascript
function dateToMs(dateStr, endOfDay = false) {
  if (!dateStr) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const d = endOfDay ? new Date(dateStr + 'T23:59:59.999Z') : new Date(dateStr + 'T00:00:00.000Z')
  if (isNaN(d.getTime())) return null
  return d.getTime().toString()
}
```

- [ ] **Step 2: Add error handling to `syncStatus.js`**

In `auth/src/routes/syncStatus.js`, replace lines 22-45 with error-safe versions:

```javascript
    // Last sync logs
    const { data: recentLogs, error: logsError } = await supabaseAdmin
      .from('ghl_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(10)
    if (logsError) log && console.error('Sync logs query failed:', logsError.message)

    // Last successful sync per type
    const { data: lastFull, error: fullError } = await supabaseAdmin
      .from('ghl_sync_log')
      .select('completed_at, duration_ms')
      .eq('sync_type', 'full')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .single()
    if (fullError && fullError.code !== 'PGRST116') console.error('Last full sync query failed:', fullError.message)

    const { data: lastDelta, error: deltaError } = await supabaseAdmin
      .from('ghl_sync_log')
      .select('completed_at, duration_ms')
      .eq('sync_type', 'delta')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .single()
    if (deltaError && deltaError.code !== 'PGRST116') console.error('Last delta sync query failed:', deltaError.message)
```

Note: `PGRST116` is Supabase's "no rows found" error for `.single()` — that's expected, not an error.

- [ ] **Step 3: Guard JSON parse in `api.js`**

In `portal/src/lib/api.js`, replace the `api` function (lines 17-31):

```javascript
export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (authToken) {
    headers['Authorization'] = 'Bearer ' + authToken
  }

  const res = await fetch(API_URL + path, { ...options, headers })
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error('Server error — please try again')
  }

  if (!res.ok) {
    throw new Error(data.error || 'Request failed')
  }

  return data
}
```

- [ ] **Step 4: Improve PDF export with title**

In `portal/src/lib/export.js`, replace the `exportPDF` function (lines 30-32):

```javascript
export function exportPDF(reportName) {
  const prev = document.title
  if (reportName) document.title = reportName
  window.print()
  document.title = prev
}
```

- [ ] **Step 5: Commit**

```bash
git add auth/src/routes/reports.js auth/src/routes/syncStatus.js portal/src/lib/api.js portal/src/lib/export.js
git commit -m "fix: add date validation, error handling, JSON guard, and PDF title"
```

---

## Task 2: Fix Trial Conversion + Remove Pipeline Endpoint

**Files:**
- Modify: `auth/src/routes/reports.js:166-191` (membership trial fix)
- Modify: `auth/src/routes/reports.js:350-396` (remove pipeline endpoint)

- [ ] **Step 1: Fix the membership endpoint's trial conversion query**

In `auth/src/routes/reports.js`, replace lines 166-191 (the trial conversion section inside the `/membership` handler) with:

```javascript
    // --- Trial conversion from opportunities ---
    // Resolve location_slug to ghl_location_id for opportunities table
    let oppLocationId = null
    if (locationFilter) {
      if (locationFilter.column === 'location_id') {
        oppLocationId = locationFilter.value
      } else if (locationFilter.column === 'location_slug') {
        const { data: loc } = await supabaseAdmin
          .from('ghl_locations')
          .select('id')
          .ilike('name', locationFilter.value)
          .single()
        if (loc) oppLocationId = loc.id
      }
    }

    let oppQuery = supabaseAdmin
      .from('ghl_opportunities_v2')
      .select('id, status, stage_id, pipeline_id, ghl_pipeline_stages(name)')

    if (oppLocationId) oppQuery = oppQuery.eq('location_id', oppLocationId)
    oppQuery = applyDateRange(oppQuery, 'created_at_ghl', startMs, endMs)

    const { data: opps, error: oppsError } = await oppQuery
    if (oppsError) return res.status(500).json({ error: 'Failed to fetch trial data', detail: oppsError.message })

    const opportunities = opps || []

    let trialStarted = 0
    let trialWon = 0
    for (const opp of opportunities) {
      const stageName = opp.ghl_pipeline_stages?.name || ''
      if (stageName === 'Trial Started') {
        trialStarted++
        if (opp.status === 'won') trialWon++
      }
    }
```

- [ ] **Step 2: Remove the pipeline endpoint**

Delete the entire `/reports/pipelines` route from `auth/src/routes/reports.js` — remove lines 350-396 (the comment block, `router.get('/pipelines', ...)` and its handler).

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/reports.js
git commit -m "fix: trial conversion filters by location+date, remove pipeline endpoint"
```

---

## Task 3: Update Salesperson Stats — Backend + Frontend

**Files:**
- Modify: `auth/src/routes/reports.js:109-122` (salesperson aggregation)
- Modify: `portal/src/components/reports/SalespersonStats.jsx` (full rewrite of columns)

- [ ] **Step 1: Update backend aggregation**

In `auth/src/routes/reports.js`, replace the salesperson aggregation loop (lines 109-122):

```javascript
    const bySalesperson = {}
    for (const c of contacts) {
      const sp = c.sale_team_member || 'Unassigned'
      if (!bySalesperson[sp]) {
        bySalesperson[sp] = { total_sales: 0, vips: 0, day_one_booked: 0, same_day_sale: 0 }
      }
      bySalesperson[sp].total_sales++
      bySalesperson[sp].vips += (parseInt(c.vip_count, 10) || 0)
      if (c.day_one_booked === 'Yes') bySalesperson[sp].day_one_booked++
      if (c.same_day_sale === 'Yes') bySalesperson[sp].same_day_sale++
    }
```

- [ ] **Step 2: Update the SalespersonStats frontend component**

Replace the entire contents of `portal/src/components/reports/SalespersonStats.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { getSalespersonStats } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'

export default function SalespersonStats({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortBy, setSortBy] = useState('best')
  const [search, setSearch] = useState('')

  useEffect(() => { loadData() }, [startDate, endDate, locationSlug])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      const res = await getSalespersonStats(params)
      setData(res)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading salesperson data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  const SORT_OPTIONS = [
    { key: 'best', label: 'Top Performers' },
    { key: 'worst', label: 'Bottom Performers' },
    { key: 'alpha', label: 'A-Z' },
  ]

  let rows = Object.entries(data.by_salesperson || {})

  if (search) {
    const q = search.toLowerCase()
    rows = rows.filter(([name]) => name.toLowerCase().includes(q))
  }

  if (sortBy === 'best') rows.sort((a, b) => b[1].total_sales - a[1].total_sales)
  else if (sortBy === 'worst') rows.sort((a, b) => a[1].total_sales - b[1].total_sales)
  else if (sortBy === 'alpha') rows.sort((a, b) => a[0].localeCompare(b[0]))

  const allRows = Object.entries(data.by_salesperson || {})
  const totalSales = allRows.reduce((sum, [, s]) => sum + (s.total_sales || 0), 0)
  const totalVIPs = allRows.reduce((sum, [, s]) => sum + (s.vips || 0), 0)
  const totalDayOne = allRows.reduce((sum, [, s]) => sum + (s.day_one_booked || 0), 0)
  const totalSameDay = allRows.reduce((sum, [, s]) => sum + (s.same_day_sale || 0), 0)

  function handleExportCSV() {
    const csvRows = [
      ['Salesperson', 'Total Sales', 'VIPs', 'Day One', 'Same Day Sale'],
      ...rows.map(([name, s]) => [name, s.total_sales || 0, s.vips || 0, s.day_one_booked || 0, s.same_day_sale || 0]),
      ['Total', totalSales, totalVIPs, totalDayOne, totalSameDay],
    ]
    exportCSV(csvRows, `salesperson-stats-${startDate}-${endDate}`)
  }

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total Sales</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalSales}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total VIPs</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalVIPs}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Day One Booked</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalDayOne}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Same Day Sales</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalSameDay}</p>
        </div>
      </div>

      {/* Sort, Search & Export Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSortBy(opt.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                sortBy === opt.key
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-muted hover:text-text-primary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red w-48"
          />
          <button onClick={handleExportCSV} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">
            CSV
          </button>
          <button onClick={() => exportPDF('Salesperson Stats')} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">
            PDF
          </button>
        </div>
      </div>

      {/* Summary Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Salesperson</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Total Sales</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">VIPs</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Day One</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Same Day Sale</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, stats]) => (
              <tr key={name} className="border-b border-border hover:bg-bg/50 transition-colors">
                <td className="px-4 py-3 font-medium text-text-primary">{name}</td>
                <td className="px-4 py-3 text-center text-wcs-red font-semibold">{stats.total_sales || 0}</td>
                <td className="px-4 py-3 text-center text-text-primary">{stats.vips || 0}</td>
                <td className="px-4 py-3 text-center text-green-600">{stats.day_one_booked || 0}</td>
                <td className="px-4 py-3 text-center text-green-600">{stats.same_day_sale || 0}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">No data for this period</td>
              </tr>
            )}
            {rows.length > 0 && (
              <tr className="border-t-2 border-border font-bold bg-bg/30">
                <td className="px-4 py-3 text-text-primary">Total</td>
                <td className="px-4 py-3 text-center text-wcs-red">{totalSales}</td>
                <td className="px-4 py-3 text-center text-text-primary">{totalVIPs}</td>
                <td className="px-4 py-3 text-center text-green-600">{totalDayOne}</td>
                <td className="px-4 py-3 text-center text-green-600">{totalSameDay}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/reports.js portal/src/components/reports/SalespersonStats.jsx
git commit -m "feat: salesperson stats — show Day One + Same Day Sale, remove Day One No"
```

---

## Task 4: PT Report — Add Day One Breakdown Table

**Files:**
- Modify: `portal/src/components/reports/PTReport.jsx` (add breakdown table at top)

- [ ] **Step 1: Add the Day One Breakdown table to PTReport**

In `portal/src/components/reports/PTReport.jsx`, insert a new section between the stat cards (ends at line 101) and the export controls (line 103). Replace lines 102-113 (the empty line + export controls section) with:

```jsx

      {/* Day One Breakdown */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-bg">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Day One Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Member Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Booking Team Member</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Date Scheduled</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Day One Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Trainer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Sale</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr key={i} className="border-b border-border hover:bg-bg/50 transition-colors">
                  <td className="px-4 py-2 font-medium text-text-primary">{c.first_name} {c.last_name}</td>
                  <td className="px-4 py-2 text-text-muted">{c.day_one_booking_team_member || '—'}</td>
                  <td className="px-4 py-2 text-text-muted">{formatDate(c.day_one_booking_date)}</td>
                  <td className="px-4 py-2 text-text-muted">{formatDate(c.day_one_date)}</td>
                  <td className="px-4 py-2 text-text-muted">{c.day_one_trainer || '—'}</td>
                  <td className="px-4 py-2"><StatusPill status={c.day_one_status} /></td>
                  <td className="px-4 py-2">
                    {c.day_one_sale === 'Sale' || c.day_one_sale === true
                      ? <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-xs">Sale</span>
                      : <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 text-xs">{c.day_one_sale || 'No Sale'}</span>
                    }
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted text-sm">No Day One data for this period</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export Controls */}
      <div className="flex justify-end gap-2">
        <button onClick={() => {
          const csvRows = [
            ['Member Name', 'Booking Team Member', 'Date Scheduled', 'Day One Date', 'Trainer', 'Status', 'Sale'],
            ...contacts.map(c => [
              (c.first_name || '') + ' ' + (c.last_name || ''),
              c.day_one_booking_team_member || '',
              formatDate(c.day_one_booking_date),
              formatDate(c.day_one_date),
              c.day_one_trainer || '',
              c.day_one_status || '',
              c.day_one_sale || '',
            ]),
          ]
          exportCSV(csvRows, `pt-day-one-report-${startDate}-${endDate}`)
        }} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">CSV</button>
        <button onClick={() => exportPDF('PT / Day One Report')} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">PDF</button>
      </div>
```

This replaces the old export controls that used `exportPDF()` without a title and exported trainer-level CSVs. The new CSV exports the Day One breakdown table.

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/reports/PTReport.jsx
git commit -m "feat: add Day One breakdown table to PT report"
```

---

## Task 5: Club Health Backend Endpoint

**Files:**
- Modify: `auth/src/routes/reports.js` (add `/club-health` endpoint before `module.exports`)

- [ ] **Step 1: Add the club-health endpoint**

In `auth/src/routes/reports.js`, add this new route just before the `module.exports = router` line at the bottom:

```javascript
// ---------------------------------------------------------------------------
// GET /reports/club-health
// Query params: start_date, end_date, location_id, location_slug
// ---------------------------------------------------------------------------
router.get('/club-health', async (req, res) => {
  const { start_date, end_date } = req.query

  try {
    const locationFilter = await resolveLocationFilter(req.query)

    const startMs = dateToMs(start_date, false)
    const endMs   = dateToMs(end_date, true)

    let q = supabaseAdmin
      .from('ghl_contacts_report')
      .select(
        'vip_count, day_one_booked, day_one_status, day_one_sale,' +
        'same_day_sale, member_sign_date, location_slug'
      )
      .not('member_sign_date', 'is', null)

    q = applyLocationFilter(q, locationFilter)
    q = applyDateRange(q, 'member_sign_date', startMs, endMs)

    const { data, error } = await q
    if (error) return res.status(500).json({ error: 'Failed to fetch club health data', detail: error.message })

    const contacts = data || []

    let totalVips = 0
    let totalSameDaySales = 0
    let totalDayOnesBooked = 0

    const dayOneBookedCounts = {}
    const dayOneStatusCounts = {}
    const dayOneSaleCounts = {}

    for (const c of contacts) {
      totalVips += (parseInt(c.vip_count, 10) || 0)
      if (c.same_day_sale === 'Yes') totalSameDaySales++
      if (c.day_one_booked === 'Yes') totalDayOnesBooked++

      // Day One Booked pie
      const bookedVal = c.day_one_booked || 'No'
      dayOneBookedCounts[bookedVal] = (dayOneBookedCounts[bookedVal] || 0) + 1

      // Day One Status pie (only for booked = Yes)
      if (c.day_one_booked === 'Yes') {
        const statusVal = c.day_one_status || 'Unknown'
        dayOneStatusCounts[statusVal] = (dayOneStatusCounts[statusVal] || 0) + 1
      }

      // Day One Sale pie (only for status = Completed)
      if (c.day_one_status === 'Completed') {
        const saleVal = c.day_one_sale || 'No Sale'
        dayOneSaleCounts[saleVal] = (dayOneSaleCounts[saleVal] || 0) + 1
      }
    }

    res.json({
      total_vips: totalVips,
      total_same_day_sales: totalSameDaySales,
      total_day_ones_booked: totalDayOnesBooked,
      day_one_booked: dayOneBookedCounts,
      day_one_status: dayOneStatusCounts,
      day_one_sale: dayOneSaleCounts,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
```

- [ ] **Step 2: Add `getClubHealthReport` to `api.js`**

In `portal/src/lib/api.js`, add after the `getSalespersonStats` function (around line 148):

```javascript
export async function getClubHealthReport(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/club-health' + (qs ? '?' + qs : ''))
}
```

- [ ] **Step 3: Remove `getPipelineReport` from `api.js`**

Delete the `getPipelineReport` function (lines 140-143):

```javascript
// DELETE THESE LINES:
export async function getPipelineReport(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pipelines' + (qs ? '?' + qs : ''))
}
```

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/reports.js portal/src/lib/api.js
git commit -m "feat: add club-health endpoint, remove pipeline endpoint and API function"
```

---

## Task 6: Club Health Frontend Component

**Files:**
- Create: `portal/src/components/reports/ClubHealthReport.jsx`

- [ ] **Step 1: Create the ClubHealthReport component**

Create `portal/src/components/reports/ClubHealthReport.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { getClubHealthReport } from '../../lib/api'

const PIE_COLORS = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5', '#dd6b20', '#319795']

function PieChart({ title, data }) {
  const entries = Object.entries(data || {}).filter(([, v]) => v > 0)
  const total = entries.reduce((sum, [, v]) => sum + v, 0)
  if (total === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-6 text-center">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</p>
        <p className="text-sm text-text-muted py-4">No data</p>
      </div>
    )
  }

  // Build conic gradient stops
  let cumulative = 0
  const stops = entries.map(([, count], i) => {
    const start = cumulative
    cumulative += (count / total) * 360
    return `${PIE_COLORS[i % PIE_COLORS.length]} ${start}deg ${cumulative}deg`
  })

  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</p>
      <div className="flex items-center gap-6">
        <div
          className="w-32 h-32 rounded-full flex-shrink-0"
          style={{ background: `conic-gradient(${stops.join(', ')})` }}
        />
        <div className="space-y-2">
          {entries.map(([label, count], i) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="text-text-muted">{label}</span>
              <span className="font-semibold text-text-primary">{count}</span>
              <span className="text-text-muted text-xs">({Math.round((count / total) * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ClubHealthReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { loadData() }, [startDate, endDate, locationSlug])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      const res = await getClubHealthReport(params)
      setData(res)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading club health data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-6">
      {/* Big Number Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total VIPs</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.total_vips}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Same Day Sales</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.total_same_day_sales}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Day Ones Booked</p>
          <p className="text-4xl font-bold text-text-primary mt-2">{data.total_day_ones_booked}</p>
        </div>
      </div>

      {/* Pie Charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PieChart title="Day One Booked" data={data.day_one_booked} />
        <PieChart title="Day One Status" data={data.day_one_status} />
        <PieChart title="Day One Sale" data={data.day_one_sale} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/reports/ClubHealthReport.jsx
git commit -m "feat: add ClubHealthReport component with pie charts"
```

---

## Task 7: Reporting View — Tile Grid, Hash Routing, Date Layout

**Files:**
- Modify: `portal/src/components/ReportingView.jsx` (complete rewrite)
- Delete: `portal/src/components/reports/PipelineReport.jsx`

- [ ] **Step 1: Delete PipelineReport**

```bash
rm portal/src/components/reports/PipelineReport.jsx
```

- [ ] **Step 2: Rewrite ReportingView with tile grid + hash routing**

Replace the entire contents of `portal/src/components/ReportingView.jsx`:

```jsx
import { useState, useEffect } from 'react'
import MembershipReport from './reports/MembershipReport'
import PTReport from './reports/PTReport'
import SalespersonStats from './reports/SalespersonStats'
import AdReports from './reports/AdReports'
import ClubHealthReport from './reports/ClubHealthReport'

const REPORT_TILES = [
  { key: 'club-health', label: 'Club Health', desc: 'Dashboard', icon: '❤️' },
  { key: 'salesperson', label: 'Salesperson Stats', desc: 'Performance', icon: '📊' },
  { key: 'membership', label: 'Membership', desc: 'Report', icon: '🏷️' },
  { key: 'pt', label: 'PT / Day One', desc: 'Report', icon: '🏋️' },
  { key: 'ads', label: 'Ad Reports', desc: 'Coming Soon', icon: '📣' },
]

const LOCATIONS = [
  { slug: 'all', label: 'All Locations' },
  { slug: 'salem', label: 'Salem' },
  { slug: 'keizer', label: 'Keizer' },
  { slug: 'eugene', label: 'Eugene' },
  { slug: 'springfield', label: 'Springfield' },
  { slug: 'clackamas', label: 'Clackamas' },
  { slug: 'milwaukie', label: 'Milwaukie' },
  { slug: 'medford', label: 'Medford' },
]

const QUICK_RANGES = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'last_30', label: 'Last 30 Days' },
  { key: 'last_90', label: 'Last 90 Days' },
  { key: 'ytd', label: 'YTD' },
]

function getQuickRange(key) {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  switch (key) {
    case 'this_month':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0], end: today }
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: s.toISOString().split('T')[0], end: e.toISOString().split('T')[0] }
    }
    case 'last_30': {
      const s = new Date(now)
      s.setDate(s.getDate() - 30)
      return { start: s.toISOString().split('T')[0], end: today }
    }
    case 'last_90': {
      const s = new Date(now)
      s.setDate(s.getDate() - 90)
      return { start: s.toISOString().split('T')[0], end: today }
    }
    case 'ytd':
      return { start: new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0], end: today }
    default:
      return { start: today, end: today }
  }
}

function getMonthStart() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}

function getToday() {
  return new Date().toISOString().split('T')[0]
}

function getSubRoute() {
  const hash = window.location.hash
  if (hash.startsWith('#reporting/')) return hash.replace('#reporting/', '')
  return null
}

export default function ReportingView({ user, onBack }) {
  const [activeReport, setActiveReport] = useState(getSubRoute())
  const [startDate, setStartDate] = useState(getMonthStart())
  const [endDate, setEndDate] = useState(getToday())
  const [locationSlug, setLocationSlug] = useState('all')
  const [activeQuick, setActiveQuick] = useState('this_month')

  useEffect(() => {
    function onHashChange() {
      setActiveReport(getSubRoute())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function navigateTo(key) {
    window.location.hash = key ? '#reporting/' + key : '#reporting'
    setActiveReport(key || null)
  }

  function applyQuickRange(key) {
    setActiveQuick(key)
    const range = getQuickRange(key)
    setStartDate(range.start)
    setEndDate(range.end)
  }

  function handleDateChange(field, value) {
    setActiveQuick(null)
    if (field === 'start') setStartDate(value)
    else setEndDate(value)
  }

  function handleBack() {
    if (activeReport) {
      navigateTo(null)
    } else if (onBack) {
      onBack()
    }
  }

  return (
    <div className="w-full px-8 py-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {activeReport ? 'Back to Reports' : 'Back to Portal'}
        </button>
        <h2 className="text-xl font-bold text-text-primary">
          {activeReport ? REPORT_TILES.find(t => t.key === activeReport)?.label || 'Report' : 'Reporting'}
        </h2>
      </div>

      {/* Location Selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        {LOCATIONS.map(loc => (
          <button
            key={loc.slug}
            onClick={() => setLocationSlug(loc.slug)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              locationSlug === loc.slug
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-surface text-text-muted border-border hover:text-text-primary hover:border-text-muted'
            }`}
          >
            {loc.label}
          </button>
        ))}
      </div>

      {/* Date Controls — right aligned */}
      <div className="flex flex-wrap items-center gap-3 mb-6 justify-end">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_RANGES.map(qr => (
            <button
              key={qr.key}
              onClick={() => applyQuickRange(qr.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                activeQuick === qr.key
                  ? 'bg-text-primary text-white border-text-primary'
                  : 'bg-surface text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {qr.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">From</label>
          <input
            type="date"
            value={startDate}
            onChange={e => handleDateChange('start', e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
          <label className="text-xs text-text-muted">To</label>
          <input
            type="date"
            value={endDate}
            onChange={e => handleDateChange('end', e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
        </div>
      </div>

      {/* Content — Tile Grid or Active Report */}
      {!activeReport ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
          {REPORT_TILES.map(tile => (
            <button
              key={tile.key}
              onClick={() => navigateTo(tile.key)}
              className="group flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
            >
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg text-wcs-red group-hover:bg-wcs-red group-hover:text-white transition-all duration-200">
                <span className="text-2xl">{tile.icon}</span>
              </div>
              <div className="text-center">
                <span className="block text-base font-semibold text-text-primary">{tile.label}</span>
                <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">{tile.desc}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <>
          {activeReport === 'club-health' && (
            <ClubHealthReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'salesperson' && (
            <SalespersonStats startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'membership' && (
            <MembershipReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'pt' && (
            <PTReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
          {activeReport === 'ads' && (
            <AdReports startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add -A portal/src/components/ReportingView.jsx portal/src/components/reports/PipelineReport.jsx
git commit -m "feat: tile-based reporting with hash routing, remove pipeline"
```

---

## Task 8: App.jsx Hash Routing + ToolGrid New Tab

**Files:**
- Modify: `portal/src/App.jsx` (hash detection)
- Modify: `portal/src/components/ToolGrid.jsx` (open _blank)

- [ ] **Step 1: Add hash routing to App.jsx**

In `portal/src/App.jsx`, add hash detection. Replace lines 28-29:

```javascript
  const [showReporting, setShowReporting] = useState(false)
```

With:

```javascript
  const [showReporting, setShowReporting] = useState(window.location.hash.startsWith('#reporting'))
```

Then add a `useEffect` for hash changes after the existing useEffect blocks (after line 60):

```javascript
  useEffect(() => {
    function onHashChange() {
      setShowReporting(window.location.hash.startsWith('#reporting'))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
```

- [ ] **Step 2: Update ToolGrid to open reporting in a new tab**

In `portal/src/components/ToolGrid.jsx`, change how the Reporting tile click handler works. Replace lines 143-146:

```javascript
          // Special handling for Reporting tile — opens built-in ReportingView
          const handleClick = tile.label === 'Reporting' && onReporting
            ? onReporting
            : () => setActiveGroup(tile)
```

With:

```javascript
          // Special handling for Reporting tile — opens in new tab
          const handleClick = tile.label === 'Reporting'
            ? () => {
                const reportingUrl = window.location.origin + window.location.pathname + window.location.search + '#reporting'
                window.open(reportingUrl, '_blank')
              }
            : () => setActiveGroup(tile)
```

- [ ] **Step 3: Remove the `onReporting` prop usage from App.jsx**

In `portal/src/App.jsx`, on line 145 remove the `onReporting` prop from the ToolGrid component. Change:

```jsx
          <ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} locationId={user.staff.locations?.find(l => l.is_primary)?.id} onDayOne={() => setShowDayOne(true)} onTours={() => setShowTours(true)} onReporting={() => setShowReporting(true)} />
```

To:

```jsx
          <ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} locationId={user.staff.locations?.find(l => l.is_primary)?.id} onDayOne={() => setShowDayOne(true)} onTours={() => setShowTours(true)} />
```

And update the ToolGrid function signature in `ToolGrid.jsx` line 6 to remove `onReporting`:

```jsx
export default function ToolGrid({ abcUrl, location, visibleTools, locationId, onDayOne, onTours }) {
```

- [ ] **Step 4: Commit**

```bash
git add portal/src/App.jsx portal/src/components/ToolGrid.jsx
git commit -m "feat: reporting tile opens in new Electron tab via hash routing"
```

---

## Task 9: Electron — Tab Name for Reporting

**Files:**
- Modify: `launcher/src/main.js:195-217` (getTabName + onNewWindow)

- [ ] **Step 1: Update getTabName to detect reporting hash**

In `launcher/src/main.js`, replace the `getTabName` function (lines 195-205):

```javascript
  function getTabName(url) {
    try {
      const parsed = new URL(url)
      // Check for reporting hash
      if (parsed.hash && parsed.hash.startsWith('#reporting')) return 'Reporting'
      const hostname = parsed.hostname
      for (const [domain, name] of Object.entries(URL_TAB_NAMES)) {
        if (hostname.includes(domain) || hostname === domain) return name
      }
      // Fallback: use hostname without www/app prefix
      return hostname.replace(/^(www|app)\./, '').split('.')[0]
        .charAt(0).toUpperCase() + hostname.replace(/^(www|app)\./, '').split('.')[0].slice(1)
    } catch { return 'Tab' }
  }
```

- [ ] **Step 2: Update onNewWindow to handle reporting URLs with portal preload**

In `launcher/src/main.js`, update the `onNewWindow` handler (lines 207-217). The reporting tab should use the portal-preload since it's the same portal app. Replace:

```javascript
  tabManager.onNewWindow = (url) => {
    const abcUrl = getAbcUrl()
    if (url.includes('abcfinancial.com') || url.includes('kiosk.html')) {
      const abcDirect = abcUrl || 'https://prod02.abcfinancial.com'
      tabManager.createTab(abcDirect, 'ABC Financial', {
        preload: path.join(__dirname, 'abc-scraper.js'),
      })
    } else if (url !== 'about:blank' && !url.startsWith('chrome')) {
      tabManager.createTab(url, getTabName(url), { preload: path.join(__dirname, 'credential-capture.js') })
    }
  }
```

With:

```javascript
  tabManager.onNewWindow = (url) => {
    const abcUrl = getAbcUrl()
    if (url.includes('abcfinancial.com') || url.includes('kiosk.html')) {
      const abcDirect = abcUrl || 'https://prod02.abcfinancial.com'
      tabManager.createTab(abcDirect, 'ABC Financial', {
        preload: path.join(__dirname, 'abc-scraper.js'),
      })
    } else if (url.includes('#reporting')) {
      // Reporting tab uses portal preload for auth bridge
      tabManager.createTab(url, 'Reporting', {
        preload: path.join(__dirname, 'portal-preload.js'),
      })
    } else if (url !== 'about:blank' && !url.startsWith('chrome')) {
      tabManager.createTab(url, getTabName(url), { preload: path.join(__dirname, 'credential-capture.js') })
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add launcher/src/main.js
git commit -m "feat: Electron tab support for reporting hash URLs"
```

---

## Task 10: Update MembershipReport PDF Export

**Files:**
- Modify: `portal/src/components/reports/MembershipReport.jsx:128` (PDF button)

- [ ] **Step 1: Update the PDF export call to include report name**

In `portal/src/components/reports/MembershipReport.jsx`, line 128, change:

```jsx
        <button onClick={exportPDF} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">PDF</button>
```

To:

```jsx
        <button onClick={() => exportPDF('Membership Report')} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">PDF</button>
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/reports/MembershipReport.jsx
git commit -m "fix: pass report name to PDF export for all reports"
```

---

## Task 11: Build and Verify

- [ ] **Step 1: Build the portal frontend**

```bash
cd portal && npm run build
```

Expected: Build succeeds with no errors. Check for missing imports, unused variables, or type issues.

- [ ] **Step 2: Verify auth API starts cleanly**

```bash
cd auth && node -e "require('./src/routes/reports')" && echo "OK"
```

Expected: No module errors. (Full server start needs env vars, but module loading should work.)

- [ ] **Step 3: Verify no references to PipelineReport remain**

```bash
grep -r "PipelineReport\|pipeline\|pipelines" portal/src/ --include="*.jsx" --include="*.js" | grep -v node_modules
```

Expected: No results (all pipeline references removed).

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A && git status
# Only commit if there are changes from build fixes
```
