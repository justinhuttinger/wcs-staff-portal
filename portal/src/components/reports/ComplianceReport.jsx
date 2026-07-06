import { useState, useEffect, useMemo, useRef } from 'react'
import { getComplianceSummary, getComplianceJobs, getCompliancePeople, getComplianceJobSteps } from '../../lib/api'
import { LOCATION_NAMES } from '../../config/locations'
import { ReportBlock } from './StatBlock'

// Operandio API-sourced job compliance, laid out to mirror the (email-based)
// Operational Compliance report section-for-section so the two can be
// compared side by side: Reporting Period card -> Period Summary -> Daily
// Trend -> Job Compliance tabs. Unlike the email report this drills all the
// way down to per-step who/when/response.

const STATUS_META = {
  on_time: { label: 'On-time', color: '#18CE99' },
  late: { label: 'Late', color: '#F26C4F' },
  missed: { label: 'Missed', color: '#EF4444' },
  in_progress: { label: 'In Progress', color: '#FCD34D' },
  pending: { label: 'Pending', color: '#DEF1FA' },
}

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

function dateMinus(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function rangeLengthDays(start, end) {
  const s = new Date(start + 'T00:00:00Z').getTime()
  const e = new Date(end + 'T00:00:00Z').getTime()
  return Math.round((e - s) / 86400000) + 1
}

// Same quick ranges as Operational Compliance (plus Today — the API data is
// live, not yesterday's email snapshot).
const QUICK_RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last_7', label: 'Last 7 Days' },
  { key: 'last_30', label: 'Last 30 Days' },
  { key: 'last_90', label: 'Last 90 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
]

function getQuickRange(key) {
  const today = todayISO()
  const yesterday = dateMinus(today, 1)
  const now = new Date()
  switch (key) {
    case 'today': return { start: today, end: today }
    case 'yesterday': return { start: yesterday, end: yesterday }
    case 'last_7': return { start: dateMinus(today, 6), end: today }
    case 'last_30': return { start: dateMinus(today, 29), end: today }
    case 'last_90': return { start: dateMinus(today, 89), end: today }
    case 'this_month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      return { start: s, end: today }
    }
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10)
      const e = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10)
      return { start: s, end: e }
    }
    default: return { start: dateMinus(today, 6), end: today }
  }
}

function fmtDate(s) {
  const d = new Date(s + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function cleanJob(name) { return (name || '').replace(/\s*\([^)]*\)/g, '').trim() }
function locName(slug) { return LOCATION_NAMES.find(n => n.toLowerCase() === slug) || slug }
function pctColor(p) { return p >= 85 ? '#18CE99' : p >= 60 ? '#FCD34D' : '#F26C4F' }

// ---------------------------------------------------------------------------
// Aggregation (client-side, from the raw job instances)
// ---------------------------------------------------------------------------

const zeroCounts = () => ({ on_time: 0, late: 0, missed: 0, in_progress: 0, pending: 0 })

// Roll up a set of job rows: counts + completion % of decided jobs.
// "Decided" = on_time + late + missed (past-due outcome known). Pending /
// in-progress jobs aren't due yet so they don't drag the percentage.
function aggregate(rows) {
  const counts = zeroCounts()
  for (const r of rows) counts[r.compliance_status] = (counts[r.compliance_status] || 0) + 1
  const decided = counts.on_time + counts.late + counts.missed
  return {
    counts,
    decided,
    completion_pct: decided ? ((counts.on_time + counts.late) / decided) * 100 : null,
    on_time_pct: decided ? (counts.on_time / decided) * 100 : null,
  }
}

function groupBy(rows, keyFn) {
  const out = {}
  for (const r of rows) {
    const k = keyFn(r)
    if (!out[k]) out[k] = []
    out[k].push(r)
  }
  return out
}

// ---------------------------------------------------------------------------
// Shared visual bits (mirrors OperationsReport)
// ---------------------------------------------------------------------------

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
      {['on_time', 'late', 'missed', 'in_progress', 'pending'].map(k => (
        <div key={k} className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: STATUS_META[k].color }} />
          {STATUS_META[k].label}
        </div>
      ))}
    </div>
  )
}

