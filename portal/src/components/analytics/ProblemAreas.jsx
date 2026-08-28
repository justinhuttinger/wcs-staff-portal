import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'

// ---------------------------------------------------------------------------
// Problem Areas — Analytics (admin only)
//
// States what is wrong, per club, so a manager does not have to go looking.
// Thresholds are set in Admin > Problem Thresholds.
//
// WHAT WAS NOT CHECKED IS SHOWN AS PROMINENTLY AS WHAT FAILED. A club with too
// little data to judge is not a club with no problems, and a report that
// silently drops it teaches managers that a short list means a good week.
// ---------------------------------------------------------------------------

function fmtValue(v, unit) {
  if (v === null || v === undefined) return 'N/A'
  return unit === 'pct' ? `${v}%` : Number(v).toLocaleString()
}

function ProblemRow({ p }) {
  const missBy = p.direction === 'below'
    ? `${Math.round((p.threshold - p.value) * 10) / 10} under`
    : `${Math.round((p.value - p.threshold) * 10) / 10} over`

  return (
    <li className="py-2.5 flex items-start gap-3">
      <span className="w-1 self-stretch rounded-full bg-wcs-red flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-sm font-semibold text-text-primary">
            {/* A staff problem names the person; a club problem names the club
                alone. Both carry the department, because the point of the
                filter is to hand each list to the right manager. */}
            {p.person ? `${p.person} · ${p.club}` : p.club}
            <span className="text-text-muted font-normal"> · {p.label}</span>
            <span className="ml-2 text-[10px] uppercase tracking-wide text-text-muted border border-border rounded px-1 py-0.5">
              {p.department}
            </span>
          </p>
          <p className="text-sm tabular-nums flex-shrink-0">
            <span className="font-bold text-wcs-red">{fmtValue(p.value, p.unit)}</span>
            <span className="text-text-muted text-xs">
              {' '}vs {fmtValue(p.threshold, p.unit)} · {missBy}
            </span>
          </p>
        </div>
        <p className="text-[11px] text-text-muted mt-0.5">
          {p.why} <span className="opacity-70">({p.sample} {p.sampleLabel})</span>
        </p>
      </div>
    </li>
  )
}

export default function ProblemAreas({ locationSlug }) {
  const [days, setDays] = useState(30)
  const [dept, setDept] = useState('all')
  const [scope, setScope] = useState('all')

  const query = useMemo(() => new URLSearchParams({
    clubs: locationSlug || 'all',
    days: String(days),
  }).toString(), [locationSlug, days])

  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/problem-areas?${query}`, { cache: true, signal }),
    [query]
  )

  const all = data?.problems || []
  const problems = all.filter(p =>
    (dept === 'all' || p.department === dept) &&
    (scope === 'all' || p.scope === scope)
  )
  // Filtered client-side: the payload is small, and switching department this
  // way costs nothing rather than a round trip per click.
  const skipped = (data?.skipped || []).filter(s =>
    (dept === 'all' || s.department === dept) &&
    (scope === 'all' || s.scope === scope)
  )
  const clubCount = new Set(problems.map(p => p.clubSlug)).size

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border p-3 flex flex-wrap gap-3 items-end justify-between">
        <label className="flex flex-col gap-1 min-w-[150px]">
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">Window</span>
          <select
            value={String(days)}
            onChange={e => setDays(Number(e.target.value))}
            className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary"
          >
            <option value="14">Last 14 Days</option>
            <option value="30">Last 30 Days</option>
            <option value="60">Last 60 Days</option>
            <option value="90">Last 90 Days</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 min-w-[150px]">
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">Department</span>
          <select
            value={dept}
            onChange={e => setDept(e.target.value)}
            className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary"
          >
            <option value="all">All Departments</option>
            {(data?.departments || []).map(d => (
              <option key={d.key} value={d.key}>{d.label} ({d.count})</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 min-w-[150px]">
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">Level</span>
          <select
            value={scope}
            onChange={e => setScope(e.target.value)}
            className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary"
          >
            <option value="all">Club and Staff</option>
            <option value="club">Club Only</option>
            <option value="staff">Staff Only</option>
          </select>
        </label>

        <p className="text-[11px] text-text-muted pb-1.5 ml-auto">
          Thresholds are set in Admin &rsaquo; Problem Thresholds.
        </p>
      </div>

      {loading && <DesktopLoading />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.clean && dept === 'all' && scope === 'all' && (
            <div className="bg-surface rounded-xl border border-border p-6 text-center">
              <p className="text-sm font-semibold text-emerald-600">Nothing over the line</p>
              <p className="text-xs text-text-muted mt-1">
                {data.checksRun} checks ran and none failed.
              </p>
            </div>
          )}

          {problems.length > 0 && (
            <div className="bg-surface rounded-xl border border-border px-4 py-2">
              <div className="flex items-baseline justify-between gap-3 py-2">
                <p className="text-xs font-bold text-text-primary">
                  {problems.length} problem{problems.length === 1 ? '' : 's'} across{' '}
                  {clubCount} club{clubCount === 1 ? '' : 's'}
                </p>
                {/* Ordered by how far past the line, not alphabetically: the
                    worst thing should be the first thing read. */}
                <p className="text-[11px] text-text-muted">Worst first</p>
              </div>
              <ul className="divide-y divide-border">
                {problems.map(p => (
                  <ProblemRow key={`${p.scope}-${p.clubSlug}-${p.person || ''}-${p.key}`} p={p} />
                ))}
              </ul>
            </div>
          )}

          {!data.clean && problems.length === 0 && (
            <div className="bg-surface rounded-xl border border-border p-6 text-center">
              <p className="text-sm text-text-primary font-semibold">Nothing in this filter</p>
              <p className="text-xs text-text-muted mt-1">
                {all.length} problem{all.length === 1 ? '' : 's'} found elsewhere. Widen the
                department or level to see them.
              </p>
            </div>
          )}

          {skipped.length > 0 && (
            <div className="bg-surface rounded-xl border border-border p-4">
              <p className="text-xs font-bold text-text-primary mb-2">Not judged</p>
              {/* Shown, not hidden: a club with too little data to judge is not
                  a club with no problems, and dropping it silently teaches
                  people that a short list means a good week. */}
              <ul className="space-y-1">
                {skipped.map(s => (
                  <li key={`${s.scope}-${s.clubSlug}-${s.person || ''}-${s.key}`} className="text-[11px] text-text-muted">
                    <span className="text-text-primary">{s.person ? `${s.person} · ${s.club}` : s.club}</span> · {s.label}
                    <span className="opacity-70"> — {s.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(data.checks || []).some(c => c.off) && (
            <p className="text-[11px] text-text-muted px-1">
              Turned off in Admin:{' '}
              {(data.checks || []).filter(c => c.off).map(c => c.label).join(', ')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
