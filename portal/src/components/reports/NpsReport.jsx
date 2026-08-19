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
function metricName(k) { return String(k || '').replace(/_/g, ' ') }

/** Nothing behind a number is not zero, it is nothing. */
function Val({ value, n, suffix = '' }) {
  if (!n || value === null || value === undefined) {
    return <span className="text-text-muted">—</span>
  }
  return (
    <span className="font-semibold text-text-primary">
      {value}{suffix}
      <span className="ml-1 text-xs font-normal text-text-muted">n={n}</span>
    </span>
  )
}

function Nps({ score, n }) {
  if (!n || score === null || score === undefined) {
    return <span className="text-text-muted">—</span>
  }
  return (
    <span className="font-bold text-text-primary">
      {score > 0 ? `+${score}` : score}
      <span className="ml-1 text-xs font-normal text-text-muted">n={n}</span>
    </span>
  )
}

/** Colour only once a score exists, and only on the cell itself. */
function cellTone(avg) {
  if (avg === null || avg === undefined) return ''
  if (avg >= 9) return 'text-green-700'
  if (avg >= 7) return 'text-text-primary'
  return 'text-red-700'
}

function ScoresTab({ data, splitSources, setSplitSources }) {
  const clubs = data.byClub || []
  const metrics = data.byMetric || []
  const matrix = data.matrix || []
  const comments = data.comments || []

  const cell = (club, metric) =>
    matrix.find(c => c.club_number === club && c.metric_key === metric)

  return (
    <div className="space-y-4">
      {/* Overall */}
      <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Overall</h3>
            <p className="text-xs text-text-muted mt-0.5">
              Everyone who answered in this range, emailed and poster together.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer shrink-0">
            <input
              type="checkbox" checked={splitSources}
              onChange={e => setSplitSources(e.target.checked)}
              className="w-4 h-4 accent-wcs-red"
            />
            Split emailed and poster
          </label>
        </div>

        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Average score</p>
            <p className="text-3xl mt-0.5">
              <Val value={data.overall?.blended?.average} n={data.overall?.blended?.n ?? 0} />
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">NPS</p>
            <p className="text-3xl mt-0.5">
              <Nps score={data.overall?.invited?.nps} n={data.overall?.invited?.n ?? 0} />
            </p>
          </div>
          {splitSources && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">NPS from posters</p>
              <p className="text-3xl mt-0.5">
                <Nps score={data.overall?.walkup?.nps} n={data.overall?.walkup?.n ?? 0} />
              </p>
            </div>
          )}
        </div>

        {splitSources && (
          <p className="text-[11px] text-text-muted">
            Poster answers are self-selected and lean to the extremes; emailed
            answers are closer to a random sample. Worth comparing, worth not
            averaging together when you are tracking a trend.
          </p>
        )}
      </div>

      {/* By gym */}
      {clubs.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-sm font-bold text-text-primary mb-3">By gym</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="pb-2 pr-4 font-semibold">Gym</th>
                  <th className="pb-2 pr-4 font-semibold">Average</th>
                  <th className="pb-2 pr-4 font-semibold">NPS</th>
                  {splitSources && <th className="pb-2 font-semibold">Poster NPS</th>}
                </tr>
              </thead>
              <tbody>
                {clubs.map(c => (
                  <tr key={c.club_number} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 text-text-primary">{clubName(c.club_number)}</td>
                    <td className="py-2 pr-4"><Val value={c.blended?.average} n={c.blended?.n ?? 0} /></td>
                    <td className="py-2 pr-4"><Nps score={c.invited?.nps} n={c.invited?.n ?? 0} /></td>
                    {splitSources && (
                      <td className="py-2"><Nps score={c.walkup?.nps} n={c.walkup?.n ?? 0} /></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* By question */}
      {metrics.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-sm font-bold text-text-primary mb-3">By question</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="pb-2 pr-4 font-semibold">Question</th>
                  <th className="pb-2 pr-4 font-semibold">Average</th>
                  {splitSources && <th className="pb-2 pr-4 font-semibold">Emailed</th>}
                  {splitSources && <th className="pb-2 font-semibold">Poster</th>}
                </tr>
              </thead>
              <tbody>
                {metrics.map(m => (
                  <tr key={m.metric_key} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 text-text-primary capitalize">{metricName(m.metric_key)}</td>
                    <td className="py-2 pr-4"><Val value={m.blended?.average} n={m.blended?.n ?? 0} /></td>
                    {splitSources && <td className="py-2 pr-4"><Val value={m.invited?.average} n={m.invited?.n ?? 0} /></td>}
                    {splitSources && <td className="py-2"><Val value={m.walkup?.average} n={m.walkup?.n ?? 0} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Gym x question */}
      {matrix.length > 0 && clubs.length > 0 && metrics.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-sm font-bold text-text-primary mb-1">Each gym, each question</h3>
          <p className="text-xs text-text-muted mb-3">
            Where one gym is dragging on one thing while the rest of it is fine.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="pb-2 pr-4 font-semibold">Gym</th>
                  {metrics.map(m => (
                    <th key={m.metric_key} className="pb-2 pr-4 font-semibold capitalize whitespace-nowrap">
                      {metricName(m.metric_key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clubs.map(c => (
                  <tr key={c.club_number} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 text-text-primary whitespace-nowrap">{clubName(c.club_number)}</td>
                    {metrics.map(m => {
                      const hit = cell(c.club_number, m.metric_key)
                      return (
                        <td key={m.metric_key} className={`py-2 pr-4 font-semibold ${cellTone(hit?.average)}`}>
                          {hit ? hit.average : <span className="text-text-muted font-normal">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Comments */}
      <Comments comments={comments} />
    </div>
  )
}

function Comments({ comments }) {
  const [band, setBand] = useState('all')
  const shown = comments.filter(c => (band === 'all' ? true : c.band === band))

  if (comments.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-text-muted">Nobody has written anything yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-text-primary">What they said</h3>
          <p className="text-xs text-text-muted mt-0.5">{comments.length} in this range</p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {[['all', 'All'], ['detractor', 'Unhappy'], ['passive', 'Neutral'], ['promoter', 'Happy']].map(([k, label]) => (
            <button
              key={k} type="button" onClick={() => setBand(k)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                band === k ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted hover:text-text-primary'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-text-muted">Nothing in that group.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((c, i) => (
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
                <span>{c.survey_title || c.survey_id}</span>
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
  )
}

function DataTab({ data }) {
  const rates = data.responseRates || []

  if (rates.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center space-y-1">
        <p className="text-sm font-semibold text-text-primary">Nothing sent in this range</p>
        <p className="text-xs text-text-muted">Response rates appear once invites go out.</p>
      </div>
    )
  }

  const total = rates.reduce((a, r) => ({
    sent: a.sent + r.sent, opened: a.opened + r.opened, responded: a.responded + r.responded,
  }), { sent: 0, opened: 0, responded: 0 })
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Did they answer?</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Counts invites that actually went out. A failed send is a delivery
            problem, not a response problem, so it is not in the denominator.
          </p>
        </div>
        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Sent</p>
            <p className="text-3xl font-bold text-text-primary mt-0.5">{total.sent}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Opened</p>
            <p className="text-3xl font-bold text-text-primary mt-0.5">
              {total.opened}
              {pct(total.opened, total.sent) !== null && (
                <span className="ml-2 text-sm font-normal text-text-muted">{pct(total.opened, total.sent)}%</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Answered</p>
            <p className="text-3xl font-bold text-text-primary mt-0.5">
              {total.responded}
              {pct(total.responded, total.sent) !== null && (
                <span className="ml-2 text-sm font-normal text-text-muted">{pct(total.responded, total.sent)}%</span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border p-5">
        <h3 className="text-sm font-bold text-text-primary mb-3">By survey</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                <th className="pb-2 pr-4 font-semibold">Survey</th>
                <th className="pb-2 pr-4 font-semibold">Sent</th>
                <th className="pb-2 pr-4 font-semibold">Opened</th>
                <th className="pb-2 pr-4 font-semibold">Answered</th>
                <th className="pb-2 pr-4 font-semibold">Open rate</th>
                <th className="pb-2 font-semibold">Answer rate</th>
              </tr>
            </thead>
            <tbody>
              {rates.map(r => (
                <tr key={r.survey_id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 text-text-primary">{r.survey_title || r.survey_id}</td>
                  <td className="py-2 pr-4 text-text-primary">{r.sent}</td>
                  <td className="py-2 pr-4 text-text-primary">{r.opened}</td>
                  <td className="py-2 pr-4 text-text-primary">{r.responded}</td>
                  <td className="py-2 pr-4 text-text-primary">
                    {r.open_rate === null ? <span className="text-text-muted">—</span> : `${r.open_rate}%`}
                  </td>
                  <td className="py-2 font-semibold text-text-primary">
                    {r.response_rate === null ? <span className="text-text-muted">—</span> : `${r.response_rate}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function NpsReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('scores')
  const [splitSources, setSplitSources] = useState(false)

  useEffect(() => {
    setData(null)
    setError('')
    npsReport({ startDate, endDate, locationSlug, combine: true })
      .then(setData)
      .catch(err => setError(err.message))
  }, [startDate, endDate, locationSlug])

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

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg border border-border overflow-hidden w-fit">
        {[['scores', 'Scores'], ['data', 'Data']].map(([key, label]) => (
          <button
            key={key} type="button" onClick={() => setTab(key)}
            className={`px-5 py-2 text-sm font-medium transition-colors ${
              tab === key ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted hover:text-text-primary'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'scores'
        ? <ScoresTab data={data} splitSources={splitSources} setSplitSources={setSplitSources} />
        : <DataTab data={data} />}
    </div>
  )
}
