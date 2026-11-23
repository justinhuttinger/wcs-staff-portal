import { useEffect, useState } from 'react'
import { getChallengeSettings, saveChallengeSettings } from '../../lib/api'

// Seasonal switch for the Challenge report (Reporting -> Challenge). Off hides
// the report from everyone; the season dates decide which GHL payments count,
// so last year's challenge sales stay out of this year's list.
export default function ChallengeReportAdmin() {
  const [settings, setSettings] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getChallengeSettings()
      .then(({ settings }) => {
        setSettings(settings)
        setDraft({
          season_start: settings?.season_start || '',
          season_end: settings?.season_end || '',
          name_match: settings?.name_match || 'Transformation Challenge',
        })
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function save(patch) {
    setSaving(true)
    setMessage(null)
    try {
      const { settings: next } = await saveChallengeSettings(patch)
      setSettings(next)
      setDraft({ season_start: next.season_start || '', season_end: next.season_end || '', name_match: next.name_match || '' })
      setMessage({ type: 'success', text: 'Saved' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-text-muted p-4">Loading...</p>
  if (error) return <p className="text-sm text-red-500 p-4">{error}</p>

  const enabled = !!settings?.enabled
  const dirty = draft && (
    draft.season_start !== (settings?.season_start || '')
    || draft.season_end !== (settings?.season_end || '')
    || draft.name_match !== (settings?.name_match || '')
  )

  return (
    <div className="space-y-5">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <h3 className="text-sm font-bold text-text-primary">Challenge Report</h3>
            <p className="text-xs text-text-muted mt-1">
              Lists everyone who bought a Transformation Challenge entry (Kick Start, Challenger or All In) through the GHL payment links, with their club, plan, phone and email. Turn it on for the challenge season and off when it ends. While it is off, it is hidden from Reporting for everyone.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={saving}
            onClick={() => save({ enabled: !enabled })}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-wcs-red' : 'bg-border'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <p className={`text-xs font-semibold mt-3 ${enabled ? 'text-green-600' : 'text-text-muted'}`}>
          {enabled ? 'On: showing in Reporting' : 'Off: hidden from Reporting'}
        </p>
      </div>

      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Season</h3>
          <p className="text-xs text-text-muted mt-1">
            Only payments made in this window count. Leave the end date blank while sign-ups are open. The product name match picks the challenge payment links out of everything else sold through GHL.
          </p>
        </div>
        <div className="flex items-end gap-4 flex-wrap">
          <label className="text-xs text-text-muted">
            <span className="block mb-1">Season start</span>
            <input
              type="date"
              value={draft.season_start}
              onChange={e => setDraft(d => ({ ...d, season_start: e.target.value }))}
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
          </label>
          <label className="text-xs text-text-muted">
            <span className="block mb-1">Season end (optional)</span>
            <input
              type="date"
              value={draft.season_end}
              onChange={e => setDraft(d => ({ ...d, season_end: e.target.value }))}
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
          </label>
          <label className="text-xs text-text-muted">
            <span className="block mb-1">Product name contains</span>
            <input
              type="text"
              value={draft.name_match}
              onChange={e => setDraft(d => ({ ...d, name_match: e.target.value }))}
              className="w-64 px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
          </label>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => save({ season_start: draft.season_start, season_end: draft.season_end || null, name_match: draft.name_match })}
            className="px-4 py-1.5 rounded-lg bg-wcs-red text-white text-sm font-medium hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {message && (
          <p className={`text-xs ${message.type === 'error' ? 'text-red-500' : 'text-green-600'}`}>{message.text}</p>
        )}
      </div>
    </div>
  )
}
