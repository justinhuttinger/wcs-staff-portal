# KPIs Report (Experimental) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin/director-only "KPIs" report (in a new Experimental sidebar group) that shows trial conversion %, day one booking %, and VIP booking % against per-club admin-set goals, with a per-KPI expandable 6-month trend.

**Architecture:** A single React report component reuses the existing `GET /reports/membership` endpoint. It computes three percentages client-side, compares each to a goal stored in the existing `app_config` key-value store, and renders each KPI as a light card that expands (accordion) to show that KPI's last-6-months trend (one membership call per month). Goals are edited via a new admin tile that follows the existing `ActionLinksAdmin` pattern. No new backend route and no new DB table.

**Tech Stack:** React (Vite), Tailwind (`bg-surface`/`border-border`/`text-*` tokens), hand-rolled inline SVG charts (existing pattern), Node built-in test runner for pure logic.

**Spec:** `docs/superpowers/specs/2026-06-03-kpis-report-design.md`

**Worktree:** `.claude/worktrees/kpis-report` (branch `feat/kpis-report`). All paths below are relative to the repo root inside that worktree.

---

## File Structure

| File | Responsibility | Create / Modify |
| --- | --- | --- |
| `portal/src/lib/kpiMath.js` | Pure helpers: `pct`, `gapInfo`, `trendDirection`, `monthRanges` | Create |
| `portal/src/lib/kpiMath.test.mjs` | Node `--test` coverage for the pure helpers | Create |
| `portal/src/components/reports/KpiReport.jsx` | Fetch membership data + goals, compute KPIs, render tiles + accordion trend | Create |
| `portal/src/components/admin/KpiGoalsAdmin.jsx` | Admin CRUD for per-club goal percentages | Create |
| `portal/src/components/ReportingView.jsx` | Register Experimental group, `kpis` tile/icon, role gate, render block | Modify |
| `portal/src/lib/reportInfo.js` | KPIs report info popover copy | Modify |
| `portal/src/components/AdminPanel.jsx` | Register "KPI Goals" experimental admin tile | Modify |

---

## Task 1: Pure KPI math helpers (TDD)

**Files:**
- Create: `portal/src/lib/kpiMath.js`
- Test: `portal/src/lib/kpiMath.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/kpiMath.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pct, gapInfo, trendDirection, monthRanges } from './kpiMath.js'

test('pct returns rounded percentage', () => {
  assert.equal(pct(50, 200), 25)
  assert.equal(pct(1, 3), 33)
})

test('pct returns null when denominator is 0 or missing', () => {
  assert.equal(pct(5, 0), null)
  assert.equal(pct(5, null), null)
  assert.equal(pct(5, undefined), null)
})

test('gapInfo flags above / below / met goal', () => {
  assert.deepEqual(gapInfo(70, 65), { diff: 5, tone: 'above', text: '+5% above goal' })
  assert.deepEqual(gapInfo(58, 65), { diff: -7, tone: 'below', text: '-7% below goal' })
  assert.deepEqual(gapInfo(65, 65), { diff: 0, tone: 'above', text: 'Goal met' })
})

test('gapInfo returns null when actual or goal missing', () => {
  assert.equal(gapInfo(null, 65), null)
  assert.equal(gapInfo(70, null), null)
})

test('trendDirection compares last two points distance to goal', () => {
  // moving from 50 (gap 15) to 60 (gap 5) => toward
  assert.equal(trendDirection([{ value: 50 }, { value: 60 }], 65), 'toward')
  // moving from 60 (gap 5) to 50 (gap 15) => away
  assert.equal(trendDirection([{ value: 60 }, { value: 50 }], 65), 'away')
  // equal distance => flat
  assert.equal(trendDirection([{ value: 60 }, { value: 70 }], 65), 'flat')
})

test('trendDirection ignores null points and returns null when <2 real points', () => {
  assert.equal(trendDirection([{ value: null }, { value: 60 }], 65), null)
  assert.equal(trendDirection([], 65), null)
  assert.equal(trendDirection([{ value: 60 }], 65), null)
})

test('trendDirection returns null when no goal', () => {
  assert.equal(trendDirection([{ value: 50 }, { value: 60 }], null), null)
})

test('monthRanges returns count buckets ending in the reference month, local dates', () => {
  const ranges = monthRanges(new Date(2026, 5, 15), 6) // June 2026
  assert.equal(ranges.length, 6)
  assert.equal(ranges[0].start, '2026-01-01')
  assert.equal(ranges[0].end, '2026-01-31')
  assert.equal(ranges[0].label, 'Jan')
  assert.equal(ranges[5].start, '2026-06-01')
  assert.equal(ranges[5].end, '2026-06-30')
  assert.equal(ranges[5].label, 'Jun')
  assert.equal(ranges[5].key, '2026-06')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test portal/src/lib/kpiMath.test.mjs`
