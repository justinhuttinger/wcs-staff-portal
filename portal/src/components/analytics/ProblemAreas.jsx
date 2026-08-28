import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { colorFor } from './chartPalette'

// ---------------------------------------------------------------------------
// Problem Areas — Analytics (admin only)
//
// States what is wrong, per club, so a manager does not have to go looking.
// Thresholds are set in Admin > Problem Thresholds.
//
// PEOPLE ONLY. A club figure is an average of the people in it, and averages
// are what the other reports are for; a problem worth acting on has somebody's
// name on it.
//
// A check that cannot be judged — no data, or too small a sample — simply does
// not fire. A manager wants the problems, not a register of everything that was
// looked at. What could not be ATTRIBUTED is different, and is stated: a job
// nobody started has no name to put it against.
// ---------------------------------------------------------------------------

function fmtValue(v, unit) {
  if (v === null || v === undefined) return 'N/A'
  return unit === 'pct' ? `${v}%` : Number(v).toLocaleString()
}

// One colour per KIND of problem, fixed by its position in the check list so a
// colour always means the same thing. Scanning a long list, the eye finds three
// of the same pill far faster than it reads three identical labels — which is
// the point: repeated colours are repeated problems.
function pillStyle(checks, key) {
  const i = Math.max(0, (checks || []).findIndex(c => c.key === key))
  const hue = colorFor(key, i)
  return { background: `${hue}1f`, color: hue, borderColor: `${hue}66` }
}

function ProblemRow({ p, checks }) {
  return (
    <li className="py-2.5 flex items-start gap-3">
      <span className="w-1 self-stretch rounded-full bg-wcs-red flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">
              {/* A staff problem names the person; a club problem names the
                  club alone. */}
              {p.person ? `${p.person} · ${p.club}` : p.club}
            </p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span
                className="text-[10px] font-semibold rounded-full px-2 py-0.5 border"
                style={pillStyle(checks, p.key)}
              >
                {p.label}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-text-muted border border-border rounded px-1.5 py-0.5">
                {p.department}
              </span>
            </div>
          </div>

          {/* The numbers behind the percentage, not just the percentage. A bare
              "30%" tells a manager nothing they can act on; "12 of 40 booked,
              needs 16" tells them the size of the gap in members. */}
          <div className="text-right flex-shrink-0 tabular-nums">
            <p className="text-sm">
              <span className="font-bold text-wcs-red">{fmtValue(p.value, p.unit)}</span>
              <span className="text-text-muted text-xs"> vs {fmtValue(p.threshold, p.unit)}</span>
            </p>
            {p.numerator !== null && p.numerator !== undefined && p.unit === 'pct' && (
              <p className="text-[11px] text-text-muted">
                {p.numerator} of {p.sample} {p.sampleLabel}
              </p>
            )}
            {p.target !== null && p.target !== undefined && (
              <p className="text-[11px] text-text-muted">
                needs {p.target}
                {p.shortBy ? ` · ${p.shortBy} short` : ''}
              </p>
            )}
            {p.unit === 'count' && (
              <p className="text-[11px] text-text-muted">
                of {p.sample} {p.sampleLabel}
              </p>
            )}
          </div>
        </div>
        <p className="text-[11px] text-text-muted mt-1">{p.why}</p>
      </div>
    </li>
  )
}

export default function ProblemAreas({ locationSlug }) {
  const [days, setDays] = useState(30)
  const [dept, setDept] = useState('all')

  const query = useMemo(() => new URLSearchParams({
    clubs: locationSlug || 'all',
    days: String(days),
  }).toString(), [locationSlug, days])

  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/problem-areas?${query}`, { cache: true, signal }),
    [query]
  )

  const all = data?.problems || []
  const problems = all.filter(p => dept === 'all' || p.department === dept)
  // Filtered client-side: the payload is small, so switching department costs
  // nothing rather than a round trip per click.
  const peopleCount = new Set(problems.map(p => `${p.clubSlug}|${p.person}`)).size

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
          {data.clean && dept === 'all' && (
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
                  {peopleCount} {peopleCount === 1 ? 'person' : 'people'}
                </p>
                {/* Ordered by how far past the line, not alphabetically: the
                    worst thing should be the first thing read. */}
                <p className="text-[11px] text-text-muted">Worst first</p>
              </div>
              <ul className="divide-y divide-border">
                {problems.map(p => (
                  <ProblemRow
                    key={`${p.scope}-${p.clubSlug}-${p.person || ''}-${p.key}`}
                    p={p}
                    checks={data.checks}
                  />
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

          {(data.meta?.opsUnowned > 0 || data.meta?.formsUnowned > 0) && (
            <p className="text-[11px] text-text-muted px-1">
              Not shown, because nobody is named on them:{' '}
              {data.meta.opsUnowned > 0 && (
                <>{data.meta.opsUnowned} of {data.meta.opsBelowTotal} below-standard jobs were never started</>
              )}
              {data.meta.opsUnowned > 0 && data.meta.formsUnowned > 0 && ', '}
              {data.meta.formsUnowned > 0 && (
                <>{data.meta.formsUnowned} open Day One forms have no trainer on them</>
              )}
              .
            </p>
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
