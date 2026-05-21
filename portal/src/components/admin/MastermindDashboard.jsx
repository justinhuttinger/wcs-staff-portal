import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

export default function MastermindDashboard() {
  const [stats, setStats] = useState(null)
  const [queue, setQueue] = useState(null)
  const [errors, setErrors] = useState(null)
  const [days, setDays] = useState(30)
  const [tab, setTab] = useState('overview')
  const [loadErr, setLoadErr] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    setRefreshing(true)
    setLoadErr(null)
    try {
      const [s, q, e] = await Promise.all([
        api(`/admin/mastermind/stats?days=${days}`),
        api('/admin/mastermind/queue?limit=50'),
        api('/admin/mastermind/errors?limit=20'),
      ])
      setStats(s)
      setQueue(q?.rows || [])
      setErrors(e?.rows || [])
    } catch (err) {
      setLoadErr(err?.message || String(err))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [days])  // eslint-disable-line react-hooks/exhaustive-deps

  if (loadErr) {
    return <div className="p-6 text-red-500">Error loading Mastermind stats: {loadErr}</div>
  }
  if (!stats) {
    return <div className="p-6 text-text-muted">Loading…</div>
  }

  const dailyPct = stats.daily_cap_usd > 0
    ? Math.min(100, (stats.today_cost_usd / stats.daily_cap_usd) * 100)
    : 0

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Marketing Mastermind</h1>
          <p className="text-sm text-text-muted">
            Status:{' '}
            <span className={stats.enabled ? 'text-emerald-500' : 'text-amber-500'}>
              {stats.enabled ? 'Enabled' : 'Disabled (set MASTERMIND_ENABLED=true)'}
            </span>
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-sm text-text-muted">Window</label>
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="bg-surface border border-border rounded px-2 py-1 text-sm"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button
            onClick={load}
            disabled={refreshing}
            className="px-3 py-1 text-sm rounded border border-border hover:bg-surface-hover disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label={`Cost (last ${days}d)`} value={`$${Number(stats.total_cost_usd).toFixed(2)}`} />
        <StatCard label="Today" value={`$${Number(stats.today_cost_usd).toFixed(2)} / $${stats.daily_cap_usd}`}>
          <div className="mt-2 h-1.5 bg-border/40 rounded overflow-hidden">
            <div
              className={`h-full ${dailyPct >= 100 ? 'bg-red-500' : dailyPct >= 75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${dailyPct}%` }}
            />
          </div>
        </StatCard>
        <StatCard label="Invocations (done)" value={stats.invocations_done} />
        <StatCard
          label="Failed / Pending"
          value={`${stats.invocations_failed} / ${stats.invocations_pending}`}
        />
      </div>

      <nav className="flex gap-2 border-b border-border">
        {['overview', 'queue', 'errors'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${
              tab === t
                ? 'border-emerald-500 text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {t === 'overview' ? 'Overview' : t === 'queue' ? `Queue (${queue?.length || 0})` : `Errors (${errors?.length || 0})`}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Section title="By mode"><BreakdownTable data={stats.by_mode} /></Section>
          <Section title="By lane"><BreakdownTable data={stats.by_lane} /></Section>
          <Section title="By model"><BreakdownTable data={stats.by_model} /></Section>

          <Section title="Top 10 most expensive" className="md:col-span-3">
            <table className="w-full text-sm">
              <thead className="text-text-muted">
                <tr>
                  <th className="text-left py-1">Task</th>
                  <th className="text-left py-1">Mode</th>
                  <th className="text-left py-1">Model</th>
                  <th className="text-right py-1">Cost</th>
                  <th className="text-left py-1">Completed</th>
                </tr>
              </thead>
              <tbody>
                {(stats.top_tasks || []).map(t => (
                  <tr key={`${t.task_id}-${t.completed_at}`} className="border-t border-border/40">
                    <td className="py-1">
                      <a
                        href={`https://app.clickup.com/t/${t.task_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-500 hover:underline"
                      >
                        {t.task_id}
                      </a>
                    </td>
                    <td className="py-1">{t.mode}</td>
                    <td className="py-1 text-text-muted text-xs">{t.model}</td>
                    <td className="py-1 text-right">${Number(t.cost_usd || 0).toFixed(4)}</td>
                    <td className="py-1 text-text-muted text-xs">
                      {t.completed_at ? new Date(t.completed_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
                {(stats.top_tasks || []).length === 0 && (
                  <tr><td colSpan={5} className="py-3 text-center text-text-muted">No completed invocations yet.</td></tr>
                )}
              </tbody>
            </table>
          </Section>
        </div>
      )}

      {tab === 'queue' && (
        <Section title="Recent queue rows">
          <QueueTable rows={queue || []} />
        </Section>
      )}

      {tab === 'errors' && (
        <Section title="Recent webhook errors">
          <ErrorTable rows={errors || []} />
        </Section>
      )}
    </div>
  )
}

function StatCard({ label, value, children }) {
  return (
    <div className="rounded-lg border border-border bg-surface/70 p-4">
      <div className="text-xs uppercase text-text-muted tracking-wide">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {children}
    </div>
  )
}

function Section({ title, className, children }) {
  return (
    <div className={className}>
      <h2 className="text-base font-medium mb-2">{title}</h2>
      {children}
    </div>
  )
}

function BreakdownTable({ data }) {
  const entries = Object.entries(data || {}).sort((a, b) => Number(b[1]) - Number(a[1]))
  if (entries.length === 0) {
    return <div className="text-sm text-text-muted">No data.</div>
  }
  return (
    <table className="w-full text-sm">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="border-t border-border/40">
            <td className="py-1">{k}</td>
            <td className="py-1 text-right">${Number(v).toFixed(4)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function QueueTable({ rows }) {
  if (rows.length === 0) {
    return <div className="text-sm text-text-muted">Queue is empty.</div>
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-text-muted">
        <tr>
          <th className="text-left py-1">Requested</th>
          <th className="text-left py-1">Task</th>
          <th className="text-left py-1">Mode</th>
          <th className="text-left py-1">Status</th>
          <th className="text-right py-1">Cost</th>
          <th className="text-left py-1">Error</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} className="border-t border-border/40">
            <td className="py-1 text-xs text-text-muted whitespace-nowrap">{new Date(r.requested_at).toLocaleString()}</td>
            <td className="py-1">
              <a href={`https://app.clickup.com/t/${r.task_id}`} target="_blank" rel="noreferrer" className="text-emerald-500 hover:underline">
                {r.task_id}
              </a>
            </td>
            <td className="py-1">{r.mode}</td>
            <td className={`py-1 ${
              r.status === 'done' ? 'text-emerald-500'
                : r.status === 'failed' ? 'text-red-500'
                : r.status === 'working' ? 'text-amber-500'
                : 'text-text-muted'
            }`}>{r.status}</td>
            <td className="py-1 text-right">{r.cost_usd != null ? `$${Number(r.cost_usd).toFixed(4)}` : '—'}</td>
            <td className="py-1 text-xs text-red-400 max-w-xs truncate" title={r.error || ''}>{r.error || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ErrorTable({ rows }) {
  if (rows.length === 0) {
    return <div className="text-sm text-text-muted">No errors logged.</div>
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-text-muted">
        <tr>
          <th className="text-left py-1">When</th>
          <th className="text-left py-1">Kind</th>
          <th className="text-left py-1">Message</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} className="border-t border-border/40">
            <td className="py-1 text-xs text-text-muted whitespace-nowrap">{new Date(r.error_at).toLocaleString()}</td>
            <td className="py-1 text-amber-500">{r.error_kind}</td>
            <td className="py-1 text-xs">{r.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
