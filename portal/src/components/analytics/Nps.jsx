import { useMemo, useState } from 'react'
import { npsReport } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, GOOD_COLOR, BAD_COLOR } from './chartPalette'
import { RankedBars, zebraColumn } from './charts'


// ---------------------------------------------------------------------------
// NPS — Analytics
//
// WHAT MEMBERS SAID, AND NOTHING ABOUT THE EMAIL THAT ASKED THEM. Scores, the
// per-question averages behind them, and the free text. Delivery — who it
// reached, who opened it, who answered — is deliberately absent: it is a
// question about the survey tool, and mixing it in here turns a page about
// members into a page about mailing.
//
// THE SAMPLE STILL TRAVELS WITH THE SCORE. Four answers make an NPS that moves
// 50 points on one more detractor, so below MIN_REPORTABLE the figures are
// marked as reference rather than result, and every average carries its n. That
// is not a delivery statistic, it is what the number is worth.
//
// EMAILED AND POSTER ANSWERS ARE KEPT APART. Poster (walk-up) answers are
// self-selected and lean to the extremes; emailed answers are closer to a
// random cohort sample. Blended silently, company NPS moves when a poster gets
// hung nearer the door, and somebody spends a month chasing an artifact of
// poster placement.
// ---------------------------------------------------------------------------

// Below this many answers the score is shown as unreportable rather than as a
// number. Ten is not a statistical threshold, it is the point below which a
// single reply swings the figure by more than the differences anyone is trying
// to read.
const MIN_REPORTABLE = 10

