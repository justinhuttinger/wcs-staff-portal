import { useEffect, useState } from 'react'
import { nps as npsApi } from '../../lib/api'

function pacificToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function shiftDay(date, days) {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

function timeOnly(ts) {
  if (!ts) return null
  return new Date(ts).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit',
  })
}

const OUTCOME_STYLES = [
  [/^failed/, 'bg-red-50 border border-red-200 text-red-700'],
  [/dry run/, 'bg-gray-100 border border-gray-200 text-gray-600'],
  [/answered/, 'bg-green-50 border border-green-200 text-green-700'],
  [/opened/, 'bg-blue-50 border border-blue-200 text-blue-700'],
  [/tagged/, 'bg-green-50 border border-green-200 text-green-700'],
]

function outcomeStyle(outcome) {
  const hit = OUTCOME_STYLES.find(([re]) => re.test(outcome))
  return hit ? hit[1] : 'bg-gray-100 border border-gray-200 text-gray-600'
}

function Stat({ label, value, muted }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`text-xl font-bold ${muted ? 'text-text-muted' : 'text-text-primary'}`}>{value}</p>
    </div>
  )
}

export default function SentLog() {
  const [date, setDate] = useState(pacificToday())
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [hideTests, setHideTests] = useState(false)

  useEffect(() => {
    setData(null)
    setError('')
    npsApi.sentLog(date).then(setData).catch(err => setError(err.message))
  }, [date])

  const rows = (data?.rows || []).filter(r => (hideTests ? !r.is_test : true))

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Who got tagged</h3>
            <p className="text-xs text-text-muted mt-0.5">
              What the nightly job did on this day, Pacific time.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button" onClick={() => setDate(d => shiftDay(d, -1))}
              className="px-3 py-2 text-sm text-text-primary border border-border rounded-lg hover:bg-bg transition-colors"
            >
              Previous
            </button>
            <input
              type="date" value={date} onChange={e => setDate(e.target.value)}
              className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
            <button
              type="button" onClick={() => setDate(d => shiftDay(d, 1))}
              disabled={date >= pacificToday()}
              className="px-3 py-2 text-sm text-text-primary border border-border rounded-lg hover:bg-bg transition-colors disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>

        {data && (
          <div className="flex flex-wrap gap-6">
            <Stat label="Invites" value={data.summary.total} />
            <Stat label="Tagged" value={data.summary.tagged} />
            <Stat label="Opened" value={data.summary.opened} />
            <Stat label="Answered" value={data.summary.answered} />
            {data.summary.dry_run > 0 && <Stat label="Dry run" value={data.summary.dry_run} muted />}
            {data.summary.tests > 0 && <Stat label="Tests" value={data.summary.tests} muted />}
            {data.summary.failed > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Failed</p>
                <p className="text-xl font-bold text-wcs-red">{data.summary.failed}</p>
              </div>
            )}
          </div>
        )}

        {data?.summary.tests > 0 && (
          <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
            <input
              type="checkbox" checked={hideTests}
              onChange={e => setHideTests(e.target.checked)}
              className="w-4 h-4 accent-wcs-red"
            />
            Hide test sends
          </label>
        )}
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-border px-4 py-3">
          <p className="text-sm text-wcs-red">{error}</p>
        </div>
      )}

      {!data && !error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-text-muted">Loading…</p>
        </div>
      )}

      {data && rows.length === 0 && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center space-y-1">
          <p className="text-sm font-semibold text-text-primary">Nothing went out</p>
          <p className="text-xs text-text-muted">
            No invites were created on this day. That is expected while the
            nightly job is switched off.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="pb-2 pr-4 font-semibold">Member</th>
                  <th className="pb-2 pr-4 font-semibold">Gym</th>
                  <th className="pb-2 pr-4 font-semibold">Survey</th>
                  <th className="pb-2 pr-4 font-semibold">Outcome</th>
                  <th className="pb-2 font-semibold">Tagged</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-border last:border-0 align-top">
                    <td className="py-2 pr-4">
                      <span className="block text-text-primary">{r.member_name || r.member_id}</span>
                      <span className="block text-xs text-text-muted">{r.member_email}</span>
                    </td>
                    <td className="py-2 pr-4 text-text-primary whitespace-nowrap">{r.club_name}</td>
                    <td className="py-2 pr-4 text-text-primary">{r.survey_title}</td>
                    <td className="py-2 pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${outcomeStyle(r.outcome)}`}>
                        {r.outcome}
                      </span>
                      {r.is_test && (
                        <span className="ml-1 inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 border border-gray-200 text-gray-600">
                          test
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-text-muted whitespace-nowrap">
                      {timeOnly(r.tagged_at) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
