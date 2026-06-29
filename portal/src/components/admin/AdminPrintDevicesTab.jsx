import { useEffect, useState } from 'react'
import { getPrintDevices, updatePrintDevice, testPrintDevice } from '../../lib/api'

function minutesAgo(iso) {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + 'm ago'
  return Math.round(mins / 60) + 'h ago'
}

export default function AdminPrintDevicesTab() {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true)
    try { const { devices } = await getPrintDevices(); setDevices(devices || []) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function onChange(install_id, patch) {
    setBusy(install_id)
    try { await updatePrintDevice(install_id, patch); await load() }
    finally { setBusy('') }
  }
  async function onTest(install_id) {
    setBusy(install_id); setMsg('')
    try { await testPrintDevice(install_id); setMsg('Test print queued. It prints within ~30s.') }
    catch (e) { setMsg('Test failed: ' + (e?.message || 'error')) }
    finally { setBusy('') }
  }

  if (loading) return <div className="p-4 text-text-muted">Loading devices...</div>
  if (!devices.length) return <div className="p-4 text-text-muted">No devices have checked in yet. Install the launcher at a gym and it will appear here.</div>

  return (
    <div className="p-4 space-y-4">
      {msg && <div className="text-sm text-text-muted">{msg}</div>}
      {devices.map(d => {
        const online = d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) < 5 * 60000
        const printers = Array.isArray(d.available_printers) ? d.available_printers : []
        return (
          <div key={d.install_id} className="bg-surface border border-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-text-primary capitalize">{d.location_slug || 'Unassigned'}</div>
                <div className="text-xs text-text-muted">{d.hostname || d.install_id}</div>
              </div>
              <span className={'text-xs px-2 py-0.5 rounded ' + (online ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-text-muted')}>
                {online ? 'online' : 'last seen ' + minutesAgo(d.last_seen)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <select
                className="bg-background border border-border rounded px-2 py-1 text-sm"
                value={d.selected_printer || ''}
                disabled={busy === d.install_id}
                onChange={e => onChange(d.install_id, { selected_printer: e.target.value })}
              >
                <option value="">Select a printer...</option>
                {printers.map(p => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (default)' : ''}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!d.enabled} disabled={busy === d.install_id}
                  onChange={e => onChange(d.install_id, { enabled: e.target.checked })} />
                Enabled
              </label>
              <button
                className="text-sm px-3 py-1 rounded bg-primary/20 text-primary disabled:opacity-50"
                disabled={busy === d.install_id || !d.enabled || !d.selected_printer}
                onClick={() => onTest(d.install_id)}
              >Test Print</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
