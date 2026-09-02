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

function fmtDate(d) {
  if (!d) return ''
  const [, m, day] = String(d).slice(0, 10).split('-')
  return `${Number(m)}/${Number(day)}`
}

/**
 * One problem, on ONE LINE.
 *
 * Everything that used to stack — name, pill, department, value, the numbers
 * behind it — sits on a single row and truncates. A list of problems is read by
 * scanning down it, and a three-line row means a third as many fit on screen.
 *
 * A row with rows behind it (the checklists a person missed) is clickable and
 * opens underneath. Everything else is inert, and looks it.
 */
function ProblemRow({ p, checks }) {
  const [open, setOpen] = useState(false)
  const hasDetail = Array.isArray(p.details) && p.details.length > 0

  const line = (
    <>
      <span className="w-1 self-stretch rounded-full bg-wcs-red flex-shrink-0" aria-hidden="true" />

      {hasDetail ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`w-3 h-3 text-text-muted flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      ) : <span className="w-3 flex-shrink-0" />}

      <span className="text-xs font-semibold text-text-primary truncate max-w-[14rem]"
        title={`${p.person} · ${p.club}`}>
        {p.person}
      </span>
      <span className="text-[11px] text-text-muted truncate flex-shrink-0 hidden sm:inline">{p.club}</span>

      <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 border flex-shrink-0"
        style={pillStyle(checks, p.key)}>
        {p.label}
      </span>

      <span className="ml-auto flex items-baseline gap-2 flex-shrink-0 tabular-nums">
        {/* The numbers behind the percentage, on the same line: a bare "30%"
            tells a manager nothing they can act on. */}
        {p.numerator !== null && p.numerator !== undefined && p.unit === 'pct' && (
          <span className="text-[11px] text-text-muted hidden sm:inline">
            {p.numerator}/{p.sample} {p.sampleLabel}
          </span>
        )}
        {p.target !== null && p.target !== undefined && (
          <span className="text-[11px] text-text-muted hidden md:inline">needs {p.target}</span>
        )}
        {p.unit === 'count' && (
          <span className="text-[11px] text-text-muted hidden sm:inline">
            of {p.sample} {p.sampleLabel}
          </span>
        )}
        <span className="text-xs font-bold text-wcs-red">{fmtValue(p.value, p.unit)}</span>
        <span className="text-[11px] text-text-muted">vs {fmtValue(p.threshold, p.unit)}</span>
      </span>
    </>
  )

  return (
    <li className="py-1.5">
      {hasDetail ? (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) }
          }}
          className="flex items-center gap-2 cursor-pointer"
          title={p.why}
        >
          {line}
        </div>
      ) : (
        <div className="flex items-center gap-2" title={p.why}>{line}</div>
      )}

      {open && hasDetail && (
        <ul className="mt-1.5 ml-6 space-y-0.5 border-l border-border pl-3">
          {p.details.map((d, i) => (
            <li key={`${d.name}-${d.date}-${i}`} className="flex items-center gap-2 text-[11px]">
              <span className="text-text-muted tabular-nums w-10 flex-shrink-0">{fmtDate(d.date)}</span>
              <span className="text-text-primary truncate">{d.name}</span>
              {/* Two different kinds of row live behind this list. An
                  operational job carries how it was pinned on somebody and how
                  far it got; an outstanding Day One form carries neither, and
                  showing it a job's "worked on it / 0%" would be inventing
                  facts about it. */}
              {p.key === 'dayone_open_forms' ? (
                <span className="ml-auto flex-shrink-0 tabular-nums text-wcs-red font-semibold">
                  {d.overdue === null || d.overdue === undefined
                    ? 'outstanding'
                    : `${d.overdue}d overdue`}
                </span>
              ) : (
                <span className="ml-auto flex items-center gap-2 flex-shrink-0 tabular-nums">
                  {/* How it was pinned on them. 'Rostered' is weaker evidence
                      than having actually worked the job, and saying which is
                      the difference between a fair conversation and an unfair
                      one. */}
                  <span className="text-text-muted">
                    {d.via === 'rostered'
                      ? `rostered${d.coverPct ? ` ${d.coverPct}%` : ''}`
                      : 'worked on it'}
                  </span>
                  <span className="text-wcs-red font-semibold w-10 text-right">{d.pct}%</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
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
