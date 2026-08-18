import { useEffect, useState } from 'react'
import { npsReport } from '../../lib/api'

const CLUB_NAMES = {
  '30935': 'Salem', '31599': 'Keizer', '7655': 'Eugene', '31598': 'Springfield',
  '31600': 'Clackamas', '31601': 'Milwaukie', '32073': 'Medford',
}

const BAND_STYLES = {
  promoter: 'bg-green-50 border border-green-200 text-green-700',
  passive: 'bg-gray-100 border border-gray-200 text-gray-600',
  detractor: 'bg-red-50 border border-red-200 text-red-700',
}

function clubName(n) { return CLUB_NAMES[n] || n }

/**
 * An NPS with nothing behind it is not 0, it is nothing. Showing a dash rather
 * than a number keeps an empty club from reading as a terrible one.
 */
function Score({ value, n }) {
  if (n === 0 || value === null || value === undefined) {
    return <span className="text-text-muted">—</span>
  }
  return (
    <span className="font-bold text-text-primary">
      {value > 0 ? `+${value}` : value}
      <span className="ml-1 text-xs font-normal text-text-muted">n={n}</span>
    </span>
  )
}

function Avg({ value, n }) {
  if (n === 0 || value === null || value === undefined) {
    return <span className="text-text-muted">—</span>
  }
  return (
    <span className="font-semibold text-text-primary">
      {value}
      <span className="ml-1 text-xs font-normal text-text-muted">n={n}</span>
    </span>
  )
}

