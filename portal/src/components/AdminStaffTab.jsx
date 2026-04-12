import { useState, useEffect } from 'react'
import { getStaff, createStaff, updateStaff, deleteStaff, getLocations } from '../lib/api'

const ROLES = ['team_member', 'fd_lead', 'pt_lead', 'manager', 'corporate', 'admin']

const emptyForm = {
  email: '',
  first_name: '',
  last_name: '',
  role: 'team_member',
  location_ids: [],
  location_permissions: {},
  temp_password: '',
}

function StaffModal({ member, locations, onClose, onSaved }) {
  const isNew = !member
  const [form, setForm] = useState(isNew ? { ...emptyForm } : {
    email: member.email || '',
    first_name: member.first_name || '',
    last_name: member.last_name || '',
    role: member.role || 'team_member',
    location_ids: (member.locations || []).map(l => l.id),
    location_permissions: Object.fromEntries(
      (member.locations || []).map(l => [l.id, {
        can_sign_in: l.can_sign_in !== false,
        can_view_reports: l.can_view_reports !== false,
      }])
    ),
    temp_password: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleLocation(locId) {
    setForm(prev => {
      const wasSelected = prev.location_ids.includes(locId)
      const newIds = wasSelected
        ? prev.location_ids.filter(id => id !== locId)
        : [...prev.location_ids, locId]
      const newPerms = { ...prev.location_permissions }
      if (!wasSelected) {
        newPerms[locId] = { can_sign_in: true, can_view_reports: true }
      } else {
        delete newPerms[locId]
      }
      return { ...prev, location_ids: newIds, location_permissions: newPerms }
    })
  }

  function togglePerm(locId, perm) {
    setForm(prev => ({
      ...prev,
      location_permissions: {
        ...prev.location_permissions,
        [locId]: {
          ...prev.location_permissions[locId],
          [perm]: !(prev.location_permissions[locId]?.[perm] ?? true),
        },
      },
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (isNew) {
        await createStaff(form)
      } else {
        const updateData = { ...form }
        if (!updateData.temp_password) delete updateData.temp_password
        await updateStaff(member.id, updateData)
      }
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-2xl border border-border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-text-primary">{isNew ? 'New Staff Member' : 'Edit Staff Member'}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>

        {error && <p className="text-wcs-red text-sm mb-4">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">First Name</label>
              <input
                type="text"
                required
                value={form.first_name}
                onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Last Name</label>
              <input
                type="text"
                required
                value={form.last_name}
                onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Role</label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red capitalize"
            >
              {ROLES.map(r => (
                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">{isNew ? 'Temporary Password' : 'Reset Password (optional)'}</label>
            <input
              type="text"
              required={isNew}
              value={form.temp_password}
              onChange={e => setForm(f => ({ ...f, temp_password: e.target.value }))}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
              placeholder={isNew ? 'Initial password' : 'Leave blank to keep current'}
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-2">Locations & Permissions</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {locations.map(loc => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => toggleLocation(loc.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    form.location_ids.includes(loc.id)
                      ? 'bg-wcs-red text-white border-wcs-red'
                      : 'bg-bg text-text-muted border-border hover:text-text-primary'
                  }`}
                >
                  {loc.name}
                </button>
              ))}
            </div>

            {form.location_ids.length > 0 && (
              <div className="bg-bg rounded-lg border border-border p-3 space-y-2">
                <p className="text-xs text-text-muted font-medium mb-1">Location Permissions</p>
                {form.location_ids.map(locId => {
                  const loc = locations.find(l => l.id === locId)
                  const perms = form.location_permissions[locId] || { can_sign_in: true, can_view_reports: true }
                  return (
                    <div key={locId} className="flex items-center justify-between text-xs">
                      <span className="text-text-primary font-medium min-w-[80px]">{loc?.name}</span>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={perms.can_sign_in}
                            onChange={() => togglePerm(locId, 'can_sign_in')}
                            className="rounded border-border text-wcs-red focus:ring-wcs-red"
                          />
                          <span className="text-text-muted">Sign In</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={perms.can_view_reports}
                            onChange={() => togglePerm(locId, 'can_view_reports')}
                            className="rounded border-border text-wcs-red focus:ring-wcs-red"
                          />
                          <span className="text-text-muted">Reports</span>
                        </label>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-muted border border-border rounded-lg hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving...' : isNew ? 'Create' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AdminStaffTab() {
  const [staff, setStaff] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalMember, setModalMember] = useState(undefined) // undefined=closed, null=new, object=edit

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [staffData, locData] = await Promise.all([getStaff(), getLocations()])
      setStaff(staffData.staff || [])
      setLocations(locData.locations || [])
    } catch (e) {
      setError(e.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Are you sure you want to delete this staff member?')) return
    setError(null)
    try {
      await deleteStaff(id)
      await loadData()
    } catch (e) {
      setError(e.message || 'Failed to delete staff member')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-text-muted text-sm">Loading staff...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => setModalMember(null)}
          className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          + Add Staff
        </button>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Email</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Role</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Locations</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">
                  No staff members found.
                </td>
              </tr>
            )}
            {staff.map(member => (
              <tr key={member.id} className="border-b border-border last:border-0 hover:bg-bg transition-colors">
                <td className="px-4 py-3 text-text-primary font-medium">
                  {[member.first_name, member.last_name].filter(Boolean).join(' ') || member.display_name || '—'}
                </td>
                <td className="px-4 py-3 text-text-muted">{member.email}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 bg-bg border border-border rounded text-xs text-text-primary capitalize">
                    {member.role?.replace(/_/g, ' ') || '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted text-xs">
                  {member.locations?.length
                    ? member.locations.map(l => l.name).join(', ')
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => setModalMember(member)}
                      className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(member.id)}
                      className="text-xs font-medium text-wcs-red hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalMember !== undefined && (
        <StaffModal
          member={modalMember}
          locations={locations}
          onClose={() => setModalMember(undefined)}
          onSaved={() => { setModalMember(undefined); loadData() }}
        />
      )}
    </div>
  )
}
