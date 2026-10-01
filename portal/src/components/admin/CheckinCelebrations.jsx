import { useState, useEffect } from 'react'
import { checkinCelebrations } from '../../lib/api'

// Admin -> Check-in Celebrations. Which lifetime visit counts earn a member a
// show-once "CELEBRATE 10TH VISIT!" ABC alert (posted one visit early by
// ghl-sync's nightly job, so it pops on the milestone check-in and WCS ABC
// plays the party cue). Saved to app_config; the server re-validates.

// Mirrors celebrationSettings.js lifetimeText for the live preview; the server
// is the authority on what's valid.
const MAX_TEXT = 22
function ordinal(n) {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}TH`
  return `${n}${({ 1: 'ST', 2: 'ND', 3: 'RD' })[n % 10] || 'TH'}`
}
function previewText(n) {
  const full = `CELEBRATE ${ordinal(n)} VISIT!`
  if (full.length <= MAX_TEXT) return full
  const bare = full.slice(0, -1)
  return bare.length <= MAX_TEXT ? bare : null
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })
}

export default function CheckinCelebrations() {
  const [settings, setSettings] = useState(null)
  const [saved, setSaved] = useState(null) // JSON of the last saved settings, for dirty check
  const [addValue, setAddValue] = useState('')
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([checkinCelebrations.getSettings(), checkinCelebrations.getRecent().catch(() => ({ recent: [] }))])
      .then(([{ settings: s }, { recent: r }]) => {
        setSettings(s)
        setSaved(JSON.stringify(s))
        setRecent(r || [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-sm text-text-muted p-4">Loading...</p>
  if (error) return <p className="text-sm text-red-500 p-4">{error}</p>

  const lifetime = settings.lifetime
  const dirty = JSON.stringify(settings) !== saved
  const setLifetime = patch => { setSettings(s => ({ ...s, lifetime: { ...s.lifetime, ...patch } })); setMessage(null) }

  function addMilestone() {
    const n = Number(addValue)
    if (!Number.isInteger(n) || n < 1 || n > 100000) { setMessage({ type: 'error', text: 'Enter a whole number from 1 to 100000' }); return }
    if (!previewText(n)) { setMessage({ type: 'error', text: `${n} is too long for an ABC alert` }); return }
    if (!lifetime.milestones.includes(n)) setLifetime({ milestones: [...lifetime.milestones, n].sort((a, b) => a - b) })
    setAddValue('')
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const { settings: s } = await checkinCelebrations.saveSettings(settings)
      setSettings(s)
      setSaved(JSON.stringify(s))
      setMessage({ type: 'success', text: 'Saved. Takes effect at the next nightly run (5:15am).' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  const top = lifetime.milestones.length ? Math.max(...lifetime.milestones) : 0
  const every = Number(lifetime.repeatEvery) || 0

  return (
    <div className="space-y-4">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Lifetime visit milestones</h3>
            <p className="text-xs text-text-muted mt-1">
              A member one visit short of a milestone gets a show-once ABC alert overnight, so it pops on the check-in card of
              their milestone visit and WCS ABC plays the party sound. Counts start from the check-in history (July 2024), so only
              members who joined since then are celebrated.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-text-primary whitespace-nowrap cursor-pointer">
            <input type="checkbox" checked={lifetime.enabled} onChange={e => setLifetime({ enabled: e.target.checked })} className="accent-wcs-red" />
            On
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {lifetime.milestones.map(n => (
            <span key={n} className="inline-flex items-center gap-2 bg-bg border border-border rounded-lg pl-3 pr-1.5 py-1.5">
              <span className="text-sm font-bold text-text-primary">{n}</span>
              <span className="text-[10px] font-mono text-text-muted">{previewText(n)}</span>
              <button
                type="button"
                onClick={() => setLifetime({ milestones: lifetime.milestones.filter(m => m !== n) })}
                className="text-text-muted hover:text-red-500 text-sm leading-none px-1"
                aria-label={`Remove ${n}`}
              >
                ×
              </button>
            </span>
          ))}
          {!lifetime.milestones.length && <span className="text-xs text-text-muted">No milestones yet.</span>}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <input
              type="number" min="1" placeholder="e.g. 75" value={addValue}
              onChange={e => setAddValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addMilestone() }}
              className="w-24 bg-bg border border-border rounded-lg px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-wcs-red"
            />
            <button type="button" onClick={addMilestone} className="text-xs border border-border rounded-lg px-3 py-1 font-medium text-text-primary hover:border-wcs-red">
              Add milestone
            </button>
          </div>
          <div className="flex items-center gap-2 text-sm text-text-primary">
            <span>Then every</span>
            <input
              type="number" min="0" value={lifetime.repeatEvery}
              onChange={e => setLifetime({ repeatEvery: e.target.value === '' ? 0 : Number(e.target.value) })}
              className="w-20 bg-bg border border-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-wcs-red"
            />
            <span>visits after the last one</span>
            <span className="text-xs text-text-muted">
              {every > 0 && top ? `(${top + every}, ${top + 2 * every}, ${top + 3 * every}, ...)` : '(0 = off)'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button" onClick={save} disabled={saving || !dirty}
            className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-medium hover:bg-wcs-red/90 disabled:opacity-40"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {message && (
            <span className={`text-xs font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>{message.text}</span>
          )}
        </div>
      </div>

      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-3">
        <h3 className="text-sm font-bold text-text-primary">Recent celebrations</h3>
        {recent.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="text-left font-semibold py-2 pr-4">Posted</th>
                  <th className="text-left font-semibold py-2 px-2">Club</th>
                  <th className="text-left font-semibold py-2 px-2">Member</th>
                  <th className="text-left font-semibold py-2 px-2">Celebration</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-2 pr-4 text-text-muted whitespace-nowrap">{formatDate(r.posted_at)}</td>
                    <td className="py-2 px-2 text-text-primary whitespace-nowrap">{r.club}</td>
                    <td className="py-2 px-2 text-text-primary">{r.member}</td>
                    <td className="py-2 px-2 text-text-primary">{r.celebration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-text-muted">No celebration alerts posted yet.</p>
        )}
      </div>
    </div>
  )
}
