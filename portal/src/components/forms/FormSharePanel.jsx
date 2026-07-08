import { useEffect, useMemo, useState } from 'react'
import { forms as formsApi } from '../../lib/api'

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60'
const labelClass = 'block text-xs font-semibold text-text-muted mb-1'

const VISIBILITY_OPTIONS = [
  { value: 'private', title: 'Private', desc: 'Only you and directors' },
  { value: 'location', title: 'My location', desc: null },
  { value: 'shared', title: 'Specific people', desc: 'Only people you add' },
]

export default function FormSharePanel({ form, shares, onChanged }) {
  const canEdit = !!form?.access?.edit
  const visibility = form?.visibility || 'private'
  const locationName = form?.location_name || 'your location'

  const [directory, setDirectory] = useState([])
  const [dirError, setDirError] = useState('')
  const [search, setSearch] = useState('')
  const [pickStaffId, setPickStaffId] = useState('')
  const [pickPermission, setPickPermission] = useState('viewer')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The staff picker is only needed for "Specific people".
  useEffect(() => {
    if (visibility !== 'shared' || !canEdit) return
    let cancelled = false
    formsApi.staffDirectory()
      .then(res => { if (!cancelled) setDirectory(res.staff || []) })
      .catch(err => { if (!cancelled) setDirError(err.message || 'Failed to load staff') })
    return () => { cancelled = true }
  }, [visibility, canEdit])

  const sharedIds = useMemo(() => new Set((shares || []).map(s => s.staff_id)), [shares])
  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase()
    return directory
      .filter(s => !sharedIds.has(s.id))
      .filter(s => !q || (s.display_name || '').toLowerCase().includes(q) || (s.role || '').toLowerCase().includes(q))
  }, [directory, sharedIds, search])

  // Keep the selected pick valid as the filtered list changes.
  useEffect(() => {
    if (pickStaffId && !filteredStaff.some(s => s.id === pickStaffId)) setPickStaffId('')
  }, [filteredStaff, pickStaffId])

  function reportError(err) {
    const msg = err?.message || 'Something went wrong'
    if (msg.includes('changed since you opened it')) {
      setError('This form changed since you opened it. Reload the form to get the latest version before changing sharing.')
    } else {
      setError(msg)
    }
  }

  async function saveForm(patch) {
    if (!canEdit || busy) return
    setBusy(true)
    setError('')
    try {
      await formsApi.update(form.id, { known_updated_at: form.updated_at, ...patch })
      onChanged?.()
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }

  async function runShare(fn) {
    if (!canEdit || busy) return
    setBusy(true)
    setError('')
    try {
      await fn()
      onChanged?.()
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }

  function changeVisibility(next) {
    if (next === visibility) return
    saveForm({ visibility: next })
  }

  function toggleLocationEdit() {
    saveForm({ location_can_edit: !form.location_can_edit })
  }

  function addPerson() {
    if (!pickStaffId) return
    runShare(() => formsApi.addShare(form.id, { staff_id: pickStaffId, permission: pickPermission }))
      .then(() => { setPickStaffId(''); setSearch('') })
  }

  const disabled = !canEdit || busy

  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-text-primary">Sharing and visibility</h3>
        <p className="text-xs text-text-muted mt-0.5">Control who can find and open this form inside the portal.</p>
      </div>

      {!canEdit && (
        <p className="text-xs text-text-muted">View only. You do not have edit access to this form.</p>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {/* Visibility radio group */}
      <div className="space-y-2">
        {VISIBILITY_OPTIONS.map(opt => {
          const active = visibility === opt.value
          const desc = opt.value === 'location'
            ? `Everyone at ${locationName} can view`
            : opt.desc
          return (
            <label
              key={opt.value}
              className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                active ? 'border-wcs-red bg-wcs-red/5' : 'border-border bg-bg hover:bg-surface'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="form-visibility"
                className="mt-0.5 accent-wcs-red"
                checked={active}
                disabled={disabled}
                onChange={() => changeVisibility(opt.value)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">{opt.title}</span>
                <span className="block text-xs text-text-muted">{desc}</span>
              </span>
            </label>
          )
        })}
      </div>

      {/* Location edit toggle */}
      {visibility === 'location' && (
        <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-bg ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            className="accent-wcs-red"
            checked={!!form.location_can_edit}
            disabled={disabled}
            onChange={toggleLocationEdit}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text-primary">Allow location teammates to edit</span>
            <span className="block text-xs text-text-muted">When off, teammates at {locationName} can view but not change the form.</span>
          </span>
        </label>
      )}

      {/* Specific-people picker */}
      {visibility === 'shared' && (
        <div className="space-y-4">
          {dirError && (
            <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{dirError}</div>
          )}
          {canEdit && (
            <div className="bg-bg rounded-xl border border-border p-4 space-y-3">
              <div>
                <label className={labelClass}>Add a teammate</label>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name or role"
                  disabled={disabled}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={pickStaffId}
                  onChange={e => setPickStaffId(e.target.value)}
                  disabled={disabled}
                  className={inputClass + ' sm:flex-1'}
                >
                  <option value="">
                    {filteredStaff.length ? 'Select a person' : 'No matching people'}
                  </option>
                  {filteredStaff.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.display_name}{s.role ? ` (${s.role})` : ''}
                    </option>
                  ))}
                </select>
                <select
                  value={pickPermission}
                  onChange={e => setPickPermission(e.target.value)}
                  disabled={disabled}
                  className={inputClass + ' sm:w-32'}
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button
                  type="button"
                  onClick={addPerson}
                  disabled={disabled || !pickStaffId}
                  className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {/* Current shares */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-text-muted">People with access</h4>
            {(shares || []).length === 0 ? (
              <p className="text-xs text-text-muted py-2">No one has been added yet.</p>
            ) : (
              <div className="space-y-1">
                {(shares || []).map(s => (
                  <div key={s.staff_id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg">
                    <span className="flex-1 min-w-0 text-sm text-text-primary truncate">
                      {s.display_name || 'Unknown teammate'}
                    </span>
                    <select
                      value={s.permission}
                      onChange={e => runShare(() => formsApi.addShare(form.id, { staff_id: s.staff_id, permission: e.target.value }))}
                      disabled={disabled}
                      className="px-2 py-1 bg-surface border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => runShare(() => formsApi.removeShare(form.id, s.staff_id))}
                      disabled={disabled}
                      className="px-2.5 py-1 text-xs text-wcs-red border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