Expected: FAIL — `Cannot find module './kpiMath.js'` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `portal/src/lib/kpiMath.js`:

```js
// Pure, framework-free helpers for the KPIs report. No React, no fetch — kept
// separate so the math can be unit-tested with `node --test`.

// Percentage as a rounded integer. Returns null (not 0) when the denominator is
// missing or zero, so callers can render "n/a" instead of a misleading 0%.
export function pct(num, den) {
  if (!den || den <= 0) return null
  return Math.round((Number(num) || 0) / den * 100)
}

// Compares an actual percentage to a goal. Returns null if either is missing.
// diff is actual - goal. tone is 'above' when actual >= goal, else 'below'.
export function gapInfo(actual, goal) {
  if (actual == null || goal == null || goal === '' || Number.isNaN(Number(goal))) {
    return null
  }
  const g = Number(goal)
  const diff = actual - g
  if (diff === 0) return { diff: 0, tone: 'above', text: 'Goal met' }
  if (diff > 0) return { diff, tone: 'above', text: `+${diff}% above goal` }
  return { diff, tone: 'below', text: `${diff}% below goal` }
}

// Looks at the last two non-null points and reports whether the metric is
// getting closer to ('toward') or further from ('away') the goal, or 'flat'.
// Returns null when there aren't two real points or no goal is set.
export function trendDirection(points, goal) {
  if (goal == null || goal === '' || Number.isNaN(Number(goal))) return null
  const real = (points || []).filter(p => p && p.value != null)
  if (real.length < 2) return null
  const g = Number(goal)
  const prev = Math.abs(real[real.length - 2].value - g)
  const cur = Math.abs(real[real.length - 1].value - g)
  if (cur < prev) return 'toward'
  if (cur > prev) return 'away'
  return 'flat'
}

function fmtLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Builds `count` month buckets ending with the month of `refDate` (inclusive).
// Dates are LOCAL (not UTC) to match the rest of the app's Pacific date
// handling. Each bucket: { key, label, start, end } with YYYY-MM-DD strings.
export function monthRanges(refDate, count) {
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1)
    const end = new Date(refDate.getFullYear(), refDate.getMonth() - i + 1, 0)
    out.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleString('en-US', { month: 'short' }),
      start: fmtLocal(start),
      end: fmtLocal(end),
    })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test portal/src/lib/kpiMath.test.mjs`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/kpiMath.js portal/src/lib/kpiMath.test.mjs
git commit -m "feat(portal): KPI math helpers (pct, gapInfo, trendDirection, monthRanges)"
```

---

## Task 2: KpiReport component — tiles for the current period

**Files:**
- Create: `portal/src/components/reports/KpiReport.jsx`

This task builds the report shell and the (collapsed) KPI tiles for the selected date range + location. The trend/accordion is added in Task 3.

- [ ] **Step 1: Create the component with current-period tiles**

Create `portal/src/components/reports/KpiReport.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { getMembershipReport, getAppSettings } from '../../lib/api'
import { pct, gapInfo } from '../../lib/kpiMath'
import DesktopLoading from '../DesktopLoading'