function StackedBar({ counts }) {
  const order = ['on_time', 'late', 'missed', 'in_progress', 'pending']
  const total = order.reduce((n, k) => n + (counts[k] || 0), 0)
  if (!total) return <div className="h-3 rounded-full bg-bg" />
  return (
    <div className="flex h-3 rounded-full overflow-hidden bg-bg">
      {order.map(k => (counts[k] || 0) > 0 && (
        <div key={k} title={`${STATUS_META[k].label}: ${counts[k]}`}
          style={{ width: `${(counts[k] / total) * 100}%`, backgroundColor: STATUS_META[k].color }} />
      ))}
    </div>
  )
}

function DeltaChip({ current, previous }) {
  if (current == null || previous == null) return null
  const delta = current - previous
  if (Math.abs(delta) < 0.05) return <span className="text-[11px] text-text-muted">no change</span>
  const isUp = delta > 0
  const cls = isUp ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      <span>{isUp ? '▲' : '▼'}</span>
      <span>{isUp ? '+' : ''}{delta.toFixed(1)}%</span>
    </span>
  )
}

function Sparkline({ rowsByDay, dateRange }) {
  const days = []
  let d = dateRange.start
  while (d <= dateRange.end) {
    days.push(d)
    d = dateMinus(d, -1)
  }
  if (days.length === 0) return null
  return (
    <div className="flex items-end gap-0.5 h-12 mt-2">
      {days.map(day => {
        const agg = rowsByDay[day] ? aggregate(rowsByDay[day]) : null
        const pct = agg?.completion_pct
        const h = pct != null ? Math.max(2, pct) : 0
        const bg = pct != null ? (pct >= 70 ? '#18CE99' : pct >= 40 ? '#FCD34D' : '#F26C4F') : '#E5E7EB'
        return (
          <div
            key={day}
            title={pct != null ? `${fmtDate(day)} — ${pct.toFixed(0)}% completed (${agg.decided} due)` : `${fmtDate(day)} — no jobs due`}
            className="flex-1 rounded-t-sm"
            style={{ height: `${h}%`, backgroundColor: bg, minWidth: '4px' }}
          />
        )
      })}
    </div>
  )
}

function TrendLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
      <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#18CE99' }} />70%+ on track</div>
      <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#FCD34D' }} />40–69% needs attention</div>
      <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#F26C4F' }} />below 40% at risk</div>
      <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#E5E7EB' }} />no data</div>
    </div>
  )
}

function Heading({ children }) {
  return (
    <div className="px-5 sm:px-6 pt-4 pb-3">
      <h3 className="text-lg font-bold text-text-primary">{children}</h3>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className="flex items-center gap-2">
      {color && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />}
      <span className="text-lg font-bold text-text-primary">{value ?? 0}</span>
      <span className="text-xs text-text-muted">{label}</span>
    </div>
  )
}

function CountTag({ color, n, title }) {
  return (
    <span title={title} className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded text-[11px] font-semibold"
      style={{ backgroundColor: color + '1A', color }}>{n}</span>
  )
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending
  const muted = status === 'pending'
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: meta.color + (muted ? '' : '1F'), color: muted ? '#64748B' : meta.color }}>
      {meta.label}
    </span>
  )
}

function EmptyRow({ children }) {
  return <p className="text-text-muted text-sm px-5 py-6 text-center">{children}</p>
}

// ---------------------------------------------------------------------------
// Step drill-down
// ---------------------------------------------------------------------------

