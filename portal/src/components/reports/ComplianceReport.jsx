import { useState, useEffect, useMemo, useRef } from 'react'
import { getComplianceSummary, getComplianceJobs, getComplianceJobSteps, getCompliancePeople } from '../../lib/api'
import { LOCATION_NAMES } from '../../config/locations'
import { ReportBlock } from './StatBlock'

// Operandio API-sourced job compliance: every job instance with its due time,
// status, who completed it (and every step), and what never got done.

const STATUS_META = {
  on_time: { label: 'On Time', color: '#18CE99' },
  late: { label: 'Late', color: '#F26C4F' },
  missed: { label: 'Missed', color: '#EF4444' },
  in_progress: { label: 'In Progress', color: '#FCD34D' },
  pending: { label: 'Pending', color: '#94A3B8' },
}

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

function dateMinus(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

const QUICK_RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last_7', label: 'Last 7 Days' },
  { key: 'last_30', label: 'Last 30 Days' },
  { key: 'this_month', label: 'This Month' },
]

function getQuickRange(key) {
  const today = todayISO()
  switch (key) {
    case 'today': return { start: today, end: today }
    case 'yesterday': { const y = dateMinus(today, 1); return { start: y, end: y } }
    case 'last_7': return { start: dateMinus(today, 6), end: today }
    case 'last_30': return { start: dateMinus(today, 29), end: today }
    case 'this_month': return { start: today.slice(0, 8) + '01', end: today }
    default: return { start: dateMinus(today, 6), end: today }
  }
}

function fmtDate(s) {
  if (!s) return ''
  return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function cleanJob(name) { return (name || '').replace(/\s*\([^)]*\)/g, '').trim() }

function locName(slug) { return LOCATION_NAMES.find(n => n.toLowerCase() === slug) || slug }

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: meta.color + '1F', color: meta.color }}>
      {meta.label}
    </span>
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

