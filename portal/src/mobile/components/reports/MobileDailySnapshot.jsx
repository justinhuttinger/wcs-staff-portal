import { useEffect, useMemo, useState } from 'react'
import { getDailySnapshot } from '../../../lib/api'
import MobileLoading from '../MobileLoading'

const DATE_PRESETS = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'today', label: 'Today' },
  { key: 'custom', label: 'Custom' },
]

const LOCATIONS = ['All', 'Salem', 'Keizer', 'Eugene', 'Springfield', 'Clackamas', 'Milwaukie', 'Medford']

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

function pickPresetForDate(dateStr) {
  if (dateStr === todayInPacific()) return 'today'
  if (dateStr === yesterdayInPacific()) return 'yesterday'
  return 'custom'
}

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })
}

function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
        active ? 'bg-wcs-red text-white' : 'bg-bg text-text-secondary border border-border'
      }`}
    >
      {children}
    </button>
  )
}

function StatBlock({ label, value }) {
  return (
    <div className="bg-bg rounded-lg p-3">
      <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-text-primary mt-0.5">{value}</p>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted mb-3">{title}</h3>
      {children}
    </div>
  )
}

function NamesList({ names }) {
  if (!names || names.length === 0) return <p className="text-xs text-text-muted">No appointments.</p>
  return (
    <ul className="divide-y divide-border max-h-60 overflow-y-auto">
      {names.map((evt, i) => (
        <li key={i} className="py-2 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-primary truncate">{evt.name}</p>
            {evt.location && <p className="text-[10px] text-text-muted truncate">{evt.location}{evt.time ? ` · ${fmtTime(evt.time)}` : ''}</p>}
          </div>
          {evt.status && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
              evt.status === 'showed' ? 'bg-green-50 text-green-700' :
              evt.status === 'noshow' || evt.status === 'no_show' ? 'bg-red-50 text-red-700' :
              evt.status === 'cancelled' ? 'bg-gray-100 text-text-muted' :
              'bg-bg text-text-secondary'
            }`}>{evt.status}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function MobileDailySnapshot() {
  const [date, setDate] = useState(() => todayInPacific())
  const [preset, setPreset] = useState('today')
  const [location, setLocation] = useState('All')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  function applyPreset(key) {
    setPreset(key)
    if (key === 'today') setDate(todayInPacific())
    else if (key === 'yesterday') setDate(yesterdayInPacific())
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
          location: location === 'All' ? undefined : location.toLowerCase(),
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
  }, [date, location])

  const mode = data?.mode || 'today'
  const headline = useMemo(() => {
    if (mode === 'past') return 'Retrospective'
    if (mode === 'today') return 'Today'
    return 'Upcoming'
  }, [mode])

  return (
    <div className="pb-6 space-y-3">
      <div className="mx-4 mt-4 bg-surface/95 backdrop-blur-sm rounded-2xl border border-border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-text-primary">Daily Snapshot</h2>
          <span className="text-[10px] text-text-muted italic">{headline}</span>
        </div>
        <div className="flex gap-1.5">
          {DATE_PRESETS.map(p => (
            <Pill key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>
              {p.label}
            </Pill>
          ))}
        </div>
        <input
          type="date"
          value={date}
          onChange={e => handleDateChange(e.target.value)}
          className="w-full bg-bg border border-border rounded-lg px-2.5 py-2 text-xs text-text-primary"
        />
        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Location</p>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {LOCATIONS.map(loc => (
              <Pill key={loc} active={location === loc} onClick={() => setLocation(loc)}>
                {loc}
              </Pill>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-sm text-red-700 font-medium">Error loading snapshot</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
        </div>
      )}

      {loading ? (
        <MobileLoading variant="stats" count={4} />
      ) : (
        <div className="px-4 space-y-3">
          <Card title="Day One">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <StatBlock label={mode === 'past' ? 'Booked' : 'Scheduled'} value={data?.day_one?.scheduled ?? 0} />
              {mode === 'past' && <StatBlock label="No-show / cancel" value={data?.day_one?.no_show ?? 0} />}
            </div>
            <NamesList names={data?.day_one?.names} />
          </Card>

          <Card title="Tours">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <StatBlock label={mode === 'past' ? 'Booked' : 'Scheduled'} value={data?.tours?.scheduled ?? 0} />
              {mode === 'past' && <StatBlock label="No-show / cancel" value={data?.tours?.no_show ?? 0} />}
            </div>
            <NamesList names={data?.tours?.names} />
          </Card>

          {mode === 'past' ? (
            <>
              <Card title="Membership Sales">
                <StatBlock label="New members signed" value={data?.membership_sales?.count ?? 0} />
                <p className="text-[10px] text-text-muted mt-2">First ABC payment on {date}.</p>
              </Card>
              <Card title="PT New Sales">
                <StatBlock label="PT clients sold" value={data?.pt_new_sales?.count ?? 0} />
              </Card>
              <Card title="Revenue by Profit Center">
                <p className="text-2xl font-bold text-text-primary mb-3">{fmtMoney(data?.revenue?.total)}</p>
                {data?.revenue?.by_profit_center?.length > 0 ? (
                  <ul className="divide-y divide-border max-h-60 overflow-y-auto">
                    {data.revenue.by_profit_center.map((row, i) => (
                      <li key={i} className="py-1.5 flex items-center justify-between text-xs">
                        <span className="text-text-primary truncate pr-2">{row.profit_center}</span>
                        <span className="text-text-secondary font-medium shrink-0">{fmtMoney(row.amount)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-text-muted">No revenue recorded.</p>
                )}
              </Card>
            </>
          ) : (
            <Card title="Sales & Revenue">
              <p className="text-xs text-text-muted">
                {mode === 'today'
                  ? "ABC revenue uploads overnight — today's figures appear in tomorrow's snapshot."
                  : 'Available only for past dates.'}
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