export default function NpsReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [combine, setCombine] = useState(false)
  const [bandFilter, setBandFilter] = useState('all')

  useEffect(() => {
    setData(null)
    setError('')
    npsReport({ startDate, endDate, locationSlug, combine })
      .then(setData)
      .catch(err => setError(err.message))
  }, [startDate, endDate, locationSlug, combine])

  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-5">
        <p className="text-sm text-wcs-red">{error}</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-text-muted">Loading…</p>
      </div>
    )
  }

  const sourceKeys = combine ? ['combined'] : ['invited', 'walkup']
  const sourceLabels = { invited: 'Emailed', walkup: 'Poster', combined: 'Everyone' }

  const comments = (data.comments || []).filter(c =>
    bandFilter === 'all' ? true : c.band === bandFilter)

  const hasAnything =
    (data.byClub || []).length > 0 ||
    (data.byMetric || []).length > 0 ||
    (data.responseRates || []).length > 0

  if (!hasAnything) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center space-y-1">
        <p className="text-sm font-semibold text-text-primary">No feedback in this range</p>
        <p className="text-xs text-text-muted">
          Nobody has answered a survey between these dates.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Overall + source toggle */}
      <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Overall</h3>
            <p className="text-xs text-text-muted mt-0.5">
              Percent who scored 9-10, minus percent who scored 0-6.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer shrink-0">
            <input
              type="checkbox" checked={combine}
              onChange={e => setCombine(e.target.checked)}
              className="w-4 h-4 accent-wcs-red"
            />
            Combine emailed and poster
          </label>
        </div>

        <div className="flex flex-wrap gap-6">
          {sourceKeys.map(k => (
            <div key={k}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                {sourceLabels[k]}
              </p>
              <p className="text-2xl mt-0.5">
                <Score value={data.overall?.[k]?.nps} n={data.overall?.[k]?.n ?? 0} />
              </p>
            </div>
          ))}
        </div>

        {!combine && (
          <p className="text-[11px] text-text-muted">
            Kept apart on purpose. Poster answers are self-selected and lean to
            the extremes; emailed answers are closer to a random sample. Blend
            them and the company score moves when a poster gets hung nearer the
            door.
          </p>
        )}
      </div>

      {/* By club */}
      {(data.byClub || []).length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-sm font-bold text-text-primary mb-3">By gym</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="pb-2 pr-4 font-semibold">Gym</th>
                  {sourceKeys.map(k => (
                    <th key={k} className="pb-2 pr-4 font-semibold">{sourceLabels[k]}</th>
                  ))}
                  <th className="pb-2 font-semibold">Split</th>
                </tr>
              </thead>
              <tbody>
                {data.byClub.map(c => {
                  const primary = c[sourceKeys[0]] || {}
                  return (
                    <tr key={c.club_number} className="border-b border-border last:border-0">
                      <td className="py-2 pr-4 text-text-primary">{clubName(c.club_number)}</td>
                      {sourceKeys.map(k => (
                        <td key={k} className="py-2 pr-4">
                          <Score value={c[k]?.nps} n={c[k]?.n ?? 0} />
                        </td>
                      ))}
                      <td className="py-2 text-xs text-text-muted whitespace-nowrap">
                        {primary.n
                          ? `${primary.promoters} promoter · ${primary.passives} passive · ${primary.detractors} detractor`
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* By metric */}
      {(data.byMetric || []).length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-sm font-bold text-text-primary mb-3">What we measure</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="pb-2 pr-4 font-semibold">Metric</th>
                  {sourceKeys.map(k => (
                    <th key={k} className="pb-2 pr-4 font-semibold">{sourceLabels[k]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.byMetric.map(m => (
                  <tr key={m.metric_key} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 text-text-primary">{m.metric_key.replace(/_/g, ' ')}</td>
                    {sourceKeys.map(k => (
                      <td key={k} className="py-2 pr-4">
                        <Avg value={m[k]?.average} n={m[k]?.n ?? 0} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Response rates */}
      {(data.responseRates || []).length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-sm font-bold text-text-primary mb-1">Did they answer?</h3>
          <p className="text-xs text-text-muted mb-3">
            Counts only invites that actually went out. A failed send is a
            delivery problem, not a response problem.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="pb-2 pr-4 font-semibold">Survey</th>
                  <th className="pb-2 pr-4 font-semibold">Sent</th>
                  <th className="pb-2 pr-4 font-semibold">Opened</th>
                  <th className="pb-2 pr-4 font-semibold">Answered</th>
                  <th className="pb-2 font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.responseRates.map(r => (
                  <tr key={r.survey_id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 text-text-primary">{r.survey_title || r.survey_id}</td>
                    <td className="py-2 pr-4 text-text-primary">{r.sent}</td>
                    <td className="py-2 pr-4 text-text-primary">{r.opened}</td>
                    <td className="py-2 pr-4 text-text-primary">{r.responded}</td>
                    <td className="py-2 font-semibold text-text-primary">
                      {r.response_rate === null ? <span className="text-text-muted">—</span> : `${r.response_rate}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Comments */}
      {(data.comments || []).length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-text-primary">What they said</h3>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {[['all', 'All'], ['detractor', 'Unhappy'], ['passive', 'Neutral'], ['promoter', 'Happy']].map(([k, label]) => (
                <button
                  key={k} type="button" onClick={() => setBandFilter(k)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    bandFilter === k ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted hover:text-text-primary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {comments.length === 0 ? (
            <p className="text-xs text-text-muted">Nothing in that group.</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c, i) => (
                <li key={`${c.response_id}-${c.question_id}-${i}`} className="bg-bg border border-border rounded-lg p-3">
                  <p className="text-sm text-text-primary">{c.text}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-text-muted">
                    {c.band && (
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${BAND_STYLES[c.band]}`}>
                        {c.nps_score}
                      </span>
                    )}
                    <span>{clubName(c.club_number)}</span>
                    <span>·</span>
                    <span>{c.source === 'walkup' ? 'Poster' : 'Emailed'}</span>
                    <span>·</span>
                    <span>{String(c.submitted_at).slice(0, 10)}</span>
                    {c.contact_email && (
                      <>
                        <span>·</span>
                        <a href={`mailto:${c.contact_email}`} className="text-wcs-red hover:underline">
                          {c.contact_name || c.contact_email}
                        </a>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