function StackedCountBar({ counts }) {
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

function EmptyRow({ children }) {
  return <p className="text-text-muted text-sm px-5 py-6 text-center">{children}</p>
}

function Heading({ children, sub }) {
  return (
    <div className="px-5 sm:px-6 pt-4 pb-3">
      <h3 className="text-lg font-bold text-text-primary">{children}</h3>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

// Expandable step detail for one job. Fetched on first expand.
function StepDetail({ jobId }) {
  const [steps, setSteps] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getComplianceJobSteps(jobId)
      .then(d => setSteps(d.steps || []))
      .catch(e => setError(e.message || 'Failed to load steps'))
  }, [jobId])

  if (error) return <p className="text-xs text-wcs-red px-5 py-3">{error}</p>
  if (!steps) return <p className="text-xs text-text-muted px-5 py-3">Loading steps...</p>
  if (!steps.length) return <p className="text-xs text-text-muted px-5 py-3">No step detail synced yet for this job.</p>

  return (
    <ul className="divide-y divide-border/60 bg-bg/50">
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
  )
}

function JobRow({ job, showLoc }) {
  const [open, setOpen] = useState(false)
  const assigned = [...(job.assigned_groups || []), ...(job.assigned_users || [])]
  return (
    <li>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-bg/60 transition-colors">
        <span className={`text-text-muted text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
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
      </button>
      {open && <StepDetail jobId={job.id} />}
    </li>
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
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors whitespace-nowrap ${
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

export default function ComplianceReport({ locationSlug }) {
  const initial = getQuickRange('last_7')
  const [activeQuick, setActiveQuick] = useState('last_7')
  const [startDate, setStartDate] = useState(initial.start)
  const [endDate, setEndDate] = useState(initial.end)
  const [summary, setSummary] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [people, setPeople] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('missed')
  const [processFilter, setProcessFilter] = useState('')
  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setLoading(true)
    setError('')
    const params = { start_date: startDate, end_date: endDate, location_slug: locationSlug }
    Promise.all([
      getComplianceSummary(params),
      getComplianceJobs(params),
      getCompliancePeople(params),
    ]).then(([s, j, p]) => {
      if (id !== reqRef.current) return
      setSummary(s); setJobs(j.jobs || []); setPeople(p.people || [])
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

  const showLoc = !locationSlug || locationSlug === 'all'
  const t = summary?.totals

  const lastSync = useMemo(() => {
    const times = (summary?.sync_state || []).map(s => s.last_success_at).filter(Boolean)
    return times.length ? times.sort().at(-1) : null
  }, [summary])

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
    ['missed', 'Not Done'],
    ['late', 'Late'],
    ['all', 'All Jobs'],
    ['people', 'By Person'],
  ]

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <p className="text-xs uppercase tracking-wide text-text-muted font-semibold">Reporting Period</p>
          {lastSync && (
            <p className="text-[11px] text-text-muted">Synced from Operandio {fmtTime(lastSync)}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_RANGES.map(qr => (
              <button key={qr.key} onClick={() => applyQuick(qr.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  activeQuick === qr.key
                    ? 'bg-text-primary text-white border-text-primary'
                    : 'bg-bg text-text-muted border-border hover:text-text-primary'
                }`}>
                {qr.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted">From</label>
            <input type="date" value={startDate} max={todayISO()}
              onChange={e => { setActiveQuick(null); setStartDate(e.target.value) }}
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red" />
            <label className="text-xs text-text-muted">To</label>
            <input type="date" value={endDate} max={todayISO()}
              onChange={e => { setActiveQuick(null); setEndDate(e.target.value) }}
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red" />
          </div>
        </div>
      </div>

      {loading && <p className="loading-card mx-auto block my-6">Loading compliance data...</p>}
      {error && !loading && (
        <div className="bg-surface rounded-xl border border-border px-5 py-6">
          <p className="text-wcs-red text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && summary && (
        <ReportBlock>
          {/* Summary band */}
          <div>
            <Heading sub={summary.on_time_rate != null ? `${summary.on_time_rate}% of decided jobs were done on time` : undefined}>
              Job Compliance
            </Heading>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 pb-4">
              <Stat label="on time" value={t?.on_time} color={STATUS_META.on_time.color} />
              <Stat label="late" value={t?.late} color={STATUS_META.late.color} />
              <Stat label="missed" value={t?.missed} color={STATUS_META.missed.color} />
              <Stat label="in progress" value={t?.in_progress} color={STATUS_META.in_progress.color} />
              <Stat label="pending" value={t?.pending} color={STATUS_META.pending.color} />
            </div>
          </div>

          {/* Per-location breakdown */}
          <div>
            <Heading>By Location</Heading>
            <ul className="divide-y divide-border">
              {Object.entries(summary.by_location || {}).map(([slug, counts]) => {
                const decided = (counts.on_time || 0) + (counts.late || 0) + (counts.missed || 0)
                const rate = decided ? Math.round((counts.on_time / decided) * 100) : null
                return (
                  <li key={slug} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-4 mb-1.5">
                      <p className="text-sm font-semibold text-text-primary">{locName(slug)}</p>
                      <p className="text-sm font-bold text-text-primary">{rate != null ? `${rate}% on time` : '—'}</p>
                    </div>
                    <StackedCountBar counts={counts} />
                  </li>
                )
              })}
              {Object.keys(summary.by_location || {}).length === 0 && (
                <EmptyRow>No synced jobs in this range yet. The sync runs every 15 minutes once enabled.</EmptyRow>
              )}
            </ul>
          </div>

          {/* Jobs / people */}
          <div>
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border">
              <div className="flex gap-1.5">
                {TABS.map(([k, lbl]) => (
                  <button key={k} onClick={() => setView(k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      view === k ? 'bg-text-primary text-white border-text-primary' : 'bg-bg text-text-muted border-border hover:text-text-primary'
                    }`}>
                    {lbl}
                    {k === 'missed' && t?.missed ? ` (${t.missed})` : ''}
                    {k === 'late' && t?.late ? ` (${t.late})` : ''}
                  </button>
                ))}
              </div>
              {view !== 'people' && (
                <input
                  type="text"
                  value={processFilter}
                  onChange={e => setProcessFilter(e.target.value)}
                  placeholder="Filter by job name..."
                  className="ml-auto px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red w-48"
                />
              )}
            </div>

            {view === 'people'
              ? <PeopleView people={people} showLoc={showLoc} />
              : filteredJobs.length
                ? (
                  <ul className="divide-y divide-border">
                    {filteredJobs.map(j => <JobRow key={j.id} job={j} showLoc={showLoc} />)}
                  </ul>
                )
                : <EmptyRow>
                    {view === 'missed' ? 'Nothing missed in this range. Everything got done.' : 'No jobs match.'}
                  </EmptyRow>}
          </div>
        </ReportBlock>
      )}
    </div>
  )
}
