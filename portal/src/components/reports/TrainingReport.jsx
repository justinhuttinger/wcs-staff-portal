import { useEffect, useMemo, useState } from 'react'
import { getTrainingSummary, getTrainingPeople, getTrainingCourses } from '../../lib/api'
import { exportCSV } from '../../lib/export'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatBlock, StatCell } from './StatBlock'
import { LOCATION_NAMES } from '../../config/locations'

// ---------------------------------------------------------------------------
// Training — Operandio, per club and per person.
//
// NO DATE RANGE, and the report says so on the page. Every other report here
// answers "what happened between these dates"; this one answers "where do we
// stand right now", and an assignment that went overdue in August is still
// overdue today. Putting a date picker on it would invite the reading that
// August's misses stop counting in September, which is exactly backwards.
//
// THREE STATES FOR A PERSON, NOT TWO. Caught up, behind, and nothing assigned.
// The third is not a rounding case: at the time of writing 85 of 133 staff have
// no training assigned at all, and two whole clubs have none. Folding those
// into "caught up" would show a club that has never been given a course as
// perfect, which is the one answer this report must never give.
// ---------------------------------------------------------------------------

const CLUB_LABEL = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))
const clubName = slug => CLUB_LABEL[slug] || (slug ? slug[0].toUpperCase() + slug.slice(1) : slug)

const STATUS_LABEL = {
  complete: 'Complete',
  overdue: 'Overdue',
  in_progress: 'In Progress',
  not_started: 'Not Started',
}

// Semantic, and separate from the report accent: these encode state, not brand.
const STATUS_STYLE = {
  complete:    'bg-green-100 text-green-800 border-green-200',
  overdue:     'bg-red-100 text-red-800 border-red-200',
  in_progress: 'bg-amber-100 text-amber-800 border-amber-200',
  not_started: 'bg-gray-100 text-gray-700 border-gray-200',
}

const PERSON_STATE = {
  behind:     { label: 'Behind',          style: 'bg-red-100 text-red-800 border-red-200' },
  unassigned: { label: 'Nothing assigned', style: 'bg-gray-100 text-gray-700 border-gray-200' },
  caught_up:  { label: 'Caught up',       style: 'bg-green-100 text-green-800 border-green-200' },
}

function Pill({ label, style }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${style}`}>
      {label}
    </span>
  )
}

/** A date, or an em dash. Operandio timestamps are UTC instants. */
function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** How late, in whole days, for something still not done. */
function daysOverdue(iso) {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return days > 0 ? days : null
}

function Progress({ percent }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0))
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-16 h-1.5 rounded-full bg-bg border border-border overflow-hidden">
        <span className="block h-full rounded-full bg-wcs-red/70" style={{ width: `${p}%` }} />
      </span>
      <span className="tabular-nums text-xs text-text-muted w-8 text-right">{p}%</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// By club
// ---------------------------------------------------------------------------

function ByClub({ rows }) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-text-muted py-8 text-center">No staff in this selection.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
            <th className="text-left py-2 px-3 font-semibold">Club</th>
            <th className="text-right py-2 px-3 font-semibold">Staff</th>
            <th className="text-right py-2 px-3 font-semibold">Caught Up</th>
            <th className="text-right py-2 px-3 font-semibold">Behind</th>
            <th className="text-right py-2 px-3 font-semibold">Nothing Assigned</th>
            <th className="text-right py-2 px-3 font-semibold">Overdue</th>
            <th className="text-right py-2 px-3 font-semibold">Complete</th>
            <th className="text-right py-2 px-3 font-semibold">% of Due Work</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.location_slug} className="border-b border-border/60">
              <td className="py-2 px-3 text-text-primary font-medium">{clubName(r.location_slug)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{r.people}</td>
              <td className="py-2 px-3 text-right tabular-nums text-green-700">{r.people_caught_up}</td>
              <td className={`py-2 px-3 text-right tabular-nums ${r.people_behind > 0 ? 'text-wcs-red font-semibold' : 'text-text-muted'}`}>
                {r.people_behind}
              </td>
              {/* Not a compliance failure and not a pass. A club showing its
                  whole roster here has never been given anything to do. */}
              <td className={`py-2 px-3 text-right tabular-nums ${r.people_unassigned === r.people && r.people > 0 ? 'text-amber-700 font-semibold' : 'text-text-muted'}`}>
                {r.people_unassigned}
              </td>
              <td className="py-2 px-3 text-right tabular-nums">{r.overdue}</td>
              <td className="py-2 px-3 text-right tabular-nums">{r.complete}</td>
              <td className="py-2 px-3 text-right tabular-nums font-semibold text-text-primary">
                {r.percent_complete == null ? '—' : `${r.percent_complete}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* The dash is load-bearing: a club with nothing due has no rate, which is
          a different statement from 0% and from 100%. */}
      <p className="text-[11px] text-text-muted mt-3 px-3">
        % of Due Work counts finished assignments against the ones whose due date has passed.
        A club with nothing due yet shows a dash rather than a score.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// By person
