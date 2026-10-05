import { useState, useEffect } from 'react'
import { onlineJoin } from '../../lib/api'

const EMPTY_LOCATION = {
  wcs_location_id: '',
  display_name: '',
  address_line1: '', address_line2: '', city: '', state: 'OR', zip: '',
  phone: '', hours_summary: '',
  day_one_booking_url: '',
  hero_headline: '', hero_subhead: '',
  ghl_location_id: '', abc_club_number: '',
  active: true,
}

function Field({ label, value, onChange, type = 'text', placeholder, hint, required }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-text-muted mb-1">
        {label}{required && <span className="text-wcs-red ml-0.5">*</span>}
      </span>
      <input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
      />
      {hint && <span className="block text-[10px] text-text-muted mt-0.5">{hint}</span>}
    </label>
  )
}

// Phone photos run 5-10 MB; shrink to a 1600px-wide JPEG before upload. The
// card shows it at most ~400px wide, so this stays sharp on retina screens.
const PHOTO_MAX_W = 1600
function downscalePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, PHOTO_MAX_W / img.naturalWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff' // a transparent PNG would turn black as JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')) }
    img.src = url
  })
}

function PhotoSection({ locationId, photoUrl, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setError(null)
    try {
      const dataUrl = await downscalePhoto(file)
      const r = await onlineJoin.uploadLocationPhoto(locationId, dataUrl)
      onChange(r.location.photo_url)
    } catch (err) {
      setError(err.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Remove this photo? The location card will show text only.')) return
    setBusy(true); setError(null)
    try {
      await onlineJoin.removeLocationPhoto(locationId)
      onChange(null)
    } catch (err) {
      setError(err.message || 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Location photo</p>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm mb-2">{error}</div>}
      {!locationId ? (
        <p className="text-xs text-text-muted">Create the location first, then add its photo.</p>
      ) : (
        <div className="flex items-start gap-4">
          <div className="w-48 aspect-video rounded-lg border border-border bg-bg overflow-hidden flex items-center justify-center shrink-0">
            {photoUrl
              ? <img src={photoUrl} alt="" className="w-full h-full object-cover" />
              : <span className="text-[10px] text-text-muted">No photo</span>}
          </div>
          <div className="space-y-2">
            <label className={`inline-block px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-primary cursor-pointer hover:border-wcs-red ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
              {busy ? 'Working…' : (photoUrl ? 'Replace photo' : 'Upload photo')}
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} className="hidden" />
            </label>
            {photoUrl && !busy && (
              <button type="button" onClick={remove} className="block text-xs text-text-muted hover:text-wcs-red">Remove photo</button>
            )}
            <p className="text-[10px] text-text-muted max-w-xs">Shown on this club's card in step 1 of the online join, cropped to 16:9. Saves right away. Landscape photos work best.</p>
          </div>
        </div>
      )}
    </section>
  )
}

function LocationEditor({ location, onClose, onSaved, onPhotoChanged }) {
  const isNew = !location.wcs_location_id || location._isNew
  const [draft, setDraft] = useState({ ...EMPTY_LOCATION, ...location })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function update(key, value) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      if (isNew) {
        await onlineJoin.createLocation(draft)
      } else {
        const { wcs_location_id, ...patch } = draft
        await onlineJoin.updateLocation(wcs_location_id, patch)
      }
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{isNew ? 'Add Location' : draft.display_name || draft.wcs_location_id}</h3>
            <p className="text-xs text-text-muted">{isNew ? 'Create a new online-join location' : `Editing ${draft.wcs_location_id}`}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Identity</p>
            <div className="grid grid-cols-2 gap-3">
              {isNew
                ? <Field label="Location ID" value={draft.wcs_location_id} onChange={v => update('wcs_location_id', v.toLowerCase())} placeholder="e.g. medford" required hint="Permanent slug. Lowercase, no spaces." />
                : <Field label="Location ID" value={draft.wcs_location_id} onChange={() => {}} hint="Permanent — cannot be changed after create." />
              }
              <Field label="Display Name" value={draft.display_name} onChange={v => update('display_name', v)} placeholder="WCS Medford" required />
            </div>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Address</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Address line 1" value={draft.address_line1} onChange={v => update('address_line1', v)} />
              <Field label="Address line 2" value={draft.address_line2} onChange={v => update('address_line2', v)} />
              <Field label="City" value={draft.city} onChange={v => update('city', v)} />
              <Field label="State" value={draft.state} onChange={v => update('state', v.toUpperCase().slice(0, 2))} placeholder="OR" />
              <Field label="ZIP" value={draft.zip} onChange={v => update('zip', v)} placeholder="97504" />
              <Field label="Phone" value={draft.phone} onChange={v => update('phone', v)} placeholder="541-555-0123" />
            </div>
          </section>

          <PhotoSection
            locationId={isNew ? null : draft.wcs_location_id}
            photoUrl={draft.photo_url}
            onChange={url => { update('photo_url', url); onPhotoChanged() }}
          />

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Public-facing copy</p>
            <div className="grid grid-cols-1 gap-3">
              <Field label="Hero headline" value={draft.hero_headline} onChange={v => update('hero_headline', v)} placeholder="Join WCS Medford" />
              <Field label="Hero subhead" value={draft.hero_subhead} onChange={v => update('hero_subhead', v)} placeholder="Strong starts here." />
              <Field label="Hours summary" value={draft.hours_summary} onChange={v => update('hours_summary', v)} placeholder="Open 24/7" />
              <Field label="Day-One booking URL" value={draft.day_one_booking_url} onChange={v => update('day_one_booking_url', v)} placeholder="https://app.westcoaststrength.com/widget/booking/medford-day-one" hint="Shown to user after a successful signup." />
            </div>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Integrations</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="GHL Location ID" value={draft.ghl_location_id} onChange={v => update('ghl_location_id', v)} required hint="Match GHL config." />
              <Field label="ABC Club Number" value={draft.abc_club_number} onChange={v => update('abc_club_number', v)} required hint="e.g. 32073" />
            </div>
          </section>

          <section className="flex items-center gap-2">
            <input
              type="checkbox"
              id="active-toggle"
              checked={!!draft.active}
              onChange={e => update('active', e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="active-toggle" className="text-sm text-text-primary">Active — show in the public widget</label>
          </section>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 sticky bottom-0 bg-surface">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-60">
            {saving ? 'Saving…' : (isNew ? 'Create' : 'Save changes')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function OnlineJoinLocations() {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // location object or { _isNew: true }

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await onlineJoin.listLocations()
      setLocations(r.locations || [])
    } catch (e) {
      setError(e.message || 'Failed to load locations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function deactivate(loc) {
    if (!confirm(`Deactivate ${loc.display_name}? It will stay in the database but be hidden from the public widget.`)) return
    try {
      await onlineJoin.deactivateLocation(loc.wcs_location_id)
      load()
    } catch (e) {
      alert(e.message || 'Deactivate failed')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{loading ? 'Loading…' : `${locations.length} location${locations.length === 1 ? '' : 's'}`}</p>
        <button onClick={() => setEditing({ _isNew: true })} className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold">+ Add Location</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Location</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">City</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Phone</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">ABC Club #</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Day-One URL</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-text-muted">No locations yet.</td></tr>
            )}
            {locations.map(l => (
              <tr key={l.wcs_location_id} className="border-b border-border last:border-0 hover:bg-bg/30">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-3">
                    <div className="w-14 aspect-video rounded border border-border bg-bg overflow-hidden shrink-0">
                      {l.photo_url && <img src={l.photo_url} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-text-primary">{l.display_name || l.wcs_location_id}</div>
                      <div className="text-[10px] text-text-muted font-mono">{l.wcs_location_id}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-text-muted">{l.city || '—'}</td>
                <td className="px-3 py-2 text-xs text-text-muted">{l.phone || '—'}</td>
                <td className="px-3 py-2 text-xs font-mono text-text-muted">{l.abc_club_number}</td>
                <td className="px-3 py-2 text-xs text-text-muted truncate max-w-[200px]" title={l.day_one_booking_url}>
                  {l.day_one_booking_url ? <a href={l.day_one_booking_url} target="_blank" rel="noreferrer" className="text-wcs-red hover:underline">link</a> : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`inline-block w-2 h-2 rounded-full ${l.active ? 'bg-green-500' : 'bg-gray-300'}`} />
                </td>
                <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                  <button onClick={() => setEditing(l)} className="text-xs text-wcs-red hover:underline">Edit</button>
                  {l.active && <button onClick={() => deactivate(l)} className="text-xs text-text-muted hover:text-wcs-red">Deactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <LocationEditor
          location={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          onPhotoChanged={load}
        />
      )}
    </div>
  )
}
