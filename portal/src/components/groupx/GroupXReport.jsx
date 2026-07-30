import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const RANGES = [
  {
    key: 'this-month',
    label: 'This month',
    calc: () => {
      const n = new Date()
      return [toISO(new Date(n.getFullYear(), n.getMonth(), 1)), toISO(n)]
    },
  },
  {
    key: 'last-month',
    label: 'Last month',
    calc: () => {
      const n = new Date()
      return [
        toISO(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
        toISO(new Date(n.getFullYear(), n.getMonth(), 0)),
      ]
    },
  },
  {
    key: 'last-90',
    label: 'Last 90 days',
    calc: () => {
      const n = new Date()
      const s = new Date(n)
      s.setDate(s.getDate() - 89)
      return [toISO(s), toISO(n)]
    },
  },
  {
    key: 'ytd',
    label: 'Year to date',
    calc: () => {
      const n = new Date()
      return [toISO(new Date(n.getFullYear(), 0, 1)), toISO(n)]
    },
  },
]

function pct(v) {
  // null capacity gets an en dash, never a fabricated 0%.
  return v == null ? '–' : `${Math.round(v * 100)}%`
}

function Card({ title, subtitle, rows, nameHeader }) {
  // A bucket with nothing in it renders nothing at all.
  if (!rows || rows.length === 0) return null
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <h3 className="font-semibold text-text-primary">{title}</h3>
      {subtitle && <p className="text-xs text-text-muted mb-2">{subtitle}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-text-muted border-b border-border">
              <th className="py-1.5 pr-3 font-medium">{nameHeader}</th>
              <th className="py-1.5 px-2 font-medium text-right">Classes</th>
              <th className="py-1.5 px-2 font-medium text-right">Attendees</th>
              <th className="py-1.5 px-2 font-medium text-right">Avg</th>
              <th className="py-1.5 pl-2 font-medium text-right">Full</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-border last:border-b-0">
                <td className="py-1.5 pr-3 text-text-primary">{r.key}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text-muted">{r.sessions}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text-muted">{r.total_attendees}</td>
                <td className="py-1.5 px-2 text-right tabular-nums font-medium text-text-primary">{r.avg_headcount}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-text-muted">{pct(r.fill_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function GroupXReport({ clubs }) {
  const [clubNumber, setClubNumber] = useState('all')
  const [rangeKey, setRangeKey] = useState('last-90')
  const [[start, end], setRange] = useState(RANGES[2].calc())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  function pickRange(r) {
    setRangeKey(r.key)
    setRange(r.calc())
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api(`/group-x/report?club_number=${clubNumber}&start=${start}&end=${end}`))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [clubNumber, start, end])

  useEffect(() => { load() }, [load])

  const empty = data && data.totals.sessions === 0

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setClubNumber('all')}
            className={`px-3 py-1.5 text-sm rounded-lg border transition ${
              clubNumber === 'all' ? 'bg-wcs-red text-white border-wcs-red font-medium' : 'border-border text-text-primary hover:bg-bg'
            }`}>
            All clubs
          </button>
          {clubs.map(c => (
            <button key={c.slug} type="button" onClick={() => setClubNumber(c.clubNumber)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                clubNumber === c.clubNumber ? 'bg-wcs-red text-white border-wcs-red font-medium' : 'border-border text-text-primary hover:bg-bg'
              }`}>
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map(r => (
            <button key={r.key} type="button" onClick={() => pickRange(r)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                rangeKey === r.key ? 'bg-wcs-red text-white border-wcs-red font-medium' : 'border-border text-text-primary hover:bg-bg'
              }`}>
              {r.label}
            </button>
          ))}
          <input type="date" value={start} onChange={e => { setRangeKey('custom'); setRange([e.target.value, end]) }}
            className="border border-border rounded-lg px-2 py-1.5 text-sm bg-surface text-text-primary" />
          <span className="text-text-muted text-sm">to</span>
          <input type="date" value={end} onChange={e => { setRangeKey('custom'); setRange([start, e.target.value]) }}
            className="border border-border rounded-lg px-2 py-1.5 text-sm bg-surface text-text-primary" />
          {loading && <span className="text-xs text-text-muted">Loading...</span>}
        </div>
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-red-300 p-4 text-sm text-red-900">{error}</div>
      )}

      {data && !empty && (
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-text-muted">Classes held</div>
              <div className="text-2xl font-semibold text-text-primary tabular-nums">{data.totals.sessions}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Total attendees</div>
              <div className="text-2xl font-semibold text-text-primary tabular-nums">{data.totals.total_attendees}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Average per class</div>
              <div className="text-2xl font-semibold text-text-primary tabular-nums">{data.totals.avg_headcount}</div>
            </div>
          </div>
        </div>
      )}

      {empty && (
        <div className="bg-surface rounded-xl border border-border p-6 text-sm text-text-muted">
          No attendance logged in this range yet. Counts recorded on the calendar show up here.
        </div>
      )}

      {data && !empty && (
        <>
          <Card title="By class" nameHeader="Class" rows={data.by_class}
            subtitle="Which classes fill up and which do not" />
          <Card title="By instructor" nameHeader="Instructor" rows={data.by_instructor} />
          <Card title="By day of week" nameHeader="Day" rows={data.by_weekday} />
          <Card title="By time of day" nameHeader="Time" rows={data.by_time_bucket} />
          <p className="text-xs text-text-muted px-1">
            Full is attendees against ABC capacity, counting only classes whose capacity is known.
            A dash means no capacity was recorded.
          </p>
        </>
      )}
    </div>
  )
}
