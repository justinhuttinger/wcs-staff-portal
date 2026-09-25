import { useEffect, useState } from 'react'
import { saveAdmin } from '../../../lib/api'
import { Card, Toggle, inputClass, btnPrimary } from './shared'

// Member-facing copy, grouped by the screen it appears on.
const COPY_GROUPS = [
  { title: 'Start screen', heading: 'intro_heading', body: 'intro_body' },
  { title: 'After taking an offer', heading: 'saved_heading', body: 'saved_body' },
  { title: 'After cancelling', heading: 'cancelled_heading', body: 'cancelled_body' },
  { title: 'When staff needs to finish up', heading: 'staff_heading', body: 'staff_body' },
]
const COPY_KEYS = COPY_GROUPS.flatMap(g => [g.heading, g.body])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function toForm(settings) {
  const s = settings || {}
  const f = {
    enabled: s.enabled ?? true,
    require_email_code: s.require_email_code ?? true,
    max_offers_shown: String(s.max_offers_shown ?? 2),
    owed_balance_mode: s.owed_balance_mode === 'block' ? 'block' : 'staff',
    staff_notify_emails: (s.staff_notify_emails || []).join('\n'),
  }
  for (const k of COPY_KEYS) f[k] = s[k] || ''
  return f
}

function parseEmails(text) {
  return [...new Set(text.split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean))]
}

export default function SettingsTab() {
  const [loaded, setLoaded] = useState(null)
  const [f, setF] = useState(null)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    saveAdmin.getSettings()
      .then(r => {
        if (!r.settings) setError('Settings row not found. Apply migration 211.')
        setLoaded(r.settings)
        setF(toForm(r.settings))
      })
      .catch(e => setError(e.message || 'Failed to load settings'))
  }, [])

  if (error && !f) return <Card><p className="text-sm text-wcs-red">{error}</p></Card>
  if (!f) return <Card><p className="text-sm text-text-muted">Loading settings…</p></Card>

  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(loaded))

  function set(key, value) {
    setF(prev => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }))
    setMsg('')
  }

  async function save() {
    const problems = {}
    const emails = parseEmails(f.staff_notify_emails)
    const bad = emails.filter(e => !EMAIL_RE.test(e))
    if (bad.length) problems.staff_notify_emails = `Not a valid email: ${bad.join(', ')}`
    for (const k of COPY_KEYS) if (!f[k].trim()) problems[k] = 'This text cannot be blank'
    if (Object.keys(problems).length) {
      setErrors(problems)
      setMsg('Check the highlighted fields')
      return
    }
    const body = {
      enabled: f.enabled,
      require_email_code: f.require_email_code,
      max_offers_shown: Number(f.max_offers_shown),
      owed_balance_mode: f.owed_balance_mode,
      staff_notify_emails: emails,
    }
    for (const k of COPY_KEYS) body[k] = f[k].trim()
    setSaving(true)
    setMsg('')
    try {
      const r = await saveAdmin.updateSettings(body)
      setLoaded(r.settings)
      setF(toForm(r.settings))
      setMsg('Saved')
      setTimeout(() => setMsg(''), 1500)
    } catch (e) {
      if (e.fields) setErrors(e.fields)
      setMsg(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <h3 className="font-semibold text-text-primary">Flow</h3>

        <div className="flex items-start gap-3">
          <Toggle checked={f.enabled} onChange={v => set('enabled', v)} label="Online cancel enabled" />
          <div>
            <p className="text-sm font-medium text-text-primary">Online cancel is {f.enabled ? 'on' : 'off'}</p>
            <p className="text-xs text-text-muted">When off, members are told to contact their club.</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Toggle checked={f.require_email_code} onChange={v => set('require_email_code', v)} label="Require email code" />
          <div>
            <p className="text-sm font-medium text-text-primary">Require an emailed code</p>
            <p className="text-xs text-text-muted">
              Sends a 6 digit code to the email on file before the member can continue. Strongly recommended.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Max offers shown</label>
            <select value={f.max_offers_shown} onChange={e => set('max_offers_shown', e.target.value)}
              className={inputClass(errors.max_offers_shown)}>
              {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n === 0 ? '0 (no offers, straight to cancel)' : n}</option>)}
            </select>
            {errors.max_offers_shown && <p className="text-xs text-wcs-red mt-1">{errors.max_offers_shown}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">If the member owes money</label>
            <select value={f.owed_balance_mode} onChange={e => set('owed_balance_mode', e.target.value)}
              className={inputClass(errors.owed_balance_mode)}>
              <option value="staff">Record it for staff to finish</option>
              <option value="block">Tell the member to call the club</option>
              <option value="charge" disabled>Charge a card (not set up yet)</option>
            </select>
            {errors.owed_balance_mode
              ? <p className="text-xs text-wcs-red mt-1">{errors.owed_balance_mode}</p>
              : <p className="text-xs text-text-muted mt-1">Card payments are not set up yet.</p>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Staff notify emails</label>
          <textarea rows={3} value={f.staff_notify_emails} onChange={e => set('staff_notify_emails', e.target.value)}
            placeholder="one per line" className={inputClass(errors.staff_notify_emails)} />
          {errors.staff_notify_emails
            ? <p className="text-xs text-wcs-red mt-1">{errors.staff_notify_emails}</p>
            : <p className="text-xs text-text-muted mt-1">Who hears about requests that need staff. One per line or comma separated.</p>}
        </div>
      </Card>

      <Card className="space-y-5">
        <div>
          <h3 className="font-semibold text-text-primary">Member-facing wording</h3>
          <p className="text-xs text-text-muted mt-1">Changes show on the member page right away. No deploy needed.</p>
        </div>
        {COPY_GROUPS.map(g => (
          <div key={g.title} className="space-y-2">
            <p className="text-xs uppercase font-semibold text-text-muted">{g.title}</p>
            <input value={f[g.heading]} onChange={e => set(g.heading, e.target.value)} placeholder="Heading"
              className={`${inputClass(errors[g.heading])} font-semibold`} />
            {errors[g.heading] && <p className="text-xs text-wcs-red">{errors[g.heading]}</p>}
            <textarea rows={2} value={f[g.body]} onChange={e => set(g.body, e.target.value)} placeholder="Body"
              className={inputClass(errors[g.body])} />
            {errors[g.body] && <p className="text-xs text-wcs-red">{errors[g.body]}</p>}
          </div>
        ))}
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving || !dirty} className={btnPrimary}>{saving ? 'Saving…' : 'Save settings'}</button>
          {msg && <span className={`text-sm ${msg === 'Saved' ? 'text-text-muted' : 'text-wcs-red'}`}>{msg}</span>}
          {!msg && dirty && <span className="text-sm text-text-muted">Unsaved changes</span>}
          {loaded?.updated_at && !dirty && !msg && (
            <span className="text-xs text-text-muted">Last saved {new Date(loaded.updated_at).toLocaleString()}</span>
          )}
        </div>
      </Card>
    </div>
  )
}
