import { useEffect, useMemo, useState } from 'react'
import { getDailySnapshot } from '../../lib/api'

const DATE_PRESETS = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'today', label: 'Today' },
  { key: 'custom', label: 'Custom' },
]

function toDateInput(d) {
  return d.toISOString().slice(0, 10)
}

function todayInPacific() {
  const now = new Date()
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const y = pt.getFullYear()
  const m = String(pt.getMonth() + 1).padStart(2, '0')
  const d = String(pt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function yesterdayInPacific() {
  const today = new Date(todayInPacific() + 'T12:00:00Z')
  today.setUTCDate(today.getUTCDate() - 1)
  return toDateInput(today)
}

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })
}

function Card({ title, children, className = '' }) {
  return (
    <div className={`bg-surface rounded-xl border border-border p-5 ${className}`}>
      <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted mb-3">{title}</h3>
      {children}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-text-primary mt-0.5">{value}</p>
    </div>
  )
}

function StatusPill({ status }) {
  if (!status) return null
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
      status === 'showed' ? 'bg-green-50 text-green-700' :
      status === 'noshow' || status === 'no_show' ? 'bg-red-50 text-red-700' :
      status === 'cancelled' ? 'bg-gray-100 text-text-muted' :
      'bg-bg text-text-secondary'
    }`}>{status}</span>
  )
}

function NamesList({ names, showTrainer, showCompletion }) {
  if (!names || names.length === 0) return <p className="text-xs text-text-muted">No appointments.</p>
  return (
    <ul className="divide-y divide-border max-h-72 overflow-y-auto">
      {names.map((evt, i) => (
        <li key={evt.id || i} className="py-2 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-primary truncate">{evt.name}</p>
            <p className="text-[10px] text-text-muted truncate">
              {evt.location}
              {evt.time ? ` · ${fmtTime(evt.time)}` : ''}
              {showTrainer && evt.trainer ? ` · ${evt.trainer}` : ''}
            </p>
            {showCompletion && (
              <div className="flex items-center gap-1 mt-0.5">
                {evt.marked_complete ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-50 text-green-700">✓ marked complete</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-50 text-amber-700">not marked</span>
                )}
                {evt.sale_result && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    /sold|sale/i.test(evt.sale_result) ? 'bg-green-100 text-green-800' :
                    /no.?sale|nosale/i.test(evt.sale_result) ? 'bg-red-50 text-red-700' :
                    'bg-bg text-text-secondary'
                  }`}>{evt.sale_result}</span>
                )}
              </div>
            )}
          </div>
          <StatusPill status={evt.status} />
        </li>
      ))}
    </ul>
  )
}

