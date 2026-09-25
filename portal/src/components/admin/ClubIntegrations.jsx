import React, { useEffect, useState } from 'react'
import { clubIntegrationsAdmin } from '../../lib/api'

// One entry per editable column on club_integrations. Order here is the order
// on screen. Adding an integration means a migration, a line in the route's
// WEBHOOK_FIELDS, and a line here.
const FIELDS = [
  {
    key: 'kiosk_waiver_lead_webhook_url',
    label: 'Kiosk waiver — started',
    help: 'Fires as soon as a member enters their name and contact info, before they finish. This is the abandoned-kiosk follow-up.',
  },
  {
    key: 'kiosk_waiver_completed_webhook_url',
    label: 'Kiosk waiver — completed',
    help: 'Fires once the waiver is signed and the ABC profile exists.',
  },
  {
    key: 'pt_intake_webhook_url',
    label: 'PT intake',
    help: 'Personal training intake form submissions.',
  },
]

// Mirrors the server's check in routes/clubIntegrationsAdmin.js. Validating here
// too means a typo turns the field red as you leave it, rather than after a
// round trip — and a webhook URL that never fires is otherwise invisible until
// somebody notices the follow-up never went out.
function urlProblem(value) {
  if (!value) return null
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return 'Must be a full URL starting with https://'
  }
  if (parsed.protocol !== 'https:') return 'Must use https://'
  return null
}

// Light client check on a pasted GHL External Tracking snippet; the server
// does the full host/path validation.
const TRACKING_ID_IN_SNIPPET = /data-tracking-id\s*=\s*["'](tk_[A-Za-z0-9]{8,64})["']/i
function snippetProblem(value) {
  if (!value) return null
  if (!/external-tracking\.js/i.test(value) || !TRACKING_ID_IN_SNIPPET.test(value)) {
    return 'Paste the full <script> snippet from GHL Settings > External Tracking'
  }
  return null
}

export default function ClubIntegrations() {
  const [clubs, setClubs] = useState([])
  const [warning, setWarning] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const r = await clubIntegrationsAdmin.list()
      setClubs(r.clubs || [])
      setWarning(r.warning || '')
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
      <div className="bg-surface border border-border rounded-2xl p-4">
        <h2 className="text-xl font-bold text-text-primary">Club Integrations</h2>
        <p className="text-sm text-text-muted mt-1">
          Outbound webhook URLs the automation service posts to, per club. Paste the URL
          from a GoHighLevel workflow's Inbound Webhook trigger. Leaving one blank means
          that automation simply does not fire for that club — nothing breaks.
        </p>
        <p className="text-xs text-text-muted mt-2">
          Saved changes take effect within a minute. No deploy needed.
        </p>
      </div>

      {warning && (
        <div className="bg-surface border border-wcs-red rounded-2xl p-4">
          <p className="text-sm text-wcs-red font-medium">{warning}</p>
          <p className="text-xs text-text-muted mt-1">
            Until then these fields will not save, and the service keeps using the URLs
            hardcoded in clubs-config.json.
          </p>
        </div>
      )}

      {clubs.map(club => (
        <ClubCard key={club.abc_club_number} club={club} />
      ))}
    </div>
  )
}

function ClubCard({ club }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(FIELDS.map(f => [f.key, club[f.key] || ''])),
  )
  // undefined = untouched (the saved snippet stays); '' clears it.
  const [snippet, setSnippet] = useState(undefined)
  const [trackingId, setTrackingId] = useState(club.ghl_tracking_id || '')
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const dirty = snippet !== undefined || FIELDS.some(f => (values[f.key] || '') !== (club[f.key] || ''))
  const configured = FIELDS.filter(f => values[f.key]).length

  function set(key, v) {
    setValues(prev => ({ ...prev, [key]: v }))
    if (fieldErrors[key]) setFieldErrors(prev => ({ ...prev, [key]: undefined }))
  }

  async function save() {
    const problems = {}
    for (const f of FIELDS) {
      const problem = urlProblem((values[f.key] || '').trim())
      if (problem) problems[f.key] = problem
    }
    const sp = snippetProblem((snippet || '').trim())
    if (sp) problems.ghl_tracking_snippet = sp
    if (Object.keys(problems).length) {
      setFieldErrors(problems)
      setMsg('Check the highlighted fields')
      return
    }

    setSaving(true)
    setMsg('')
    setFieldErrors({})
    try {
      const body = snippet === undefined ? values : { ...values, ghl_tracking_snippet: snippet.trim() }
      await clubIntegrationsAdmin.update(club.abc_club_number, body)
      // Reflect the saved state so the dirty check settles.
      FIELDS.forEach(f => { club[f.key] = values[f.key] })
      if (snippet !== undefined) {
        const id = (snippet.match(TRACKING_ID_IN_SNIPPET) || [])[1] || ''
        club.ghl_tracking_id = id
        setTrackingId(id)
        setSnippet(undefined)
      }
      setMsg('Saved')
      setTimeout(() => setMsg(''), 1500)
    } catch (e) {
      setMsg(e.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold text-text-primary">{club.display_name}</h3>
        <span className="text-xs text-text-muted">
          club {club.abc_club_number} · /{club.location_slug} · {configured} of {FIELDS.length} set
        </span>
      </div>

      {FIELDS.map(f => (
        <div key={f.key}>
          <label className="block text-xs font-medium text-text-muted mb-1">{f.label}</label>
          <input
            value={values[f.key]}
            onChange={e => set(f.key, e.target.value)}
            placeholder="https://services.leadconnectorhq.com/hooks/…"
            className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm text-text-primary ${
              fieldErrors[f.key] ? 'border-wcs-red' : 'border-border'
            }`}
          />
          {fieldErrors[f.key] ? (
            <p className="text-xs text-wcs-red mt-1">{fieldErrors[f.key]}</p>
          ) : (
            <p className="text-xs text-text-muted mt-1">{f.help}</p>
          )}
        </div>
      ))}

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">GHL External Tracking</label>
        <textarea
          rows={2}
          value={snippet ?? ''}
          onChange={e => {
            setSnippet(e.target.value)
            if (fieldErrors.ghl_tracking_snippet) setFieldErrors(prev => ({ ...prev, ghl_tracking_snippet: undefined }))
          }}
          placeholder={trackingId ? `Saved: ${trackingId} (paste a new snippet to replace)` : '<script src="https://…/js/external-tracking.js" data-tracking-id="tk_…"></script>'}
          className={`w-full rounded-lg border bg-surface px-3 py-2 text-xs font-mono text-text-primary ${
            fieldErrors.ghl_tracking_snippet ? 'border-wcs-red' : 'border-border'
          }`}
        />
        {fieldErrors.ghl_tracking_snippet ? (
          <p className="text-xs text-wcs-red mt-1">{fieldErrors.ghl_tracking_snippet}</p>
        ) : (
          <p className="text-xs text-text-muted mt-1">
            From GHL: Settings, External Tracking, Copy Script. Loaded on every quiz and form for this club.{' '}
            {trackingId ? `Current: ${trackingId}.` : 'Not set.'}
            {trackingId && snippet === undefined && (
              <button type="button" onClick={() => setSnippet('')} className="ml-1 text-wcs-red hover:underline">Remove</button>
            )}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className="text-sm text-text-muted">{msg}</span>}
        {!msg && dirty && <span className="text-sm text-text-muted">Unsaved changes</span>}
      </div>
    </div>
  )
}