// ---------------------------------------------------------------------------

function PersonRow({ person, expanded, onToggle }) {
  const canExpand = person.assignments.length > 0
  const state = PERSON_STATE[person.state] || PERSON_STATE.caught_up
  return (
    <>
      <tr
        className={`border-b border-border/60 ${canExpand ? 'cursor-pointer hover:bg-bg' : ''}`}
        onClick={canExpand ? onToggle : undefined}
      >
        <td className="py-2 px-3">
          <span className="inline-flex items-center gap-2">
            <span className="text-text-muted text-[10px] w-2" aria-hidden="true">
              {canExpand ? (expanded ? '▼' : '▶') : ''}
            </span>
            <span className="text-text-primary font-medium">{person.full_name || '—'}</span>
          </span>
        </td>
        <td className="py-2 px-3 text-text-muted">{(person.locations || []).map(clubName).join(', ') || '—'}</td>
        <td className="py-2 px-3"><Pill label={state.label} style={state.style} /></td>
        <td className="py-2 px-3 text-right tabular-nums">{person.counts.total}</td>
        <td className="py-2 px-3 text-right tabular-nums">{person.counts.complete}</td>
        <td className={`py-2 px-3 text-right tabular-nums ${person.counts.overdue > 0 ? 'text-wcs-red font-semibold' : 'text-text-muted'}`}>
          {person.counts.overdue}
        </td>
      </tr>
      {expanded && person.assignments.map(a => {
        const late = a.status === 'overdue' ? daysOverdue(a.due_at) : null
        return (
          <tr key={a.id} className="border-b border-border/40 bg-bg/40">
            <td className="py-1.5 px-3 pl-9 text-text-primary">
              {a.course_name || '—'}
              {a.course_type === 'observation' && (
                <span className="ml-2 text-[10px] text-text-muted border border-border rounded px-1">observation</span>
              )}
            </td>
            <td className="py-1.5 px-3 text-xs text-text-muted">
              {/* Assigned is derived from the assignment id, not reported by
                  Operandio. Marked so nobody takes it for a first-class field. */}
              Assigned {fmtDate(a.assigned_at)}
              <span className="ml-1 text-[10px] opacity-70" title="Derived from the assignment id; Operandio does not report an assigned date">*</span>
              {' · '}Due {fmtDate(a.due_at)}
              {late != null && <span className="text-wcs-red font-semibold"> · {late}d late</span>}
            </td>
            <td className="py-1.5 px-3">
              <Pill label={STATUS_LABEL[a.status] || a.status} style={STATUS_STYLE[a.status] || STATUS_STYLE.not_started} />
            </td>
            <td className="py-1.5 px-3" colSpan={3}>
              {a.status === 'complete'
                ? <span className="text-xs text-text-muted">Completed {fmtDate(a.completed_at)}</span>
                : <Progress percent={a.percent_complete} />}
            </td>
          </tr>
        )
      })}
    </>
  )
}