function MembersList({ members }) {
  if (!members || members.length === 0) return <p className="text-xs text-text-muted">No new members signed.</p>
  return (
    <ul className="divide-y divide-border max-h-80 overflow-y-auto">
      {members.map((m, i) => {
        const full = [m.first_name, m.last_name].filter(Boolean).join(' ') || '(no name)'
        return (
          <li key={m.member_id || i} className="py-2 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary truncate">{full}</p>
              <p className="text-[10px] text-text-muted truncate">
                {m.location}
                {m.membership_type ? ` · ${m.membership_type}` : ''}
                {m.sales_person ? ` · sold by ${m.sales_person}` : ''}
              </p>
            </div>
            {m.booked_day_one && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-50 text-blue-700">Day One ✓</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function SalespeopleList({ rows }) {
  if (!rows || rows.length === 0) return <p className="text-xs text-text-muted">No new sales recorded.</p>
  return (
    <ul className="divide-y divide-border max-h-72 overflow-y-auto">
      {rows.map((r, i) => (
        <li key={i} className="py-2 flex items-center justify-between">
          <span className="text-sm text-text-primary truncate">{r.name}</span>
          <span className="text-sm font-semibold text-text-primary tabular-nums">{r.count}</span>
        </li>
      ))}
    </ul>
  )
}

function pickPresetForDate(dateStr) {
  if (dateStr === todayInPacific()) return 'today'
  if (dateStr === yesterdayInPacific()) return 'yesterday'
  return 'custom'
}

export default function DailySnapshotReport({ locationSlug }) {
  const [date, setDate] = useState(() => todayInPacific())
  const [preset, setPreset] = useState('today')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  function applyPreset(key) {
    setPreset(key)
    if (key === 'today') setDate(todayInPacific())
    else if (key === 'yesterday') setDate(yesterdayInPacific())
    // custom keeps the current date
  }

  function handleDateChange(value) {
    setDate(value)
    setPreset(pickPresetForDate(value))
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await getDailySnapshot({
          date,
          location: locationSlug && locationSlug !== 'all' ? locationSlug : undefined,
        })
        if (!cancelled) setData(res)
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load snapshot')
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [date, locationSlug])

  const mode = data?.mode || 'today'

  const headline = useMemo(() => {
    if (mode === 'past') return 'Retrospective — how it went'
    if (mode === 'today') return "Today's schedule + planning"
    return 'Upcoming schedule'
  }, [mode])

  return (
    <div className="space-y-5">
      <div className="bg-surface rounded-xl border border-border p-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {DATE_PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                preset === p.key
                  ? 'bg-text-primary text-white border-text-primary'
                  : 'bg-bg text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={date}
          onChange={e => handleDateChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
        />
        <p className="text-xs text-text-muted ml-auto italic">{headline}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700 font-medium">Error loading snapshot</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
        </div>
      )}

      {data?.panel_errors && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs text-amber-800">
            Some panels failed to load: <span className="font-medium">{Object.keys(data.panel_errors).join(', ')}</span>. Other panels still rendered.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card title="Day One">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Stat label={mode === 'past' ? 'Booked' : 'Scheduled'} value={loading ? '—' : (data?.day_one?.scheduled ?? 0)} />
            {mode === 'past' && (
              <>
                <Stat label="Marked complete" value={loading ? '—' : (data?.day_one?.completed ?? 0)} />
                <Stat label="No-show / cancel" value={loading ? '—' : (data?.day_one?.no_show ?? 0)} />
              </>
            )}
          </div>
          <NamesList names={data?.day_one?.names} showTrainer showCompletion={mode === 'past'} />
        </Card>

        <Card title="Tours">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Stat label={mode === 'past' ? 'Booked' : 'Scheduled'} value={loading ? '—' : (data?.tours?.scheduled ?? 0)} />
            {mode === 'past' && (
              <Stat label="No-show / cancel" value={loading ? '—' : (data?.tours?.no_show ?? 0)} />
            )}
          </div>
          <NamesList names={data?.tours?.names} />
        </Card>

        {mode === 'past' ? (
          <>
            <Card title="Membership Sales" className="md:col-span-2">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Stat label="New members signed" value={loading ? '—' : (data?.membership_sales?.count ?? 0)} />
              </div>
              <p className="text-[10px] text-text-muted mb-3">Members whose <span className="font-medium">sign_date</span> in ABC is {date}.</p>
              <MembersList members={data?.membership_sales?.members} />
            </Card>

            <Card title="Top Salespeople">
              <SalespeopleList rows={data?.membership_sales?.top_salespeople} />
            </Card>

            <Card title="PT New Sales">
              <Stat label="PT clients sold" value={loading ? '—' : (data?.pt_new_sales?.count ?? 0)} />
              <p className="text-[10px] text-text-muted mt-2">Distinct members billed under PT profit centers.</p>
            </Card>

            <Card title="Revenue by Profit Center" className="md:col-span-2">
              <p className="text-3xl font-bold text-text-primary mb-3">{loading ? '—' : fmtMoney(data?.revenue?.total)}</p>
              {data?.revenue?.by_profit_center?.length > 0 ? (
                <ul className="divide-y divide-border max-h-72 overflow-y-auto">
                  {data.revenue.by_profit_center.map((row, i) => (
                    <li key={i} className="py-1.5 flex items-center justify-between text-sm">
                      <span className="text-text-primary">{row.profit_center}</span>
                      <span className="text-text-secondary font-medium">{fmtMoney(row.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-text-muted">No revenue recorded for {date}.</p>
              )}
            </Card>
          </>
        ) : (
          <Card title="Sales & Revenue" className="md:col-span-2">
            <p className="text-sm text-text-muted">
              {mode === 'today'
                ? "ABC revenue is uploaded overnight — today's sales and revenue figures will appear in tomorrow's snapshot."
                : 'Sales and revenue figures are only available for past dates.'}
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