// Each KPI: how to read its current % from a /reports/membership response, and
// the app_config key prefix for its goal. Adding a future KPI = one entry here.
export const KPI_DEFS = [
  {
    key: 'trial',
    label: 'Trial Conversion',
    goalKey: 'kpi_goal_trial',
    derive: d => (d?.trial_conversion?.rate ?? null),
  },
  {
    key: 'dayone',
    label: 'Day One Booking',
    goalKey: 'kpi_goal_dayone',
    derive: d => pct(d?.total_day_one_booked || 0, d?.total_memberships || 0),
  },
  {
    key: 'vip',
    label: 'VIP Booking',
    goalKey: 'kpi_goal_vip',
    derive: d => pct(d?.total_vips || 0, d?.total_memberships || 0),
  },
]

// Reads a goal for a def at the active location from the flat app_config map.
// Returns null for the all-locations view (goals are per-club only).
function goalFor(def, goals, locationSlug) {
  if (locationSlug === 'all') return null
  const raw = goals[`${def.goalKey}_${locationSlug}`]
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

export default function KpiReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [goals, setGoals] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      getMembershipReport({ start_date: startDate, end_date: endDate, location_slug: locationSlug }),
      getAppSettings('kpi_goal_'),
    ])
      .then(([report, goalMap]) => {
        if (cancelled) return
        setData(report)
        setGoals(goalMap || {})
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load KPIs') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, locationSlug])

  if (loading) return <DesktopLoading />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center text-red-500">
        {error}
      </div>
    )
  }

  const isAll = locationSlug === 'all'

  return (
    <div className="space-y-3">
      {KPI_DEFS.map(def => {
        const value = def.derive(data)
        const goal = goalFor(def, goals, locationSlug)
        const gap = gapInfo(value, goal)
        return (
          <div key={def.key} className="bg-surface rounded-xl border border-border p-5">
            <div className="flex items-center gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-text-primary">{def.label}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {isAll ? 'All locations' : 'Current period'}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-6 flex-shrink-0">
                <div className="text-right">
                  <p className="text-2xl font-bold text-text-primary leading-none">
                    {value == null ? 'n/a' : `${value}%`}
                  </p>
                  <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">Actual</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-text-muted leading-none">
                    {goal == null ? (isAll ? '—' : '—') : `${goal}%`}
                  </p>
                  <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">Goal</p>
                </div>
                <div className="w-40 text-right">
                  {isAll ? (
                    <span className="text-xs text-text-muted">Goal: set per club</span>
                  ) : gap ? (
                    <span className={`text-xs font-semibold ${gap.tone === 'above' ? 'text-green-600' : 'text-red-500'}`}>
                      {gap.text}
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">Set a goal</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd portal && npm run build`
Expected: build succeeds with no errors referencing `KpiReport.jsx`. (The component is not yet wired into `ReportingView`, so it is tree-shaken out; this step only confirms it parses and imports resolve.)

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/reports/KpiReport.jsx
git commit -m "feat(portal): KpiReport tiles (current-period actual vs goal)"
```

---

## Task 3: Accordion trend (last 6 months, per KPI)

**Files:**
- Modify: `portal/src/components/reports/KpiReport.jsx`

Add an inline trend chart and accordion behavior: clicking a tile expands it (and collapses any other) to show that KPI's last-6-months actual line vs. a dashed goal line.

- [ ] **Step 1: Add the trend chart component**

Add this `KpiTrendChart` function near the top of `KpiReport.jsx` (after the imports, before `KPI_DEFS`):

```jsx
// Single-series trend with an optional dashed goal line. Hand-rolled inline SVG
// to match the existing report chart pattern (no charting dependency).
function KpiTrendChart({ points, goal }) {
  if (!points || points.length === 0) return null
  const values = points.map(p => p.value).filter(v => v != null)
  const candidates = values.concat(goal != null ? [goal] : [])
  const maxVal = Math.max(...candidates, 1)
  const w = 600, h = 160, padL = 30, padR = 10, padT = 10, padB = 25
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const toX = i => padL + (points.length > 1 ? (i / (points.length - 1)) * chartW : chartW / 2)
  const toY = v => padT + chartH - (v / maxVal) * chartH

  // Build the actual-% path, breaking the line across null (missing) months.
  let path = ''
  points.forEach((p, i) => {
    if (p.value == null) { path += ' '; return }
    const prevNull = i === 0 || points[i - 1].value == null
    path += `${prevNull ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)} `
  })

  const yLabels = [0, Math.round(maxVal / 2), maxVal]

  return (
    <div className="bg-surface rounded-xl border border-border p-4 mt-3">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Last 6 Months</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '180px' }}>
        {yLabels.map(v => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={toY(v)} y2={toY(v)} stroke="#e2e8f0" strokeWidth="0.5" />
            <text x={padL - 4} y={toY(v) + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: '8px' }}>{v}</text>
          </g>
        ))}
        {goal != null && (
          <line x1={padL} x2={w - padR} y1={toY(goal)} y2={toY(goal)} stroke="#e53e3e" strokeWidth="1" strokeDasharray="4 3" />
        )}
        <path d={path.trim()} fill="none" stroke="#38a169" strokeWidth="2" />
        {points.map((p, i) => p.value != null && (
          <circle key={i} cx={toX(i)} cy={toY(p.value)} r="2.5" fill="#38a169" />
        ))}
        {points.map((p, i) => (
          <text key={`l${i}`} x={toX(i)} y={h - 8} textAnchor="middle" className="fill-gray-400" style={{ fontSize: '8px' }}>{p.label}</text>
        ))}
      </svg>
      {goal != null && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-text-muted">
          <span className="inline-block w-4 h-0 border-t border-dashed" style={{ borderColor: '#e53e3e' }} />
          Goal {goal}%
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add trend fetching + accordion state to the component**

Replace the body of `KpiReport` (the function from Task 2) with this version, which adds `openKey`, a `trend` cache, the monthly fetch, the direction indicator, and click-to-expand. Imports at the top of the file must now include `trendDirection` and `monthRanges`:

Update the import line:

```jsx
import { pct, gapInfo, trendDirection, monthRanges } from '../../lib/kpiMath'
```

Then replace the whole `export default function KpiReport(...) { ... }` with:

```jsx
export default function KpiReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [goals, setGoals] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openKey, setOpenKey] = useState(null)
  // trendByKey: { [defKey]: [{ label, value }] } for the open location.
  const [trendByKey, setTrendByKey] = useState(null)
  const [trendLoading, setTrendLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setOpenKey(null)
    setTrendByKey(null)
    Promise.all([
      getMembershipReport({ start_date: startDate, end_date: endDate, location_slug: locationSlug }),
      getAppSettings('kpi_goal_'),
    ])
      .then(([report, goalMap]) => {
        if (cancelled) return
        setData(report)
        setGoals(goalMap || {})
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load KPIs') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, locationSlug])

  // Lazily fetch the 6-month trend the first time any tile is expanded for the
  // current location. One /reports/membership call per month, run in parallel.
  function ensureTrend() {
    if (trendByKey || trendLoading) return
    setTrendLoading(true)
    const ranges = monthRanges(new Date(), 6)
    Promise.all(
      ranges.map(r =>
        getMembershipReport({ start_date: r.start, end_date: r.end, location_slug: locationSlug })
          .then(rep => ({ ok: true, rep }))
          .catch(() => ({ ok: false, rep: null }))
      )
    ).then(results => {
      const byKey = {}
      for (const def of KPI_DEFS) {
        byKey[def.key] = ranges.map((r, i) => ({
          label: r.label,
          value: results[i].ok ? def.derive(results[i].rep) : null,
        }))
      }
      setTrendByKey(byKey)
    }).finally(() => setTrendLoading(false))
  }

  function toggle(key) {
    setOpenKey(prev => (prev === key ? null : key))
    ensureTrend()
  }

  if (loading) return <DesktopLoading />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center text-red-500">
        {error}
      </div>
    )
  }

  const isAll = locationSlug === 'all'

  return (
    <div className="space-y-3">
      {KPI_DEFS.map(def => {
        const value = def.derive(data)
        const goal = goalFor(def, goals, locationSlug)
        const gap = gapInfo(value, goal)
        const open = openKey === def.key
        const points = trendByKey?.[def.key] || null
        const dir = points ? trendDirection(points, goal) : null
        return (
          <div key={def.key} className="bg-surface rounded-xl border border-border p-5">
            <button
              type="button"
              onClick={() => toggle(def.key)}
              className="w-full flex items-center gap-4 text-left"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-text-primary">{def.label}</p>
                <p className="text-xs text-text-muted mt-0.5">{isAll ? 'All locations' : 'Current period'}</p>
              </div>
              <div className="ml-auto flex items-center gap-6 flex-shrink-0">
                <div className="text-right">
                  <p className="text-2xl font-bold text-text-primary leading-none">
                    {value == null ? 'n/a' : `${value}%`}
                  </p>
                  <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">Actual</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-text-muted leading-none">{goal == null ? '—' : `${goal}%`}</p>
                  <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">Goal</p>
                </div>
                <div className="w-40 text-right">
                  {isAll ? (
                    <span className="text-xs text-text-muted">Goal: set per club</span>
                  ) : gap ? (
                    <span className={`text-xs font-semibold ${gap.tone === 'above' ? 'text-green-600' : 'text-red-500'}`}>
                      {gap.text}
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">Set a goal</span>
                  )}
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {open && (
              <div>
                {trendLoading && !points && (
                  <p className="text-xs text-text-muted mt-3">Loading trend…</p>
                )}
                {points && (
                  <>
                    {dir && (
                      <p className={`text-xs font-medium mt-3 ${dir === 'toward' ? 'text-green-600' : dir === 'away' ? 'text-red-500' : 'text-text-muted'}`}>
                        {dir === 'toward' ? 'Trending toward goal' : dir === 'away' ? 'Trending away from goal' : 'Holding steady'}
                      </p>
                    )}
                    <KpiTrendChart points={points} goal={goal} />
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd portal && npm run build`
Expected: build succeeds, no errors. `goalFor` (from Task 2) is still defined above the component — confirm it was not removed.

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/reports/KpiReport.jsx
git commit -m "feat(portal): per-KPI accordion trend (6-month line vs goal)"
```

---

## Task 4: Wire KpiReport into the reporting page

**Files:**
- Modify: `portal/src/components/ReportingView.jsx`
- Modify: `portal/src/lib/reportInfo.js`

- [ ] **Step 1: Import the component**

In `portal/src/components/ReportingView.jsx`, add to the import block (after the other report imports, e.g. after the `WebsiteSubmissionsReport` import on line ~18):

```jsx
import KpiReport from './reports/KpiReport'
```

- [ ] **Step 2: Add the report icon**

In the `REPORT_ICONS` object, add a `kpis` entry (target/goal icon):

```js
  kpis: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z',
```

- [ ] **Step 3: Add the tile definition**

In `ALL_REPORT_TILES`, add (after the last entry, `website-submissions`):

```js
  { key: 'kpis', label: 'KPIs', desc: 'Goals vs. Actuals' },
```

- [ ] **Step 4: Add the Experimental group**

In `REPORT_GROUPS`, add a 4th group after the `marketing` group:

```js
  {
    key: 'experimental',
    label: 'Experimental',
    desc: 'In Development',
    iconPath: 'M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3',
    reports: ['kpis'],
  },
```

- [ ] **Step 5: Gate visibility to admin + director only**

In `getReportTilesForRole`, the `default` branch (line ~103-104, commented `// corporate, admin, director`) already returns all tiles, so admin/director/corporate get `kpis` automatically. The `lead`, `manager`, and `marketing` branches use explicit `.includes([...])` allow-lists that do not contain `kpis`, so they are already excluded. **No change needed** — but verify by reading the three non-default branches and confirming `'kpis'` is absent from each. Do not add it to them.

- [ ] **Step 6: Add the render block**

In the active-report render section, add after the `website-submissions` block (line ~444-446):

```jsx
          {activeReport === 'kpis' && (
            <KpiReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
```

Note: `kpis` is NOT in the `showDateControls` exclusion list (line ~320), so it correctly gets the date range + location controls. Leave that list unchanged.

- [ ] **Step 7: Add report info copy**

In `portal/src/lib/reportInfo.js`, add a `kpis` entry to the `REPORT_INFO` object (place it near the end, before the closing brace):

```js
  kpis: {
    title: 'KPIs',
    sections: [
      {
        heading: 'What this is',
        body:
          'An experimental scoreboard that compares three club metrics against goals you set per club in the admin panel: trial conversion, day one booking rate, and VIP booking rate.',
      },
      {
        heading: 'How the percentages work',
        body: [
          'Trial Conversion is won trials divided by trials started, the same number shown on the Membership report.',
          'Day One Booking and VIP Booking are each divided by new members signed in the selected range.',
        ],
      },
      {
        heading: 'Trends',
        body:
          'Click any KPI to expand its last six months against the goal line. Months with no data show as gaps, not zeros.',
      },
    ],
    notes: [
      'All-locations view shows actuals only; goals are set per club.',
      'History only goes back as far as synced data exists.',
    ],
  },
```

- [ ] **Step 8: Verify the build compiles**

Run: `cd portal && npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 9: Commit**

```bash
git add portal/src/components/ReportingView.jsx portal/src/lib/reportInfo.js
git commit -m "feat(portal): add KPIs report under Experimental group (admin/director only)"
```

---

## Task 5: KPI Goals admin component

**Files:**
- Create: `portal/src/components/admin/KpiGoalsAdmin.jsx`

- [ ] **Step 1: Create the admin component**

Create `portal/src/components/admin/KpiGoalsAdmin.jsx` (mirrors `ActionLinksAdmin.jsx`):

```jsx
import { useState, useEffect } from 'react'
import { getAppSettings, saveAppSettings } from '../../lib/api'
import { LOCATION_NAMES } from '../../config/locations'

// Must match the goalKey values in KpiReport.jsx KPI_DEFS.
const GOAL_FIELDS = [
  { prefix: 'kpi_goal_trial', label: 'Trial Conversion Goal %' },
  { prefix: 'kpi_goal_dayone', label: 'Day One Booking Goal %' },
  { prefix: 'kpi_goal_vip', label: 'VIP Booking Goal %' },
]

export default function KpiGoalsAdmin() {
  const [goals, setGoals] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    getAppSettings('kpi_goal_')
      .then(map => setGoals(map || {}))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function handleChange(key, value) {
    setGoals(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      await saveAppSettings(goals)
      setMessage({ type: 'success', text: 'Saved!' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-text-muted p-4">Loading...</p>

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-text-primary">KPI Goals</h3>
          <p className="text-xs text-text-muted mt-1">Set per-club target percentages for the experimental KPIs report. Leave blank for no goal.</p>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <span className={`text-xs font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
              {message.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {LOCATION_NAMES.map(loc => {
          const slug = loc.toLowerCase()
          return (
            <div key={slug} className="bg-surface border border-border rounded-xl p-4">
              <h4 className="text-sm font-bold text-text-primary mb-3">{loc}</h4>
              <div className="grid grid-cols-3 gap-4">
                {GOAL_FIELDS.map(field => {
                  const key = `${field.prefix}_${slug}`
                  return (
                    <div key={key}>
                      <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">{field.label}</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={goals[key] ?? ''}
                        onChange={e => handleChange(key, e.target.value)}
                        placeholder="e.g. 65"
                        className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd portal && npm run build`
Expected: build succeeds (component not yet referenced; this confirms it parses).

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/admin/KpiGoalsAdmin.jsx
git commit -m "feat(portal): KPI Goals admin component (per-club target %s)"
```

---

## Task 6: Register the KPI Goals admin tile

**Files:**
- Modify: `portal/src/components/AdminPanel.jsx`

- [ ] **Step 1: Import the component**

In `portal/src/components/AdminPanel.jsx`, add to the import block (after the `ReferralRewardsAdmin` import on line ~32):

```jsx
import KpiGoalsAdmin from './admin/KpiGoalsAdmin'
```

- [ ] **Step 2: Add the tile to EXPERIMENTAL_TILES**

In the `EXPERIMENTAL_TILES` array (starts line ~67), add a new entry:

```js
  { key: 'kpi-goals', label: 'KPI Goals', desc: 'Report Targets (Beta)', icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z' },
```

- [ ] **Step 3: Add the render line**

In the active-section render block, add after the `online-join` line (line ~148):

```jsx
        {activeSection === 'kpi-goals' && <KpiGoalsAdmin />}
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd portal && npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/AdminPanel.jsx
git commit -m "feat(portal): register KPI Goals tile in admin Experimental group"
```

---

## Task 7: Final verification and review

**Files:** none (verification only)

- [ ] **Step 1: Run the pure-logic tests**

Run: `node --test portal/src/lib/kpiMath.test.mjs`
Expected: PASS, all tests green.

- [ ] **Step 2: Full production build**

Run: `cd portal && npm run build`
Expected: build succeeds with no errors or new warnings tied to the new files.

- [ ] **Step 3: Manual verification checklist (dev server)**

Run: `cd portal && npm run dev`, log in as an admin, then confirm:
- Reporting page shows an **Experimental** group in the left sidebar with a **KPIs** entry. Log in as a `manager` (or check role gate) and confirm KPIs is NOT visible.
- KPIs report renders three light (`bg-surface`) tiles readable on the dark background: Trial Conversion, Day One Booking, VIP Booking.
- Each tile shows Actual %, Goal %, and a green/red gap badge (or "Set a goal" when unset).
- Clicking a tile expands exactly one trend chart (actual line + dashed red goal line + month labels); clicking another collapses the first.
- Switching the location selector to a single club shows goals; "All Locations" shows "Goal: set per club" and no goal line.
- Admin panel → Experimental Tools → **KPI Goals**: set Salem trial goal to e.g. 65, Save All, reload the KPIs report for Salem, confirm the goal and gap reflect 65%.
- A KPI with zero new memberships in range shows "n/a" (not 0% or a crash).

- [ ] **Step 4: Codex review (per project convention)**

Per the project's review convention, run the Codex CLI in read-only sandbox over the diff (`git diff master...feat/kpis-report`) and address any correctness findings before opening a PR.

- [ ] **Step 5: Final commit (if review produced fixes)**

```bash
git add -A
git commit -m "fix(portal): address KPIs report review feedback"
```

---

## Self-Review Notes (author)

- **Spec coverage:** Experimental group (Task 4), admin/director gate (Task 4 Step 5), three KPIs with the agreed formulas (Task 2/3 `KPI_DEFS`), goals in `app_config` (Task 5/6), per-KPI accordion trend with 6 monthly calls and gap-rendered missing months (Task 3), light cards (Task 2/3 `bg-surface`), all-locations per-club note (Task 2/3), admin KPI Goals tile (Task 5/6), reportInfo copy (Task 4). No new backend route or table. All covered.
- **Type/name consistency:** `goalKey` values (`kpi_goal_trial`/`kpi_goal_dayone`/`kpi_goal_vip`) are identical between `KPI_DEFS` (Task 2) and `GOAL_FIELDS` (Task 5). `goalFor` (Task 2) is reused unchanged in Task 3. `KpiTrendChart` props `{ points, goal }` match the call site.
- **No placeholders:** every code step contains complete code; commands have expected output.
