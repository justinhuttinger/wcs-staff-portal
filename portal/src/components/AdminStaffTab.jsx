import { useState, useEffect } from 'react'
import { getStaff, createStaff, updateStaff, deleteStaff, getLocations } from '../lib/api'

const ROLES = ['front_desk', 'personal_trainer', 'lead', 'manager', 'director', 'admin']

const defaultForm = {
  email: '',
  first_name: '',
  last_name: '',
  role: 'front_desk',
  location_ids: [],
  temp_password: '',
}

const defaultEditForm = {
  first_name: '',
  last_name: '',
  role: 'front_desk',
  location_ids: [],
}

export default function AdminStaffTab() {
  const [staff, setStaff] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(defaultForm)
  const [editForm, setEditForm] = useState(defaultEditForm)

  useEffect(() => {
    loadData()
  }, [])

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

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    try {
      await createStaff(form)
      setForm(defaultForm)
      setShowAdd(false)
      await loadData()
    } catch (e) {
      setError(e.message || 'Failed to create staff member')
    }
  }

  async function handleUpdate(id) {
    setError(null)
    try {
      await updateStaff(id, editForm)
      setEditingId(null)
      setEditForm(defaultEditForm)
      await loadData()
    } catch (e) {
      setError(e.message || 'Failed to update staff member')
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

  function startEdit(member) {
    setEditingId(member.id)
    setEditForm({
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      role: member.role || 'front_desk',
      location_ids: (member.locations || []).map(l => l.id),
    })
  }

  function toggleLocation(locationId, formState, setFormState) {
    setFormState(prev => {
      const ids = prev.location_ids.includes(locationId)
        ? prev.location_ids.filter(id => id !== locationId)
        : [...prev.location_ids, locationId]
      return { ...prev, location_ids: ids }
    })
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

      {/* Add Staff Button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowAdd(v => !v)}
          className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          {showAdd ? 'Cancel' : '+ Add Staff'}
        </button>
      </div>

      {/* Add Staff Form */}
      {showAdd && (
        <form
          onSubmit={handleCreate}
          className="bg-surface border border-border rounded-xl p-6 space-y-4"
        >
          <h3 className="text-sm font-semibold text-text-primary mb-2">New Staff Member</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="staff@example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">First Name</label>
              <input
                type="text"
                required
                value={form.first_name}
                onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="Jane"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Last Name</label>
              <input
                type="text"
                required
                value={form.last_name}
                onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="Smith"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Role</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{r.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Temporary Password</label>
              <input
                type="text"
                required
                value={form.temp_password}
                onChange={e => setForm(f => ({ ...f, temp_password: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="Temp password"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-2">Locations</label>
            <div className="flex flex-wrap gap-3">
              {locations.map(loc => (
                <label key={loc.id} className="flex items-center gap-1.5 text-sm text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.location_ids.includes(loc.id)}
                    onChange={() => toggleLocation(loc.id, form, setForm)}
                    className="accent-wcs-red"
                  />
                  {loc.name}
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { setShowAdd(false); setForm(defaultForm) }}
              className="px-4 py-2 text-sm text-text-muted border border-border rounded-lg hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              Create
            </button>
          </div>
        </form>
      )}

      {/* Staff Table */}
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
                {editingId === member.id ? (
                  <>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editForm.first_name}
                          onChange={e => setEditForm(f => ({ ...f, first_name: e.target.value }))}
                          className="w-full px-2 py-1 bg-bg border border-border rounded text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                          placeholder="First"
                        />
                        <input
                          type="text"
                          value={editForm.last_name}
                          onChange={e => setEditForm(f => ({ ...f, last_name: e.target.value }))}
                          className="w-full px-2 py-1 bg-bg border border-border rounded text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                          placeholder="Last"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-muted">{member.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={editForm.role}
                        onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                        className="px-2 py-1 bg-bg border border-border rounded text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                      >
                        {ROLES.map(r => (
                          <option key={r} value={r}>{r.replace('_', ' ')}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {locations.map(loc => (
                          <label key={loc.id} className="flex items-center gap-1 text-xs text-text-primary cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editForm.location_ids.includes(loc.id)}
                              onChange={() => toggleLocation(loc.id, editForm, setEditForm)}
                              className="accent-wcs-red"
                            />
                            {loc.name}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleUpdate(member.id)}
                          className="text-xs font-medium text-wcs-red hover:underline"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditForm(defaultEditForm) }}
                          className="text-xs text-text-muted hover:text-text-primary"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 text-text-primary font-medium">
                      {[member.first_name, member.last_name].filter(Boolean).join(' ') || member.display_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-text-muted">{member.email}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-bg border border-border rounded text-xs text-text-primary capitalize">
                        {member.role?.replace('_', ' ') || '—'}
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
                          onClick={() => startEdit(member)}
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
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