function ByPerson({ people, search, setSearch }) {
  const [openId, setOpenId] = useState(null)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return people
    return people.filter(p => String(p.full_name || '').toLowerCase().includes(q))
  }, [people, search])

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <input
          id="training-person-search"
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search staff"
          className="px-3 py-1.5 text-sm rounded-lg border border-border bg-surface min-w-[200px]"
        />
        <p className="text-[11px] text-text-muted">
          Behind first, then staff with nothing assigned. Click a row for their courses.
        </p>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted py-8 text-center">Nobody matches.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                <th className="text-left py-2 px-3 font-semibold">Staff</th>
                <th className="text-left py-2 px-3 font-semibold">Club</th>
                <th className="text-left py-2 px-3 font-semibold">Status</th>
                <th className="text-right py-2 px-3 font-semibold">Assigned</th>
                <th className="text-right py-2 px-3 font-semibold">Done</th>
                <th className="text-right py-2 px-3 font-semibold">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <PersonRow
                  key={p.user_id}
                  person={p}
                  expanded={openId === p.user_id}
                  onToggle={() => setOpenId(openId === p.user_id ? null : p.user_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

const TABS = [
  { key: 'club', label: 'By Club' },
  { key: 'person', label: 'By Person' },
]

export default function TrainingReport({ locationSlug }) {
  const [tab, setTab] = useState('club')
  const [courseId, setCourseId] = useState('all')
  const [status, setStatus] = useState('all')
  const [includeRetired, setIncludeRetired] = useState(false)
  const [search, setSearch] = useState('')

  // Every hook above the guards, deliberately. A hook below them changes the
  // hook count between the loading render and the loaded one, which is what
  // white-screened the Day One report.
  const params = useMemo(() => ({
    location_slug: locationSlug || 'all',
    course_id: courseId,
    status,
    include_retired: includeRetired ? '1' : '',
  }), [locationSlug, courseId, status, includeRetired])

  const summary = useCancellableFetch(
    signal => getTrainingSummary(params, { cache: true, signal }), [params])
  const peopleRes = useCancellableFetch(
    signal => getTrainingPeople(params, { cache: true, signal }), [params])
  const coursesRes = useCancellableFetch(
    signal => getTrainingCourses(
      { location_slug: locationSlug || 'all', include_retired: includeRetired ? '1' : '' },
      { cache: true, signal }), [locationSlug, includeRetired])

  // A course filter pointing at a course the current club has never been given
  // would silently empty the report, so it falls back rather than stranding.
  const courses = coursesRes.data?.courses || []
  useEffect(() => {
    if (courseId !== 'all' && courses.length && !courses.some(c => c.id === courseId)) {
      setCourseId('all')
    }
  }, [courseId, courses])

  if (summary.loading || peopleRes.loading) return <DesktopLoading variant="report" />

  const err = summary.error || peopleRes.error
  if (err) return <p className="text-wcs-red text-sm py-4">{err.message || String(err)}</p>

  const totals = summary.data?.totals
  const byLocation = summary.data?.by_location || []
  const people = peopleRes.data?.people || []

  function handleExport() {
    const rows = [
      ['Staff', 'Clubs', 'State', 'Course', 'Type', 'Assigned (derived)', 'Due', 'Status', 'Percent', 'Completed'],
    ]
    for (const p of people) {
      if (p.assignments.length === 0) {
        rows.push([p.full_name, (p.locations || []).map(clubName).join(' / '), 'Nothing assigned', '', '', '', '', '', '', ''])
        continue
      }
      for (const a of p.assignments) {
        rows.push([
          p.full_name, (p.locations || []).map(clubName).join(' / '), PERSON_STATE[p.state]?.label || p.state,
          a.course_name || '', a.course_type || '',
          a.assigned_at ? a.assigned_at.slice(0, 10) : '',
          a.due_at ? a.due_at.slice(0, 10) : '',
          STATUS_LABEL[a.status] || a.status,
          a.percent_complete ?? '',
          a.completed_at ? a.completed_at.slice(0, 10) : '',
        ])
      }
    }
    exportCSV(rows, `training-${new Date().toISOString().slice(0, 10)}`)
  }

  return (
    <div className="space-y-6">
      <StatBlock cols={5}>
        <StatCell label="Behind" value={totals?.people_behind ?? 0} sub="Staff with something overdue" />
        <StatCell label="Caught Up" value={totals?.people_caught_up ?? 0} sub="Nothing overdue" />
        <StatCell label="Nothing Assigned" value={totals?.people_unassigned ?? 0} sub="No training given" />
        <StatCell label="Overdue" value={totals?.overdue ?? 0} sub="Assignments past due" />
        <StatCell
          label="% of Due Work"
          value={totals?.percent_complete == null ? '—' : `${totals.percent_complete}%`}
          sub="Finished vs. come due"
        />
      </StatBlock>

      {/* Filters. Club lives on the report header with the other reports'. */}
      <div className="bg-surface rounded-xl border border-border p-3 flex flex-wrap items-center gap-3">
        <label className="text-xs text-text-muted" htmlFor="training-course">Course</label>
        <select
          id="training-course"
          value={courseId}
          onChange={e => setCourseId(e.target.value)}
          className="px-2 py-1.5 text-sm rounded-lg border border-border bg-surface max-w-[260px]"
        >
          <option value="all">All courses</option>
          {courses.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}{c.inactive ? ' (retired)' : ''}{c.assignments ? ` — ${c.assignments}` : ''}
            </option>
          ))}
        </select>

        <label className="text-xs text-text-muted" htmlFor="training-status">Status</label>
        <select
          id="training-status"
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-2 py-1.5 text-sm rounded-lg border border-border bg-surface"
        >
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        <label className="flex items-center gap-1.5 text-xs text-text-muted" htmlFor="training-retired">
          <input
            id="training-retired"
            type="checkbox"
            checked={includeRetired}
            onChange={e => setIncludeRetired(e.target.checked)}
          />
          Include retired courses
        </label>

        <div className="flex-1" />

        <button onClick={handleExport} className="text-xs px-2 py-1 rounded border border-border hover:bg-bg">
          Export CSV
        </button>
      </div>

      {/* Said once, plainly: this report is not about a date range. */}
      <p className="text-[11px] text-text-muted px-1">
        Where training stands right now, not over a date range — something that went overdue in
        August is still overdue today.
        {summary.data?.synced_at && <> Synced {fmtDate(summary.data.synced_at)}.</>}
        {summary.data?.sync_error && (
          <span className="text-wcs-red"> Last sync failed: {summary.data.sync_error}</span>
        )}
      </p>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="flex border-b border-border">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-semibold transition-colors ${
                tab === t.key
                  ? 'text-wcs-red border-b-2 border-wcs-red'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="p-3">
          {tab === 'club'
            ? <ByClub rows={byLocation} />
            : <ByPerson people={people} search={search} setSearch={setSearch} />}
        </div>
      </div>
    </div>
  )
}
