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

/**
 * What the number was measured on: "12 of 40 new members".
 *
 * A bare 30% is not something anybody can act on, and 30% of four is a
 * different conversation from 30% of forty.
 */
function basisText(p) {
  if (!p.sample) return null
  if (p.unit === 'pct' && p.numerator !== null && p.numerator !== undefined) {
    return `${p.numerator} of ${p.sample} ${p.sampleLabel}`
  }
  return `of ${p.sample} ${p.sampleLabel}`
}

/**
 * What it would take to clear the line, in whole units of the thing itself.
 *
 * This is the column that turns the report from a scoreboard into a to-do
 * list. `shortBy` is already computed server-side for the percentage checks
 * (how many more successes reach the threshold at this sample size); the count
 * checks just need the overshoot.
 *
 * Deliberately unit-free wording. For Day One Booking %, `shortBy` is a number
 * of BOOKINGS while sampleLabel is "new members", so "4 more new members" would
 * be flatly wrong - "4 to clear" is the honest phrasing for both directions.
 */
function toClear(p) {
  if (p.direction === 'below') {
    return p.shortBy > 0 ? p.shortBy : null
  }
  if (p.value === null || p.value === undefined || p.threshold === null) return null
  const over = p.value - p.threshold
  return over > 0 ? over : null
}

/** How a check fires, in words, for the explanation line under the chips. */
function firesText(check) {
  if (!check) return null
  const unit = check.unit === 'pct' ? '%' : ''
  if (check.direction === 'above') {
    // A threshold of zero is not "above 0", it is "any at all" — which is the
    // whole point of those two checks and reads as a typo otherwise.
    return check.threshold === 0
      ? 'Fires on any at all.'
      : `Fires above ${check.threshold}${unit}.`
  }
  return `Fires below ${check.threshold}${unit}${check.minSample ? `, once there are ${check.minSample} to judge` : ''}.`
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
  const clear = toClear(p)

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

      {/* Three fixed-width columns rather than a run of numbers, so they line
          up down the list and the header above says what each one is. The old
          row read "12/40 new members  needs 16  30%  vs 40%" — four fragments,
          no labels, and "needs 16" sitting beside "vs 40%" invited reading 16
          as a percentage. */}
      <span className="ml-auto flex items-center gap-3 flex-shrink-0 tabular-nums">
        <span className="hidden lg:block w-40 text-right text-[11px] text-text-muted truncate">
          {basisText(p)}
        </span>

        <span className="w-24 text-right whitespace-nowrap">
          <span className="text-xs font-bold text-wcs-red">{fmtValue(p.value, p.unit)}</span>
          <span className="text-[11px] text-text-muted"> / {fmtValue(p.threshold, p.unit)}</span>
        </span>

        {/* Green because it is the way out, not another thing that is wrong.
            Red here would make the row read as two problems. */}
        <span className="w-[4.5rem] text-right">
          {clear !== null && (
            <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 border border-emerald-500/40 bg-emerald-500/10 text-emerald-600">
              +{clear}
            </span>
          )}
        </span>
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
        <>
        {/* Said here as well as in the strip at the top: by the time somebody
            has opened a row they are looking at one person's specifics, and
            scrolling back up to remember what the check measures is exactly
            the friction this report exists to remove. */}
        {p.why && (
          <p className="mt-1.5 ml-6 pl-3 text-[11px] leading-snug text-text-muted">{p.why}</p>
        )}
        <ul className="mt-1 ml-6 space-y-0.5 border-l border-border pl-3">
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
        </>
      )}
    </li>
  )
}

/**
 * One kind of problem, as a filter chip carrying its own count.
 *
 * Takes the same colour the row pills use, so a chip and the rows it selects
 * are visibly the same thing.
 */
function KindChip({ label, count, active, onClick, style }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={active ? style : undefined}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        active ? '' : 'border-border bg-bg text-text-muted hover:text-text-primary'
      }`}
    >
      <span>{label}</span>
      <span className={active ? 'opacity-70' : 'text-text-muted'}>{count}</span>
    </button>
  )
}

export default function ProblemAreas({ locationSlug }) {
  const [days, setDays] = useState(30)
  const [dept, setDept] = useState('all')
  const [kind, setKind] = useState('all')

  const query = useMemo(() => new URLSearchParams({
    clubs: locationSlug || 'all',
    days: String(days),
  }).toString(), [locationSlug, days])

  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/problem-areas?${query}`, { cache: true, signal }),
    [query]
  )

  const all = data?.problems || []
  // Filtered client-side: the payload is small, so switching department costs
  // nothing rather than a round trip per click.
  const byDept = all.filter(p => dept === 'all' || p.department === dept)

  // One chip per KIND of problem actually firing, with how many rows it
  // accounts for. A check that fired for nobody is not offered: a chip reading
  // 0 is a filter whose only outcome is an empty list.
  const kinds = useMemo(() => (
    (data?.checks || [])
      .map(c => ({ ...c, count: byDept.filter(p => p.key === c.key).length }))
      .filter(c => c.count > 0)
  ), [byDept, data])

  // A department change can strip the kind that was selected. Resolved by
  // DERIVING the effective kind rather than correcting the state: a chip that
  // no longer exists falls back to All on its own, with no effect to fire, no
  // extra render, and no window in which the list is empty for a reason
  // nothing on screen explains.
  const activeKindKey = kind === 'all' || kinds.some(k => k.key === kind) ? kind : 'all'
  const activeKind = activeKindKey === 'all'
    ? null
    : (data?.checks || []).find(c => c.key === activeKindKey)

  const problems = byDept.filter(p => activeKindKey === 'all' || p.key === activeKindKey)
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

          {/* What each kind of problem MEANS, stated once at the top instead of
              repeated down every row. Doubles as the filter, because "show me
              only this" is the next thing asked after "what is this". */}
          {kinds.length > 0 && (
            <div className="bg-surface rounded-xl border border-border p-3">
              <div className="flex flex-wrap gap-1.5">
                <KindChip
                  label="All problems"
                  count={byDept.length}
                  active={activeKindKey === 'all'}
                  onClick={() => setKind('all')}
                />
                {kinds.map(k => (
                  <KindChip
                    key={k.key}
                    label={k.label}
                    count={k.count}
                    active={activeKindKey === k.key}
                    onClick={() => setKind(activeKindKey === k.key ? 'all' : k.key)}
                    style={pillStyle(data.checks, k.key)}
                  />
                ))}
              </div>
              <p className="text-[11px] leading-snug text-text-muted mt-2">
                {activeKind
                  ? <>{activeKind.why} <span className="text-text-muted/80">{firesText(activeKind)}</span></>
                  : 'Every row is one person over the line on one check. Pick a kind to see what it measures.'}
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

              {/* Names the three right-hand columns once, so no row has to
                  carry its own labels. Same widths and gap as ProblemRow. */}
              <div className="flex items-center gap-2 pb-1.5 border-b border-border">
                <span className="w-1 flex-shrink-0" aria-hidden="true" />
                <span className="w-3 flex-shrink-0" aria-hidden="true" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Who</span>
                <span className="ml-auto flex items-center gap-3 flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  <span className="hidden lg:block w-40 text-right">Measured on</span>
                  <span className="w-24 text-right">Now / target</span>
                  <span className="w-[4.5rem] text-right">To clear</span>
                </span>
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