function StepDetail({ jobId }) {
  const [steps, setSteps] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getComplianceJobSteps(jobId)
      .then(d => setSteps(d.steps || []))
      .catch(e => setError(e.message || 'Failed to load steps'))
  }, [jobId])

  if (error) return <p className="text-xs text-wcs-red px-5 py-3 bg-bg/50">{error}</p>
  if (!steps) return <p className="text-xs text-text-muted px-5 py-3 bg-bg/50">Loading steps...</p>
  if (!steps.length) return <p className="text-xs text-text-muted px-5 py-3 bg-bg/50">No step detail synced yet for this job — the next sync (within 15 min) should fill it in.</p>

  const doneCount = steps.filter(s => s.completed_at).length
  return (
    <div className="bg-bg/50 border-t border-border/60">
      <p className="px-5 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        Step breakdown — {doneCount}/{steps.length} completed
      </p>
      <ul className="divide-y divide-border/60">
      {steps.map(s => {
        const done = !!s.completed_at
        return (
          <li key={s.step_instance_id} className="px-5 py-2 flex items-start gap-3">
            <span className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0 ${
              done ? 'bg-emerald-500 text-white' : s.skip ? 'bg-blue-500 text-white' : 'bg-border text-text-muted'
            }`}>
              {done ? '✓' : s.skip ? '»' : ''}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-medium ${done || s.skip ? 'text-text-primary' : 'text-text-muted'}`}>
                {s.name}
                {s.skip && <span className="ml-2 text-blue-600 font-semibold">skipped</span>}
                {s.failed && <span className="ml-2 text-red-600 font-semibold">failed</span>}
                {!done && !s.skip && <span className="ml-2 text-red-500/80 font-semibold">not done</span>}
              </p>
              {s.response && (
                <p className="text-[11px] text-text-muted mt-0.5 break-words">
                  <span className="font-semibold">{s.response_type === 'number' ? 'Value' : 'Response'}:</span> {s.response}
                </p>
              )}
              {(s.notes || []).map((n, i) => (
                <p key={i} className="text-[11px] text-text-muted italic mt-0.5">“{n.text}” — {n.author || 'unknown'}</p>
              ))}
            </div>
            <div className="text-right shrink-0">
              {done && (
                <>
                  <p className="text-[11px] font-semibold text-text-primary">{s.completed_by || '—'}</p>
                  <p className="text-[10px] text-text-muted">{fmtTime(s.completed_at)}</p>
                </>
              )}
              {s.score != null && s.possible_score > 0 && (
                <p className="text-[10px] text-text-muted">{s.score}/{s.possible_score} pts</p>
              )}
            </div>
          </li>
        )
      })}
      </ul>
    </div>
  )
}

