import { useEffect, useState } from 'react'
import { Toggle } from './QuizSettingsPanels'

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60'

// Per-club switches, GHL webhook URL and GHL External Tracking snippet.
// Saved independently of the builder's Save (its own button).
export default function QuizClubsPanel({ form, api, canEdit }) {
  const [clubs, setClubs] = useState(null)
  const [snippets, setSnippets] = useState({}) // location_id -> pasted text (only sent when touched)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tests, setTests] = useState({}) // location_id -> { busy, result }
  const [copied, setCopied] = useState(null)

  async function load() {
    setError('')
    try {
      const res = await api.clubs(form.id)
      setClubs(res.clubs || [])
      setSnippets({})
      setDirty(false)
    } catch (err) { setError(err.message || 'Failed to load clubs') }
  }
  useEffect(() => { load() }, [form.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function update(locationId, patch) {
    setClubs(cs => cs.map(c => (c.location_id === locationId ? { ...c, ...patch } : c)))
    setDirty(true)
    setNotice('')
  }

  async function save() {
    setSaving(true); setError(''); setNotice('')
    try {
      const body = clubs.map(c => {
        const row = { location_id: c.location_id, active: c.active, ghl_webhook_url: c.ghl_webhook_url }
        if (snippets[c.location_id] !== undefined) row.ghl_tracking_snippet = snippets[c.location_id]
        return row
      })
      const res = await api.saveClubs(form.id, body)
      setClubs(res.clubs || [])
      setSnippets({})
      setDirty(false)
      setNotice('Clubs saved.')
    } catch (err) { setError(err.message || 'Failed to save clubs') }
    finally { setSaving(false) }
  }

  async function sendTest(locationId) {
    setTests(t => ({ ...t, [locationId]: { busy: true } }))
    try {
      const r = await api.testWebhook(form.id, locationId)
      setTests(t => ({ ...t, [locationId]: { result: r.ok ? `GHL accepted it (HTTP ${r.status}).` : `GHL returned HTTP ${r.status || 'error'}: ${r.response || ''}`, ok: r.ok } }))
    } catch (err) {
      setTests(t => ({ ...t, [locationId]: { result: err.message || 'Test failed', ok: false } }))
    }
  }

  function copy(url, id) {
    navigator.clipboard.writeText(url)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  if (!clubs) {
    return error
      ? <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>
      : <div className="loading-card" />
  }

  const published = form.status === 'published'
  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text-primary">Clubs</h3>
          <p className="text-xs text-text-muted mt-0.5">Turn the quiz on per club. Each club sends leads to its own GHL webhook and loads its own GHL tracking.</p>
        </div>
        {canEdit && (
          <button onClick={save} disabled={saving || !dirty}
            className="px-4 py-1.5 text-xs font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Clubs'}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>}
      {notice && <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">{notice}</div>}
      {!published && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">Publish the quiz to make club links live.</div>
      )}
      {clubs.map(c => {
        const t = tests[c.location_id]
        return (
          <div key={c.location_id} className="bg-surface rounded-xl border border-border p-5 space-y-4">
            <Toggle label={c.name} hint={c.active ? 'Live at this club' : 'Off at this club'} checked={c.active}
              onChange={v => update(c.location_id, { active: v })} disabled={!canEdit} />
            {c.active && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-text-muted mb-1">GHL inbound webhook URL</label>
                  <input value={c.ghl_webhook_url} onChange={e => update(c.location_id, { ghl_webhook_url: e.target.value })}
                    placeholder="https://services.leadconnectorhq.com/hooks/..." disabled={!canEdit} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted mb-1">GHL External Tracking override (optional)</label>
                  <textarea rows={2} disabled={!canEdit} className={`${inputClass} font-mono text-xs`}
                    value={snippets[c.location_id] ?? ''}
                    onChange={e => { setSnippets(s => ({ ...s, [c.location_id]: e.target.value })); setDirty(true); setNotice('') }}
                    placeholder={c.ghl_tracking_id ? `Override: ${c.ghl_tracking_id} (paste a new snippet to replace, or clear to use the club default)` : 'Leave blank to use the club default'} />
                  <p className="text-[11px] text-text-muted mt-1">
                    {c.ghl_tracking_id
                      ? `Using this quiz's override: ${c.ghl_tracking_id}.`
                      : c.default_tracking_id
                        ? `Using the club default: ${c.default_tracking_id}.`
                        : 'No club default set. Add it once in Admin > Club Integrations.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit && (
                    <button onClick={() => sendTest(c.location_id)} disabled={t?.busy || dirty || !c.ghl_webhook_url}
                      title={dirty ? 'Save clubs first' : undefined}
                      className="px-3 py-1.5 text-xs text-text-primary border border-border rounded-lg hover:bg-bg transition-colors disabled:opacity-50">
                      {t?.busy ? 'Sending...' : 'Send test'}
                    </button>
                  )}
                  {published && (
                    <button onClick={() => copy(c.url, c.location_id)}
                      className="px-3 py-1.5 text-xs text-wcs-red border border-border rounded-lg hover:bg-bg transition-colors">
                      {copied === c.location_id ? 'Copied!' : 'Copy link'}
                    </button>
                  )}
                  {published && <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-text-muted hover:underline truncate">{c.url}</a>}
                </div>
                {t?.result && (
                  <p className={`text-xs ${t.ok ? 'text-green-700' : 'text-wcs-red'}`}>{t.result}</p>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
