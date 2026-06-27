import React, { useState, useEffect } from 'react'
import { tourAdmin } from '../../lib/api'

function checkinUrl(token) {
  return token ? `${window.location.origin}/tour.html?token=${token}` : ''
}

export default function TourCheckinLocations() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const r = await tourAdmin.list()
      setRows(r.locations || [])
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  if (loading) return <p className="text-text-muted text-sm p-4">Loading…</p>
  if (error) return <p className="text-wcs-red text-sm p-4">{error}</p>

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Tour Check-In</h2>
        <p className="text-sm text-text-muted">Per-location check-in app link, outbound webhook, and Day One calendar link.</p>
      </div>
      {rows.map(row => (
        <LocationCard key={row.location_id} row={row} onChanged={load} />
      ))}
    </div>
  )
}

function LocationCard({ row, onChanged }) {
  const [webhook, setWebhook] = useState(row.webhook_url || '')
  const [dayOne, setDayOne] = useState(row.day_one_base_url || '')
  const [token, setToken] = useState(row.public_token)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState('')

  const url = checkinUrl(token)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  async function save() {
    setSaving(true); setMsg('')
    try {
      await tourAdmin.update(row.location_id, { webhook_url: webhook, day_one_base_url: dayOne, active: true })
      setMsg('Saved')
      setTimeout(() => setMsg(''), 1500)
    } catch (e) {
      setMsg(e.message || 'Failed')
    } finally { setSaving(false) }
  }
  async function regenerate() {
    if (!window.confirm('Regenerate this location\'s check-in link? The old URL will stop working.')) return
    try {
      const r = await tourAdmin.regenerate(row.location_id)
      setToken(r.public_token)
      onChanged()
    } catch (e) { setMsg(e.message || 'Failed') }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
      <h3 className="font-semibold text-text-primary">{row.name}</h3>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Check-in app URL</label>
        <div className="flex gap-2">
          <input readOnly value={url} className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary" />
          <button onClick={copy} className="px-3 py-2 rounded-lg bg-wcs-red text-white text-sm font-medium min-w-[84px]">
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={regenerate} className="px-3 py-2 rounded-lg border border-border text-text-muted text-sm">Regenerate</button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Day One base calendar link</label>
        <input value={dayOne} onChange={e => setDayOne(e.target.value)} placeholder="https://…/widget/booking/…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Outbound webhook URL (optional)</label>
        <input value={webhook} onChange={e => setWebhook(e.target.value)} placeholder="https://…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className="text-sm text-text-muted">{msg}</span>}
      </div>
    </div>
  )
}
