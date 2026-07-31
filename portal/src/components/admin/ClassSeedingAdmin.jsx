import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

export default function ClassSeedingAdmin() {
  const [config, setConfig] = useState(null)
  const [log, setLog] = useState([])
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [runResult, setRunResult] = useState(null)

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([api('/class-seeding/config'), api('/class-seeding/log')])
      setConfig(c)
      setLog(l.log || [])
    } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => { load() }, [load])

  function settingFor(clubNumber) {
    return (config?.settings || []).find(s => s.club_number === clubNumber)
      || { club_number: clubNumber, enabled: false, min_count: 1, max_count: 3 }
  }

  async function saveSetting(clubNumber, patch) {
    const cur = settingFor(clubNumber)
    setBusy(true); setError(null)
    try {
      await api('/class-seeding/settings', {
        method: 'PUT',
        body: JSON.stringify({
          club_number: clubNumber,
          enabled: cur.enabled,
          min_count: cur.min_count,
          max_count: cur.max_count,
          ...patch,
        }),
      })
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function addAccount(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api('/class-seeding/accounts', {
        method: 'POST',
        body: JSON.stringify({ member_id: newId.trim(), display_name: newName.trim() }),
      })
      setNewId(''); setNewName('')
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function removeAccount(id) {
    setBusy(true); setError(null)
    try {
      await api(`/class-seeding/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function run(dry) {
    setBusy(true); setError(null); setRunResult(null)
    try {
      const r = await api(`/class-seeding/run${dry ? '?dry=1' : ''}`, { method: 'POST' })
      setRunResult({ dry, results: r.results })
      if (!dry) await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function undo(entry) {
    if (!window.confirm(`Remove ${entry.member_id} from ${entry.class_name || 'this class'}?`)) return
    setBusy(true); setError(null)
    try {
      await api(`/class-seeding/log/${entry.id}`, { method: 'DELETE' })
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (!config) {
    return (
      <div className="bg-surface rounded-xl border border-border p-6 text-sm text-text-muted">
        {error ? `Could not load: ${error}` : 'Loading...'}
      </div>
    )
  }

  const noAccounts = config.active_account_count === 0

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-4">
        <h3 className="font-semibold text-text-primary">Class seeding</h3>
        <p className="text-xs text-text-muted mt-1">
          Each night this books a few house accounts into Group X classes that nobody has
          booked, so the ABC app does not show an empty class when the room is actually busy.
          It only touches classes with zero bookings, and only within ABC's 14 day booking
          window.
        </p>
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-red-300 p-4 text-sm text-red-900">{error}</div>
      )}

      {noAccounts && (
        <div className="bg-surface rounded-xl border border-amber-300 p-4 text-sm text-amber-900">
          No house accounts yet. Add at least one below or nothing will be seeded.
        </div>
      )}

      {/* Accounts */}
      <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-text-primary">House accounts</h3>
          <p className="text-xs text-text-muted">
            The same accounts are used at every club. Paste the ABC member id for each one.
          </p>
        </div>

        <form onSubmit={addAccount} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-text-muted mb-1">ABC member id</label>
            <input type="text" value={newId} onChange={e => setNewId(e.target.value)} required
              placeholder="ae2270f06f9749d1a9414be65aba7f58"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono bg-surface text-text-primary" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} required
              placeholder="Group X Attendant A"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
          </div>
          <button type="submit" disabled={busy || !newId.trim() || !newName.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
            Add
          </button>
        </form>

        {config.accounts.length > 0 && (
          <div className="divide-y divide-border">
            {config.accounts.map(a => (
              <div key={a.member_id} className="py-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{a.display_name}</span>
                <code className="text-xs text-text-muted font-mono break-all">{a.member_id}</code>
                <button type="button" onClick={() => removeAccount(a.member_id)} disabled={busy}
                  className="ml-auto px-2.5 py-1 text-xs rounded-md border border-border text-text-primary hover:bg-bg disabled:opacity-50">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-club ranges */}
      <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-text-primary">How many per class</h3>
          <p className="text-xs text-text-muted">
            A number is picked at random inside this range for each class.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Club</th>
                <th className="py-1.5 px-2 font-medium">On</th>
                <th className="py-1.5 px-2 font-medium">Min</th>
                <th className="py-1.5 px-2 font-medium">Max</th>
              </tr>
            </thead>
            <tbody>
              {config.clubs.map(c => {
                const s = settingFor(c.clubNumber)
                return (
                  <tr key={c.slug} className="border-b border-border last:border-b-0">
                    <td className="py-2 pr-3 font-medium text-text-primary whitespace-nowrap">{c.name}</td>
                    <td className="py-2 px-2">
                      <input type="checkbox" checked={!!s.enabled} disabled={busy}
                        onChange={e => saveSetting(c.clubNumber, { enabled: e.target.checked })}
                        className="accent-wcs-red" />
                    </td>
                    <td className="py-2 px-2">
                      <input type="number" min="0" max="25" value={s.min_count} disabled={busy}
                        onChange={e => saveSetting(c.clubNumber, { min_count: parseInt(e.target.value, 10) || 0 })}
                        className="w-16 border border-border rounded-lg px-2 py-1 text-sm bg-surface text-text-primary" />
                    </td>
                    <td className="py-2 px-2">
                      <input type="number" min="0" max="25" value={s.max_count} disabled={busy}
                        onChange={e => saveSetting(c.clubNumber, { max_count: parseInt(e.target.value, 10) || 0 })}
                        className="w-16 border border-border rounded-lg px-2 py-1 text-sm bg-surface text-text-primary" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Run */}
      <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <h3 className="font-semibold text-text-primary">Run now</h3>
            <p className="text-xs text-text-muted">Runs automatically at 2:40am. Preview writes nothing.</p>
          </div>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => run(true)} disabled={busy}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg disabled:opacity-50">
              Preview
            </button>
            <button type="button" onClick={() => run(false)} disabled={busy || noAccounts}
              className="px-3 py-1.5 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
              {busy ? 'Working...' : 'Run now'}
            </button>
          </div>
        </div>

        {runResult && (
          <div className="rounded-lg border border-border overflow-x-auto">
            <div className="px-3 py-1.5 text-xs text-text-muted border-b border-border">
              {runResult.dry ? 'Preview only, nothing was written to ABC' : 'Completed'}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {runResult.results.map(r => (
                  <tr key={r.club_number} className="border-b border-border last:border-b-0">
                    <td className="py-1.5 px-3 text-text-primary">{r.club}</td>
                    <td className="py-1.5 px-2 text-xs text-text-muted">
                      {r.error
                        ? r.error
                        : `${r.considered} empty classes, ${r.enrolled} bookings across ${r.seeded_classes}` +
                          (r.failed ? `, ${r.failed} failed` : '') +
                          (r.skipped_already ? `, ${r.skipped_already} already done` : '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Audit log */}
      {log.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-4">
          <h3 className="font-semibold text-text-primary mb-2">Recent bookings</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {log.slice(0, 60).map(e => (
                  <tr key={e.id} className="border-b border-border last:border-b-0">
                    <td className="py-1.5 pr-2 text-text-primary whitespace-nowrap">{e.class_name || 'Class'}</td>
                    <td className="py-1.5 px-2 text-xs text-text-muted whitespace-nowrap">{e.event_local}</td>
                    <td className="py-1.5 px-2 text-xs text-text-muted font-mono break-all">{e.member_id}</td>
                    <td className="py-1.5 px-2 text-xs">
                      {e.ok
                        ? <span className="text-green-700">booked</span>
                        : <span className="text-red-700" title={e.error}>failed</span>}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      {e.ok && (
                        <button type="button" onClick={() => undo(e)} disabled={busy}
                          className="px-2 py-0.5 text-xs rounded border border-border text-text-primary hover:bg-bg disabled:opacity-50">
                          Undo
                        </button>
                      )}
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
