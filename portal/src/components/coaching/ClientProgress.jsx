import { useEffect, useState } from 'react'
import { coachingApi } from './coachingApi'
import { chartGeometry } from './logs'
import { Card, prettyDay, field } from './ui.jsx'

const METRICS = [
  { key: 'est1rm', label: 'Est. 1RM' },
  { key: 'bestWeight', label: 'Best weight' },
  { key: 'volume', label: 'Volume' },
]

const W = 640
const H = 240
const PAD = 32

// Per-exercise progress: pick something they have logged, see the trend.
export default function ClientProgress({ member }) {
  const [exerciseId, setExerciseId] = useState('')
  const [metric, setMetric] = useState('est1rm')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    coachingApi.progress(member, exerciseId || undefined)
      .then(r => { if (live) { setData(r); setError(null) } })
      .catch(err => { if (live) setError(err.message) })
    return () => { live = false }
  }, [member, exerciseId])

  if (!data) {
    return <Card bodyClass="p-5"><p className={`text-sm ${error ? 'text-wcs-red' : 'text-text-muted'}`}>{error || 'Loading progress…'}</p></Card>
  }
  if (!data.exercises.length) {
    return <Card bodyClass="p-6 text-center"><p className="text-sm text-text-muted">Progress shows up once {member.first_name || 'the client'} has logged a few workouts.</p></Card>
  }

  const points = data.points
  const geo = chartGeometry(points.map(p => ({ x: p.performed_on, y: p[metric] })), { width: W, height: H, pad: PAD })
  const unit = metric === 'volume' ? '' : ' lb'
  const first = geo.dots[0]
  const last = geo.dots[geo.dots.length - 1]
  const change = first && last && geo.dots.length > 1 ? Math.round((last.y - first.y) * 10) / 10 : null

  return (
    <div className="space-y-4">
      <Card bodyClass="p-3 sm:p-4 flex flex-wrap items-center gap-2">
        <select value={data.exercise_id || ''} onChange={e => setExerciseId(e.target.value)} className={`${field} flex-1 min-w-[200px]`} aria-label="Exercise">
          {data.exercises.map(e => <option key={e.exercise_id} value={e.exercise_id}>{e.name} ({e.days} day{e.days === 1 ? '' : 's'})</option>)}
        </select>
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
          {METRICS.map(m => (
            <button key={m.key} onClick={() => setMetric(m.key)} className={`px-3 py-2 font-semibold ${metric === m.key ? 'bg-navy text-white' : 'bg-surface hover:bg-bg'}`}>{m.label}</button>
          ))}
        </div>
      </Card>

      <Card
        title={METRICS.find(m => m.key === metric).label}
        hint={change != null ? `${change > 0 ? '+' : ''}${change}${unit} since ${prettyDay(first.x)}` : null}
        bodyClass="p-3 sm:p-4"
      >
        {geo.dots.length ? (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${METRICS.find(m => m.key === metric).label} over time`}>
            {[0, 0.5, 1].map(t => {
              const y = PAD + t * (H - PAD * 2)
              const v = geo.max - t * (geo.max - geo.min)
              return (
                <g key={t}>
                  <line x1={PAD} x2={W - PAD} y1={y} y2={y} stroke="currentColor" className="text-border" strokeDasharray="3 4" />
                  <text x={4} y={y + 4} fontSize="11" fill="currentColor" className="text-text-muted">{Math.round(v)}</text>
                </g>
              )
            })}
            <path d={geo.path} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-wcs-red" strokeLinejoin="round" strokeLinecap="round" />
            {geo.dots.map(d => (
              <g key={d.x}>
                <circle cx={d.cx} cy={d.cy} r="4" fill="currentColor" className="text-wcs-red"><title>{`${prettyDay(d.x)}: ${d.y}${unit}`}</title></circle>
              </g>
            ))}
            {first ? <text x={first.cx} y={H - 8} fontSize="11" textAnchor="start" fill="currentColor" className="text-text-muted">{prettyDay(first.x)}</text> : null}
            {last && last !== first ? <text x={last.cx} y={H - 8} fontSize="11" textAnchor="end" fill="currentColor" className="text-text-muted">{prettyDay(last.x)}</text> : null}
          </svg>
        ) : <p className="text-sm text-text-muted">No weighted sets logged for this exercise yet.</p>}
      </Card>

      <Card title="Sessions">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-4 py-2 font-semibold">Top set</th>
                <th className="px-4 py-2 font-semibold">Est. 1RM</th>
                <th className="px-4 py-2 font-semibold">Volume</th>
                <th className="px-4 py-2 font-semibold">Sets</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...points].reverse().map(p => (
                <tr key={p.performed_on}>
                  <td className="px-4 py-2 whitespace-nowrap">{prettyDay(p.performed_on)}</td>
                  <td className="px-4 py-2">{p.bestWeight != null ? `${p.bestWeight} × ${p.bestReps ?? '-'}` : '-'}</td>
                  <td className="px-4 py-2">{p.est1rm ?? '-'}</td>
                  <td className="px-4 py-2">{p.volume || '-'}</td>
                  <td className="px-4 py-2">{p.sets}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