// NPS rows carry ABC club numbers rather than slugs, so the map is by number
// here. Anything unrecognised prints as-is rather than as a blank cell.
const CLUB_NAMES = {
  30935: 'Salem', 31599: 'Keizer', 7655: 'Eugene', 31598: 'Springfield',
  31600: 'Clackamas', 31601: 'Milwaukie', 32073: 'Medford',
}
const CLUB_LABEL = n => CLUB_NAMES[n] || n
const metricLabel = k => String(k || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const BAND_STYLE = {
  promoter: { label: 'Promoter', className: 'text-green-700 border-green-500/40' },
  passive: { label: 'Passive', className: 'text-text-muted border-border' },
  detractor: { label: 'Detractor', className: 'text-wcs-red border-red-500/40' },
}

const signed = n => (n > 0 ? `+${n}` : String(n))

/** A score with nothing behind it is nothing, never a zero. */
function Score({ value, n, suffix = '', nps = false }) {
  if (!n || value === null || value === undefined) return <span className="text-text-muted">—</span>
  return (
    <span className="tabular-nums">
      {nps ? signed(value) : value}{suffix}
      <span className="ml-1 text-[10px] font-normal text-text-muted">n={n}</span>
    </span>
  )
}

export default function Nps({ startDate, endDate, locationSlug }) {
  const [splitSources, setSplitSources] = useState(false)

  const { data, loading, error, retrying } = useCancellableFetch(
    signal => npsReport(
      { startDate, endDate, locationSlug, combine: true },
      { cache: true, signal }
    ),
    [startDate, endDate, locationSlug]
  )

  const overall = data?.overall || {}
  const answered = overall.blended?.n || 0
  const reportable = answered >= MIN_REPORTABLE

  return (
    <div className="space-y-3">
      {loading && <DesktopLoading retrying={retrying} />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && answered === 0 && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-text-muted">Nobody answered in this range.</p>
          <p className="text-[11px] text-text-muted/70 mt-2 max-w-md mx-auto">
            Scores come from the emailed survey and the in-club poster. A range with no answers
            is not a bad month, it is an empty one.
          </p>
        </div>
      )}

      {!loading && !error && data && answered > 0 && (
        <>
          {/* The caveat goes above the number it qualifies, not under it. */}
          {!reportable && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">
                {fmtInt(answered)} {answered === 1 ? 'answer' : 'answers'} in this range. Below{' '}
                {MIN_REPORTABLE} a single reply moves NPS by more than the differences anyone is
                trying to read, so the scores below are shown for reference rather than as a result.
              </p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              {[
                {
                  label: 'NPS (Emailed)',
                  value: overall.invited?.n ? signed(overall.invited.nps) : '—',
                  sub: `${fmtInt(overall.invited?.n || 0)} answered the score question`,
                  muted: !reportable,
                },
                {
                  label: 'Average Score',
                  value: overall.blended?.average ?? '—',
                  sub: 'every question, both sources',
                  muted: !reportable,
                },
                {
                  label: 'Promoters',
                  value: fmtInt(overall.invited?.promoters || 0),
                  // Passives are in the denominator and never the numerator,
                  // which is what makes NPS mean anything: indifference is not
                  // endorsement. Showing all three stops the gap between
                  // promoters and detractors reading as the whole sample.
                  sub: `${fmtInt(overall.invited?.passives || 0)} passive`,
                  muted: true,
                },
                {
                  label: 'Detractors',
                  value: fmtInt(overall.invited?.detractors || 0),
                  // A 6 reads like a pass mark and is a detractor. Saying so
                  // here is cheaper than having the argument every quarter.
                  sub: '6 or below',
                  muted: true,
                },
              ].map(c => (
                <div key={c.label} className="px-5 py-4 text-center min-w-[150px] flex-1">
                  <p className={`text-xl font-bold tabular-nums ${c.muted ? 'text-text-muted' : 'text-text-primary'}`}>
                    {c.value}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{c.label}</p>
                  <p className="text-[10px] text-text-muted/70 mt-0.5 leading-tight">{c.sub}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-border p-3 flex items-center justify-between gap-3">
            <p className="text-xs font-bold text-text-primary">Scores</p>
            <label className="flex items-center gap-2 text-[11px] text-text-primary cursor-pointer">
              <input type="checkbox" checked={splitSources}
                onChange={e => setSplitSources(e.target.checked)}
                className="w-3.5 h-3.5 accent-wcs-red" />
              Split emailed and poster
            </label>
          </div>

          <ByClub rows={data.byClub || []} split={splitSources} />
          <ByMetric rows={data.byMetric || []} />
          <Matrix rows={data.matrix || []} clubs={data.byClub || []} metrics={data.byMetric || []} />
          <Comments rows={data.comments || []} />
        </>
      )}
    </div>
  )
}

// --- scores -----------------------------------------------------------------

function ByClub({ rows, split }) {
  if (rows.length === 0) return null
  const head = split
    ? ['Club', 'NPS (Emailed)', 'NPS (Poster)', 'Avg Score']
    : ['Club', 'NPS', 'Avg Score']

  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">By Club</p>
        {split && (
          <p className="text-[11px] text-text-muted">poster answers are self-selected</p>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted">
            {head.map((h, i) => (
              <th key={h} className={`py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide ${i ? 'text-right' : 'text-left'}`}
                style={zebraColumn(i)}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.club_number} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 px-2 text-text-primary" style={zebraColumn(0)}>{CLUB_LABEL(r.club_number)}</td>
              {split ? (
                <>
                  <td className="py-1.5 px-2 text-right text-text-primary" style={zebraColumn(1)}>
                    <Score value={r.invited?.nps} n={r.invited?.n} nps />
                  </td>
                  <td className="py-1.5 px-2 text-right text-text-muted" style={zebraColumn(2)}>
                    <Score value={r.walkup?.nps} n={r.walkup?.n} nps />
                  </td>
                  <td className="py-1.5 px-2 text-right text-text-muted" style={zebraColumn(3)}>
                    <Score value={r.blended?.average} n={r.blended?.n} />
                  </td>
                </>
              ) : (
                <>
                  <td className="py-1.5 px-2 text-right text-text-primary" style={zebraColumn(1)}>
                    <Score value={(r.combined || r.invited)?.nps} n={(r.combined || r.invited)?.n} nps />
                  </td>
                  <td className="py-1.5 px-2 text-right text-text-muted" style={zebraColumn(2)}>
                    <Score value={r.blended?.average} n={r.blended?.n} />
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Average per question. This is where a single weak area shows up. */
function ByMetric({ rows }) {
  const bars = useMemo(() => rows
    .filter(r => r.blended?.n > 0)
    .map(r => ({ label: metricLabel(r.metric_key), avg: r.blended.average, n: r.blended.n }))
    .sort((a, b) => a.avg - b.avg), [rows])

  if (bars.length === 0) return null
  return (
    <RankedBars
      title="Average by Question (weakest first)"
      rows={bars}
      labelKey="label"
      valueKey="avg"
      secondary={r => `${fmtInt(r.n)} ${r.n === 1 ? 'answer' : 'answers'}`}
      emptyText="Nothing answered in this range."
    />
  )
}

/**
 * Club x question.
 *
 * The pivot is the point: it is what shows one club's equipment score dragging
 * while everything else there is fine, which neither of the two tables above
 * can say on its own.
 */
function Matrix({ rows, clubs, metrics }) {
  if (rows.length === 0 || clubs.length === 0) return null
  const metricKeys = metrics.map(m => m.metric_key)
  const cell = (club, metric) => rows.find(c => c.club_number === club && c.metric_key === metric)

  // A 6 reads like a pass mark and is a detractor, so the tone breaks at 7 and
  // 9 rather than anywhere that looks like a school grade.
  const tone = avg => (avg === null || avg === undefined ? undefined
    : avg >= 9 ? GOOD_COLOR : avg >= 7 ? undefined : BAD_COLOR)

  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <p className="text-xs font-bold text-text-primary mb-2">Club by Question</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted">
            <th className="py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-left" style={zebraColumn(0)}>Club</th>
            {metricKeys.map((m, i) => (
              <th key={m} className="py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-right whitespace-nowrap"
                style={zebraColumn(i + 1)}>{metricLabel(m)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clubs.map(c => (
            <tr key={c.club_number} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 px-2 text-text-primary whitespace-nowrap" style={zebraColumn(0)}>
                {CLUB_LABEL(c.club_number)}
              </td>
              {metricKeys.map((m, i) => {
                const v = cell(c.club_number, m)
                return (
                  <td key={m} className="py-1.5 px-2 text-right tabular-nums" style={zebraColumn(i + 1)}>
                    {v && v.n ? (
                      <span style={{ color: tone(v.average) }} className={tone(v.average) ? '' : 'text-text-muted'}>
                        {v.average}
                        <span className="ml-1 text-[10px] text-text-muted">n={v.n}</span>
                      </span>
                    ) : <span className="text-border">—</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --- what they wrote ---------------------------------------------------------

/**
 * Free text, newest first, with the band it came from.
 *
 * The band travels with the comment because a 3 and a 9 saying "the squat racks
 * are always busy" are different problems: one is a complaint, the other is a
 * compliment about how busy the gym is.
 */
function Comments({ rows }) {
  const [limit, setLimit] = useState(25)
  if (rows.length === 0) return null
  const shown = rows.slice(0, limit)

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">What They Wrote</p>
        <p className="text-[11px] text-text-muted">{fmtInt(rows.length)} newest first</p>
      </div>
      <div className="space-y-2">
        {shown.map(c => {
          const band = c.band ? BAND_STYLE[c.band] : null
          return (
            <div key={`${c.response_id}-${c.question_id}`} className="border border-border rounded-lg p-2.5">
              <div className="flex flex-wrap items-center gap-2 mb-1 text-[10px]">
                {band && (
                  <span className={`border rounded px-1 py-0.5 ${band.className}`}>
                    {band.label} · {c.nps_score}
                  </span>
                )}
                <span className="text-text-muted">{CLUB_LABEL(c.club_number)}</span>
                <span className="text-text-muted/70">{String(c.submitted_at || '').slice(0, 10)}</span>
                {c.source === 'walkup' && <span className="text-text-muted/70">poster</span>}
                {c.contact_name && <span className="text-text-muted/70">{c.contact_name}</span>}
              </div>
              <p className="text-sm text-text-primary">{c.text}</p>
            </div>
          )
        })}
      </div>
      {rows.length > shown.length && (
        <button type="button" onClick={() => setLimit(l => l + 50)}
          className="mt-2 w-full py-1.5 rounded-lg border border-border bg-bg text-xs text-text-muted hover:text-text-primary">
          Show more ({fmtInt(rows.length - shown.length)} older)
        </button>
      )}
    </div>
  )
}