function JobRow({ job, showLoc }) {
  const [open, setOpen] = useState(false)
  const assigned = [...(job.assigned_groups || []), ...(job.assigned_users || [])]
  return (
    <li>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-3 text-left cursor-pointer hover:bg-bg/60 transition-colors">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary truncate">{cleanJob(job.display_name || job.process_name)}</p>
          <p className="text-[11px] text-text-muted truncate">
            {showLoc ? locName(job.location_slug) + ' · ' : ''}
            due {fmtTime(job.due_at)}
            {assigned.length > 0 && <> · assigned: {assigned.join(', ')}</>}
          </p>
        </div>
        <div className="text-right shrink-0 hidden sm:block">
          {job.completed_by
            ? <>
                <p className="text-[11px] font-semibold text-text-primary">{job.completed_by}</p>
                <p className="text-[10px] text-text-muted">{fmtTime(job.completed_at)}</p>
              </>
            : <p className="text-[11px] text-text-muted">{Math.round(job.percent_complete || 0)}% complete</p>}
        </div>
        <StatusPill status={job.compliance_status} />
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium whitespace-nowrap transition-colors ${
          open ? 'bg-text-primary text-white border-text-primary' : 'bg-bg text-text-muted border-border'
        }`}>
          Steps
          <span className={`text-[9px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        </span>
      </button>
      {open && <StepDetail jobId={job.id} />}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Job Compliance tab views
// ---------------------------------------------------------------------------

// Aggregated per job name — mirrors the email report's "By Job" rows.
function ByJobView({ jobs, showLoc }) {
  const grouped = groupBy(jobs, j => `${cleanJob(j.display_name || j.process_name)}|${j.location_slug}`)
  const rows = Object.values(grouped).map(list => {
    const agg = aggregate(list)
    return {
      name: cleanJob(list[0].display_name || list[0].process_name),
      location_slug: list[0].location_slug,
      ...agg.counts,
      total: agg.decided,
      done: agg.counts.on_time + agg.counts.late,
      completion_pct: agg.completion_pct,
    }
  }).filter(r => r.total > 0).sort((a, b) => (a.completion_pct ?? 101) - (b.completion_pct ?? 101))
  if (!rows.length) return <EmptyRow>No jobs came due in this range.</EmptyRow>
  return (
    <ul className="divide-y divide-border">
      {rows.map((j, i) => (
        <li key={i} className="flex items-center gap-4 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-primary truncate">{j.name}</p>
            {showLoc && <p className="text-[11px] text-text-muted">{locName(j.location_slug)}</p>}
          </div>
          <div className="flex items-center gap-1.5">
            <CountTag color="#18CE99" n={j.on_time} title="on time" />
            <CountTag color="#F26C4F" n={j.late} title="late" />
            <CountTag color="#EF4444" n={j.missed} title="missed" />
          </div>
          <div className="w-44 flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-bg overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${j.completion_pct}%`, backgroundColor: pctColor(j.completion_pct) }} />
            </div>
            <span className="text-xs font-bold text-text-primary whitespace-nowrap" title="done out of due (on-time + late)">
              {j.done}/{j.total} · {Math.round(j.completion_pct)}%
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

function PeopleView({ people, showLoc }) {
  const [sort, setSort] = useState('top')
  if (!people?.length) return <EmptyRow>No completions recorded in this range.</EmptyRow>
  const sorted = [...people].sort((a, b) =>
    sort === 'top' ? b.steps_completed - a.steps_completed : a.steps_completed - b.steps_completed)
  return (
    <>
      <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-border">
        <span className="text-[11px] uppercase tracking-wide text-text-muted font-semibold mr-1">Show</span>
        {[['top', 'Top completers'], ['least', 'Least completers']].map(([k, lbl]) => (
          <button key={k} type="button" onClick={() => setSort(k)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors whitespace-nowrap cursor-pointer ${
              sort === k ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'
            }`}>
            {lbl}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-border">
        {sorted.map(p => (
          <li key={p.name} className="flex items-center gap-4 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary truncate">{p.name}</p>
              {showLoc && <p className="text-[11px] text-text-muted">{(p.locations || []).map(locName).join(', ')}</p>}
            </div>
            <div className="flex items-center gap-4 text-xs whitespace-nowrap">
              <span className="text-text-primary font-semibold">{p.jobs_completed} <span className="text-text-muted font-normal">jobs</span></span>
              <span className="text-text-primary font-semibold">{p.steps_completed} <span className="text-text-muted font-normal">steps</span></span>
              <span className={`font-semibold ${p.late_jobs_completed ? 'text-orange-600' : 'text-text-muted'}`}>
                {p.late_jobs_completed} <span className="text-text-muted font-normal">late</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export default function ComplianceReport({ locationSlug }) {
  const initial = getQuickRange('last_7')
  const [activeQuick, setActiveQuick] = useState('last_7')
  const [startDate, setStartDate] = useState(initial.start)
  const [endDate, setEndDate] = useState(initial.end)
  const [summary, setSummary] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [prevJobs, setPrevJobs] = useState(null)
  const [people, setPeople] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('jobs')
  const [processFilter, setProcessFilter] = useState('')
  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setLoading(true)
    setError('')
    const len = rangeLengthDays(startDate, endDate)
    const prevEnd = dateMinus(startDate, 1)
    const prevStart = dateMinus(prevEnd, len - 1)
    const params = { start_date: startDate, end_date: endDate, location_slug: locationSlug }
    Promise.all([
      getComplianceSummary(params),
      getComplianceJobs(params),
      getComplianceJobs({ start_date: prevStart, end_date: prevEnd, location_slug: locationSlug }),
      getCompliancePeople(params),
    ]).then(([s, j, pj, p]) => {
      if (id !== reqRef.current) return
      setSummary(s); setJobs(j.jobs || []); setPrevJobs(pj.jobs || []); setPeople(p.people || [])
      setLoading(false)
    }).catch(e => {
      if (id !== reqRef.current) return
      setError(e.message || 'Failed to load compliance data')
      setLoading(false)
    })
  }, [startDate, endDate, locationSlug])

  function applyQuick(key) {
    setActiveQuick(key)
    const r = getQuickRange(key)
    setStartDate(r.start); setEndDate(r.end)
  }

  function handleDateChange(field, value) {
    setActiveQuick(null)
    if (field === 'start') setStartDate(value)
    else setEndDate(value)
  }

  const showLoc = !locationSlug || locationSlug === 'all'

  const lastSync = useMemo(() => {
    const times = (summary?.sync_state || []).map(s => s.last_success_at).filter(Boolean)
    return times.length ? times.sort().at(-1) : null
  }, [summary])

  const grouped = useMemo(() => groupBy(jobs || [], j => j.location_slug), [jobs])
  const prevGrouped = useMemo(() => groupBy(prevJobs || [], j => j.location_slug), [prevJobs])

  const slugs = useMemo(() => {
    const all = LOCATION_NAMES.map(n => n.toLowerCase())
    if (locationSlug && locationSlug !== 'all') return all.filter(s => s === locationSlug)
    return all
  }, [locationSlug])

  const totals = useMemo(() => aggregate(jobs || []), [jobs])

  const filteredJobs = useMemo(() => {
    let rows = jobs || []
    if (view === 'missed') rows = rows.filter(j => j.compliance_status === 'missed')
    if (view === 'late') rows = rows.filter(j => j.compliance_status === 'late')
    if (processFilter) {
      const q = processFilter.toLowerCase()
      rows = rows.filter(j => (j.display_name || j.process_name || '').toLowerCase().includes(q))
    }
    return rows
  }, [jobs, view, processFilter])

  const TABS = [
    ['jobs', 'By Job'],
    ['people', 'By Person'],
    ['missed', 'Not Done'],
    ['late', 'Late'],
    ['all', 'All Jobs'],
  ]

  return (
    <div className="space-y-4">
      {/* ---------- Reporting Period (mirrors Operational Compliance) ---------- */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-3">
            <p className="text-xs uppercase tracking-wide text-text-muted font-semibold">Reporting Period</p>
            {lastSync && <p className="text-[11px] text-text-muted">Synced from Operandio {fmtTime(lastSync)}</p>}
          </div>
          <Legend />
        </div>
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_RANGES.map(qr => (
              <button
                key={qr.key}
                onClick={() => applyQuick(qr.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  activeQuick === qr.key
                    ? 'bg-text-primary text-white border-text-primary'
                    : 'bg-bg text-text-muted border-border hover:text-text-primary'
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
              max={todayISO()}
              onChange={e => handleDateChange('start', e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
            <label className="text-xs text-text-muted">To</label>
            <input
              type="date"
              value={endDate}
              max={todayISO()}
              onChange={e => handleDateChange('end', e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
          </div>
        </div>
      </div>

      {loading && <p className="loading-card mx-auto block my-6">Loading compliance data...</p>}
      {error && !loading && (
        <div className="bg-surface rounded-xl border border-border px-5 py-6">
          <p className="text-wcs-red text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <ReportBlock>
          {/* ---------- Period Summary ---------- */}
          <div>
            <Heading>Period Summary</Heading>
            <ul className="divide-y divide-border">
              {slugs.map(slug => {
                const rows = grouped[slug] || []
                const agg = aggregate(rows)
                const prevAgg = aggregate(prevGrouped[slug] || [])
                const displayName = locName(slug)

                if (!rows.length) {
                  return (
                    <li key={slug} className="flex items-center justify-between gap-4 px-5 py-4">
                      <p className="text-sm font-semibold text-text-primary">{displayName}</p>
                      <span className="text-xs text-text-muted">No data in range</span>
                    </li>
                  )
                }

                return (
                  <li key={slug} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-4 mb-2">
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{displayName}</p>
                        <p className="text-[11px] text-text-muted">{agg.decided} job{agg.decided === 1 ? '' : 's'} due in range</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <DeltaChip current={agg.completion_pct} previous={prevAgg.completion_pct} />
                        <span
                          className="text-2xl font-bold text-text-primary cursor-help"
                          title="Completed % = jobs done (on-time + late) out of jobs that came due. Pending / in-progress jobs aren't counted yet."
                        >
                          {agg.completion_pct != null ? `${agg.completion_pct.toFixed(0)}%` : '—'}
                        </span>
                      </div>
                    </div>
                    <StackedBar counts={agg.counts} />
                  </li>
                )
              })}
            </ul>
          </div>

          {/* ---------- Daily Trend ---------- */}
          <div>
            <Heading>Daily Trend</Heading>
            <div className="px-5 pb-3">
              <TrendLegend />
            </div>
            <ul className="divide-y divide-border">
              {slugs.map(slug => {
                const rows = grouped[slug] || []
                if (!rows.length) return null
                const byDay = groupBy(rows, r => r.job_date)
                return (
                  <li key={slug} className="px-5 py-4">
                    <p className="text-sm font-semibold text-text-primary mb-3">{locName(slug)}</p>
                    <Sparkline rowsByDay={byDay} dateRange={{ start: startDate, end: endDate }} />
                  </li>
                )
              })}
            </ul>
          </div>

          {/* ---------- Job Compliance ---------- */}
          <div>
            <Heading>Job Compliance</Heading>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 border-b border-border">
              <Stat label="on time" value={totals.counts.on_time} color={STATUS_META.on_time.color} />
              <Stat label="late" value={totals.counts.late} color={STATUS_META.late.color} />
              <Stat label="missed" value={totals.counts.missed} color={STATUS_META.missed.color} />
              <Stat label="in progress" value={totals.counts.in_progress} color={STATUS_META.in_progress.color} />
              <Stat label="pending" value={totals.counts.pending} color="#94A3B8" />
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {TABS.map(([k, lbl]) => (
                  <button
                    key={k}
                    onClick={() => setView(k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      view === k ? 'bg-text-primary text-white border-text-primary' : 'bg-bg text-text-muted border-border hover:text-text-primary'
                    }`}
                  >
                    {lbl}
                    {k === 'missed' && totals.counts.missed ? ` (${totals.counts.missed})` : ''}
                    {k === 'late' && totals.counts.late ? ` (${totals.counts.late})` : ''}
                  </button>
                ))}
              </div>
            </div>

            {view !== 'jobs' && view !== 'people' && (
              <div className="px-5 py-2.5 border-b border-border">
                <input
                  type="text"
                  value={processFilter}
                  onChange={e => setProcessFilter(e.target.value)}
                  placeholder="Filter by job name..."
                  className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red w-56"
                />
              </div>
            )}

            {view === 'jobs' && <ByJobView jobs={jobs || []} showLoc={showLoc} />}
            {view === 'people' && <PeopleView people={people} showLoc={showLoc} />}
            {(view === 'missed' || view === 'late' || view === 'all') && (
              filteredJobs.length
                ? (
                  <ul className="divide-y divide-border">
                    {filteredJobs.map(j => <JobRow key={j.id} job={j} showLoc={showLoc} />)}
                  </ul>
                )
                : <EmptyRow>
                    {view === 'missed' ? 'Nothing missed in this range. Everything got done.' : 'No jobs match.'}
                  </EmptyRow>
            )}
          </div>
        </ReportBlock>
      )}
    </div>
  )
}
