import { useMemo, useState } from 'react'
import { npsReport } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtPct, colorFor, GOOD_COLOR, BAD_COLOR } from './chartPalette'
import { RankedBars, zebraColumn } from './charts'


// ---------------------------------------------------------------------------
// NPS — Analytics
//
// THE SAMPLE COMES FIRST, ABOVE THE SCORE. 550 invites were delivered in
// August, 8 were opened and 4 were answered. An NPS computed on four answers is
// arithmetic, not a measurement: one more detractor moves it 50 points. So the
// headline is suppressed below MIN_REPORTABLE and the delivery funnel sits at
// the top of the report, because "nobody opens the email" is the finding, and
// no amount of scoring the four replies will surface it.
//
// EMAILED AND POSTER ANSWERS ARE KEPT APART. Poster (walk-up) answers are
// self-selected and lean to the extremes; emailed answers are closer to a
// random cohort sample. Blended silently, company NPS moves when a poster gets
// hung nearer the door, and somebody spends a month chasing an artifact of
// poster placement.
//
// A FAILED SEND IS NOT A NON-RESPONSE. It never arrived, so it stays out of
// every rate and is reported on its own line: a delivery problem and a
// response problem get fixed in completely different places.
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

  const rates = data?.responseRates || []
  const delivery = useMemo(() => rates.reduce((a, r) => ({
    sent: a.sent + r.sent, opened: a.opened + r.opened, responded: a.responded + r.responded,
  }), { sent: 0, opened: 0, responded: 0 }), [rates])

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

      {!loading && !error && data && (
        <>
          {/* The caveat goes above the number it qualifies, not under it. */}
          {answered > 0 && !reportable && (
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
                  sub: `${fmtInt(overall.invited?.n || 0)} answers`,
                  muted: !reportable,
                },
                {
                  label: 'Average Score',
                  value: overall.blended?.average ?? '—',
                  sub: 'every question, both sources',
                  muted: !reportable,
                },
                {
                  label: 'Answered',
                  value: fmtInt(delivery.responded),
                  sub: delivery.sent ? `${fmtPct((delivery.responded / delivery.sent) * 100)} of delivered` : 'nothing sent',
                  muted: true,
                },
                {
                  label: 'Opened',
                  value: fmtInt(delivery.opened),
                  sub: delivery.sent ? `${fmtPct((delivery.opened / delivery.sent) * 100)} of delivered` : 'nothing sent',
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

          <Funnel rates={rates} totals={delivery} />

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

// --- delivery ---------------------------------------------------------------

/**
 * Delivered, opened, answered.
 *
 * At the top of the report on purpose. When 550 invites produce 4 answers the
 * scores are downstream of a delivery and open-rate problem, and a report that
 * opened on "NPS +75" would send somebody to fix member sentiment instead of
 * the email.
 */
function Funnel({ rates, totals }) {
  if (rates.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-text-muted">No invites went out in this range.</p>
      </div>
    )
  }

  const steps = [
    { key: 'Delivered', value: totals.sent, colour: colorFor('delivered', 0) },
    { key: 'Opened', value: totals.opened, colour: colorFor('opened', 1) },
    { key: 'Answered', value: totals.responded, colour: colorFor('answered', 2) },
  ]
  const max = Math.max(1, totals.sent)

  return (
    <div className="bg-surface rounded-xl border border-border p-3 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-bold text-text-primary">Did the invite reach anyone</p>
        {/* A failed send never arrived, so it is not a non-response. */}
        <p className="text-[11px] text-text-muted">failed sends excluded from every rate</p>
      </div>

      <div className="space-y-1.5">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-3">
            <span className="text-xs text-text-primary w-24 text-right flex-shrink-0">{s.key}</span>
            <div className="flex-1 min-w-[100px] h-6 rounded-sm bg-bg overflow-hidden">
              <div className="h-full rounded-sm flex items-center justify-end pr-1.5"
                style={{ width: `${Math.max(1, (s.value / max) * 100)}%`, background: s.colour }}>
                <span className="text-[10px] font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]">
                  {fmtInt(s.value)}
                </span>
              </div>
            </div>
            <span className="text-[11px] text-text-muted tabular-nums w-24 text-right flex-shrink-0">
              {i === 0 ? '' : totals.sent > 0 ? `${fmtPct((s.value / totals.sent) * 100)} of delivered` : ''}
            </span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted">
              {['Survey', 'Delivered', 'Opened', 'Answered', 'Open Rate', 'Answer Rate'].map((h, i) => (
                <th key={h} className={`py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide ${i ? 'text-right' : 'text-left'}`}
                  style={zebraColumn(i)}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rates.map(r => (
              <tr key={r.survey_id} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 px-2 text-text-primary" style={zebraColumn(0)}>{r.survey_title || r.survey_id}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(1)}>{fmtInt(r.sent)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(2)}>{fmtInt(r.opened)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(3)}>{fmtInt(r.responded)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(4)}>
                  {r.open_rate === null ? '—' : `${r.open_rate}%`}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-text-primary" style={zebraColumn(5)}>
                  {r.response_rate === null ? '—' : `${r.response_rate}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
