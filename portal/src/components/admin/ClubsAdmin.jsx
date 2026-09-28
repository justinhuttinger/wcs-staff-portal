import React, { useEffect, useState } from 'react'
import { clubsAdmin } from '../../lib/api'

// Admin -> Clubs: the club list every part of the portal reads (public.clubs).
// Adding a club here also creates its location, Action Links and Club
// Integrations row, then restarts the services that load the list at boot.
// Mirrors the server's rules in auth/src/lib/clubInput.js.

const TIMEZONES = [
  'America/Los_Angeles', 'America/Boise', 'America/Denver', 'America/Phoenix',
  'America/Chicago', 'America/New_York', 'America/Anchorage', 'Pacific/Honolulu',
]

const CREDENTIAL_LABEL = { saved: 'Saved', env: 'Set in Render', missing: 'Missing' }

const BLANK = {
  name: '', clubNumber: '', abcUrl: '', ghlLocationId: '', ghlApiKey: '', paychexCompanyId: '',
  timezone: 'America/Los_Angeles', state: 'Oregon', tradingName: '', active: true,
}

function clientProblems(v, isNew) {
  const p = {}
  if (isNew) {
    if (!/^[A-Za-z]+$/.test(v.name.trim())) p.name = 'One word, letters only (for example Medford).'
    if (!/^0*[1-9][0-9]{2,7}$/.test(v.clubNumber.trim())) p.clubNumber = 'Digits only (for example 32073).'
  }
  if (v.ghlLocationId.trim() && !/^[A-Za-z0-9]{20}$/.test(v.ghlLocationId.trim())) p.ghlLocationId = '20 characters, from GHL Settings > Business Profile.'
  if (v.abcUrl.trim() && !/^https:\/\//i.test(v.abcUrl.trim())) p.abcUrl = 'Must start with https://'
  if (v.ghlApiKey.trim() && !/^pit-/.test(v.ghlApiKey.trim())) p.ghlApiKey = 'Private integration tokens start with pit-'
  return p
}

// Browsers keep the last club list they saw; drop it so the next load fetches.
function forgetCachedClubs() {
  try { localStorage.removeItem('wcs_clubs_v1') } catch { /* private mode */ }
}

export default function ClubsAdmin() {
  const [clubs, setClubs] = useState([])
  const [autoRestart, setAutoRestart] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(null) // club number, or 'new'

  async function load() {
    setLoading(true)
    setError('')
    try {
      const r = await clubsAdmin.list()
      setClubs(r.clubs || [])
      setAutoRestart(!!r.autoRestart)
    } catch (e) {
      setError(e.message || 'Failed to load clubs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function saved(result) {
    forgetCachedClubs()
    setEditing(null)
    setNotice(result?.restart?.message || 'Saved.')
    load()
  }

  if (loading) return <p className="text-text-muted text-sm p-4">Loading…</p>
  if (error) return <p className="text-wcs-red text-sm p-4">{error}</p>

  return (
    <div className="space-y-4 p-4">
      <div className="bg-surface border border-border rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-text-primary">Clubs</h2>
            <p className="text-sm text-text-muted mt-1">
              The list of clubs the whole portal uses: report filters, pickers, syncs, the launcher
              and the member apps. Adding a club also sets up its location, Day One and VIP links, and
              Club Integrations row.
            </p>
            <p className="text-xs text-text-muted mt-2">
              {autoRestart
                ? 'Saving restarts the portal services to apply it (about 2 minutes). Reload the portal afterwards.'
                : 'Auto-restart is not configured: after saving, restart wcs-auth-api and ghl-sync in Render.'}
            </p>
          </div>
          {editing !== 'new' && (
            <button
              onClick={() => { setNotice(''); setEditing('new') }}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:opacity-90"
            >
              Add club
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="bg-surface border border-border rounded-2xl p-4">
          <p className="text-sm text-text-primary">{notice}</p>
        </div>
      )}

      {editing === 'new' && (
        <ClubForm isNew onCancel={() => setEditing(null)} onSaved={saved} />
      )}

      {clubs.map(club => (
        editing === club.clubNumber
          ? <ClubForm key={club.clubNumber} club={club} onCancel={() => setEditing(null)} onSaved={saved} />
          : <ClubRow key={club.clubNumber} club={club} onEdit={() => { setNotice(''); setEditing(club.clubNumber) }} />
      ))}
    </div>
  )
}

function Badge({ tone, children }) {
  const cls = tone === 'bad' ? 'border-wcs-red text-wcs-red' : tone === 'muted' ? 'border-border text-text-muted' : 'border-border text-text-primary'
  return <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>{children}</span>
}

function ClubRow({ club, onEdit }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-4">
      <div
        className="w-16 h-12 rounded-lg bg-bg border border-border bg-cover bg-center shrink-0"
        style={club.background ? { backgroundImage: `url(${club.background})` } : undefined}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-text-primary">{club.name}</span>
          {club.tradingName && <span className="text-xs text-text-muted">({club.tradingName})</span>}
          <span className="text-xs text-text-muted">#{club.clubNumber}</span>
          {!club.active && <Badge tone="muted">Inactive</Badge>}
          {!club.loaded && <Badge>Applying…</Badge>}
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1.5">
          <Badge tone={club.credentials.ghlToken === 'missing' ? 'bad' : ''}>GHL token: {CREDENTIAL_LABEL[club.credentials.ghlToken]}</Badge>
          <Badge tone={club.credentials.paychexCompany === 'missing' ? 'bad' : ''}>Paychex: {CREDENTIAL_LABEL[club.credentials.paychexCompany]}</Badge>
          {!club.ghlLocationId && <Badge tone="bad">No GHL location</Badge>}
          {!club.abcUrl && <Badge tone="bad">No ABC login URL</Badge>}
        </div>
      </div>
      <button onClick={onEdit} className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-primary hover:bg-bg">
        Edit
      </button>
    </div>
  )
}

function Field({ label, help, error, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-text-primary">{label}</span>
      <div className="mt-1">{children}</div>
      {error ? <span className="text-xs text-wcs-red">{error}</span> : help ? <span className="text-xs text-text-muted">{help}</span> : null}
    </label>
  )
}

const INPUT = 'w-full px-2.5 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red'

function ClubForm({ club, isNew = false, onCancel, onSaved }) {
  const [v, setV] = useState(() => (isNew ? { ...BLANK } : {
    ...BLANK,
    name: club.name, clubNumber: club.clubNumber, abcUrl: club.abcUrl || '',
    ghlLocationId: club.ghlLocationId || '', timezone: club.timezone || BLANK.timezone,
    state: club.state || BLANK.state, tradingName: club.tradingName || '', active: club.active,
  }))
  const [photo, setPhoto] = useState(null)
  const [problems, setProblems] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const set = (k, val) => {
    setV(prev => ({ ...prev, [k]: val }))
    if (problems[k]) setProblems(prev => ({ ...prev, [k]: undefined }))
  }

  async function save() {
    const p = clientProblems(v, isNew)
    if (Object.keys(p).length) { setProblems(p); setMsg('Check the highlighted fields'); return }
    setSaving(true)
    setMsg('')
    try {
      const body = { ...v }
      if (!body.ghlApiKey.trim()) delete body.ghlApiKey
      if (!body.paychexCompanyId.trim()) delete body.paychexCompanyId
      if (!isNew) { delete body.name; delete body.clubNumber }
      // With a photo to upload, that upload applies the change (one restart, not two).
      if (photo) body.deferRestart = true
      const result = isNew ? await clubsAdmin.create(body) : await clubsAdmin.update(club.clubNumber, body)
      const number = result?.club?.clubNumber || club?.clubNumber
      if (photo && number) {
        try {
          onSaved(await clubsAdmin.uploadPhoto(number, photo))
        } catch (e) {
          // The club is saved; re-save without deferring so the restart still happens.
          const applied = await clubsAdmin.update(number, {})
          onSaved({ restart: { message: `Club saved, but the photo failed (${e.message}). ${applied?.restart?.message || ''}` } })
        }
      } else {
        onSaved(result)
      }
    } catch (e) {
      setMsg(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const slug = v.name.trim().toLowerCase()
  const savedHint = (state) => (state === 'saved' ? 'Saved. Leave blank to keep it.' : state === 'env' ? 'Set in Render env; a value here is used only if that is removed.' : '')

  return (
    <div className="bg-surface border border-wcs-red rounded-2xl p-4 space-y-4">
      <h3 className="text-lg font-bold text-text-primary">{isNew ? 'Add a club' : `Edit ${club.name}`}</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Club name" error={problems.name} help={isNew ? (slug ? `Slug: ${slug}` : 'One word, as staff say it (Medford).') : 'Fixed once created.'}>
          <input className={INPUT} value={v.name} disabled={!isNew} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="ABC club number" error={problems.clubNumber} help={isNew ? 'From ABC. Leading zeros are dropped.' : 'Fixed once created.'}>
          <input className={INPUT} value={v.clubNumber} disabled={!isNew} onChange={e => set('clubNumber', e.target.value)} />
        </Field>
        <Field label="ABC login URL" error={problems.abcUrl} help="The club's workstation login link the launcher opens.">
          <input className={INPUT} value={v.abcUrl} onChange={e => set('abcUrl', e.target.value)} placeholder="https://prod02.abcfitness.com/SystemLoginCommand.pml?..." />
        </Field>
        <Field label="GHL location ID" error={problems.ghlLocationId} help="The club's GHL sub-account ID.">
          <input className={INPUT} value={v.ghlLocationId} onChange={e => set('ghlLocationId', e.target.value)} />
        </Field>
        <Field label="GHL private integration token" error={problems.ghlApiKey} help={isNew ? 'Stored encrypted. Starts with pit-.' : savedHint(club.credentials.ghlToken) || 'Stored encrypted. Starts with pit-.'}>
          <input className={INPUT} type="password" autoComplete="off" value={v.ghlApiKey} onChange={e => set('ghlApiKey', e.target.value)} />
        </Field>
        <Field label="Paychex company ID" help={isNew ? 'Stored encrypted.' : savedHint(club.credentials.paychexCompany) || 'Stored encrypted.'}>
          <input className={INPUT} type="password" autoComplete="off" value={v.paychexCompanyId} onChange={e => set('paychexCompanyId', e.target.value)} />
        </Field>
        <Field label="Timezone">
          <select className={INPUT} value={v.timezone} onChange={e => set('timezone', e.target.value)}>
            {[...new Set([v.timezone, ...TIMEZONES])].map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Field>
        <Field label="State">
          <input className={INPUT} value={v.state} onChange={e => set('state', e.target.value)} />
        </Field>
        <Field label="Trading name (optional)" help="Only if reports should show a different name (Milwaukie = East Side Athletic Club).">
          <input className={INPUT} value={v.tradingName} onChange={e => set('tradingName', e.target.value)} />
        </Field>
        <Field label="Club photo" help="Portal background for this club. JPG, PNG or WebP, under 5 MB.">
          <input type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" onChange={e => setPhoto(e.target.files?.[0] || null)} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input type="checkbox" checked={v.active} onChange={e => set('active', e.target.checked)} />
        Open (shows in pickers, reports and syncs). Unticking hides it but keeps its history.
      </label>

      {isNew && (
        <p className="text-xs text-text-muted">
          Still done outside the portal: create the club's GHL sub-account (calendars named Day One and
          Gym Tour), set it up in ABC and Paychex, add its WordPress page, and install the front desk PCs.
        </p>
      )}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-sm font-semibold disabled:opacity-50">
          {saving ? 'Saving…' : isNew ? 'Add club' : 'Save'}
        </button>
        <button onClick={onCancel} disabled={saving} className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-primary">
          Cancel
        </button>
        {msg && <span className="text-sm text-wcs-red">{msg}</span>}
      </div>
    </div>
  )
}
