import { useState, useEffect } from 'react'
import { onlineJoin } from '../../lib/api'

function CopyRow({ row, onSaved }) {
  const [value, setValue] = useState(row.copy_value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const dirty = value !== row.copy_value
  const multiline = value.length > 60 || value.includes('\n')

  async function save() {
    setSaving(true); setError(null); setSaved(false)
    try {
      await onlineJoin.updateCopy(row.copy_key, value)
      setSaved(true)
      onSaved()
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-b border-border last:border-0 px-4 py-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary font-mono">{row.copy_key}</div>
          {row.description && <p className="text-[11px] text-text-muted mt-0.5">{row.description}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dirty && <span className="text-[10px] text-orange-600 font-medium">unsaved</span>}
          {saved && <span className="text-[10px] text-green-600 font-medium">✓ saved</span>}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-wcs-red text-white disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={Math.min(8, Math.max(2, value.split('\n').length))}
          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red font-mono"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red font-mono"
        />
      )}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

export default function OnlineJoinCopy() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await onlineJoin.listCopy()
      setRows(r.copy || [])
    } catch (e) {
      setError(e.message || 'Failed to load copy')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">
        Global strings used across the public widget. Edits invalidate the config cache automatically — the next config fetch picks up the new value within seconds.
      </p>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}
      <div className="bg-surface border border-border rounded-xl">
        {loading && <p className="px-4 py-6 text-sm text-text-muted text-center">Loading…</p>}
        {!loading && rows.length === 0 && <p className="px-4 py-6 text-sm text-text-muted text-center">No copy keys yet — they're seeded by migration 103.</p>}
        {rows.map(r => <CopyRow key={r.copy_key} row={r} onSaved={load} />)}
      </div>
    </div>
  )
}
