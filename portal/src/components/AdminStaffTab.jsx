import { useState, useEffect, useMemo } from 'react'
import { getStaff, createStaff, updateStaff, deleteStaff, setStaffActive, getLocations, getRolesAdmin } from '../lib/api'
import { LOCATION_NAMES } from '../config/locations'
import { MARKETING_TYPES } from '../config/marketingTypes'
import { PORTAL_TILE_CATALOG, CUSTOM_REPORT_CATALOG } from '../config/portalTiles'
import AdminStaffOverrides from './AdminStaffOverrides'

// 'marketing' is no longer a base role — it's an add-on toggle below. 'custom'
// lets an admin hand-pick tiles + reports for one person.
const ROLES = ['team_member', 'lead', 'manager', 'custom', 'corporate', 'admin']

const emptyForm = {
  email: '',
  first_name: '',
  last_name: '',
  role: 'team_member',
  location_ids: [],
  location_permissions: {},
  temp_password: '',
  marketing_addon: false,
  marketing_locations: [],   // [] = all clubs
  marketing_types: [],       // [] = all types
  custom_tiles: [],
  custom_reports: [],
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
    marketing_addon: !!member.marketing_addon,
    marketing_locations: member.marketing_locations || [], // null → [] = all clubs
    marketing_types: member.marketing_types || [],         // null → [] = all types
    custom_tiles: member.custom_tiles || [],
    custom_reports: member.custom_reports || [],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Source role options from the roles table so admin-created custom roles are
  // assignable. Append non-builtin roles to the built-in list; fall back to the
  // built-ins if the fetch fails. (Assignment is enforced server-side too.)
  const [roleOptions, setRoleOptions] = useState(ROLES)
  const [rbacEnabled, setRbacEnabled] = useState(false)
  const [showOverrides, setShowOverrides] = useState(false)
  useEffect(() => {
    getRolesAdmin().then(r => {
      const custom = (r?.roles || []).filter(x => !x.is_builtin).map(x => x.name)
      if (custom.length) setRoleOptions([...ROLES, ...custom])
      setRbacEnabled(!!r?.rbac_v2_enabled)
    }).catch(() => {})
  }, [])

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

  // Toggle a value in one of the array-valued permission fields.
  function toggleInList(field, value) {
    setForm(prev => {
      const list = prev[field] || []
      return {
        ...prev,
        [field]: list.includes(value) ? list.filter(v => v !== value) : [...list, value],
      }
    })
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl border border-border w-full max-w-lg max-h-[90vh] flex flex-col p-6">
        <div className="flex items-center justify-between mb-5 shrink-0">
          <h3 className="text-lg font-bold text-text-primary">{isNew ? 'New Staff Member' : 'Edit Staff Member'}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>

        <div className="overflow-y-auto min-h-0 -mr-2 pr-2">
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
              {roleOptions.map(r => (
                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          {/* Per-person permission overrides (RBAC v2). Existing members only —
              overrides key off the saved staff id. Save the member first to add. */}
          {rbacEnabled && !isNew && (
            <div className="rounded-lg border border-border bg-bg">
              <button
                type="button"
                onClick={() => setShowOverrides(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-left"
              >
                <span className="text-xs font-semibold text-text-primary">Permission overrides (Beta)</span>
                <span className="text-xs text-text-muted">{showOverrides ? 'Hide' : 'Edit'}</span>
              </button>
              {showOverrides && (
                <div className="px-3 pb-3 max-h-80 overflow-y-auto">
                  <AdminStaffOverrides staffId={member.id} />
                </div>
              )}
            </div>
          )}

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

          {/* Marketing add-on — layers on top of any base role */}
          <div className="rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.marketing_addon}
                onChange={() => setForm(f => ({ ...f, marketing_addon: !f.marketing_addon }))}
                className="rounded border-border text-wcs-red focus:ring-wcs-red"
              />
              <span className="text-sm font-medium text-text-primary">Marketing add-on</span>
              <span className="text-xs text-text-muted">— grants the Marketing Tracker</span>
            </label>

            {form.marketing_addon && (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs text-text-muted font-medium mb-1.5">
                    Clubs they can see <span className="text-text-muted/70">(none = all clubs)</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {LOCATION_NAMES.map(name => {
                      const slug = name.toLowerCase()
                      const on = form.marketing_locations.includes(slug)
                      return (
                        <button
                          key={slug}
                          type="button"
                          onClick={() => toggleInList('marketing_locations', slug)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${on ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
                        >{name}</button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-text-muted font-medium mb-1.5">
                    Content types they can see <span className="text-text-muted/70">(none = all types)</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {MARKETING_TYPES.map(t => {
                      const on = form.marketing_types.includes(t.slug)
                      return (
                        <button
                          key={t.slug}
                          type="button"
                          onClick={() => toggleInList('marketing_types', t.slug)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${on ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
                        >{t.label}</button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Custom role — hand-pick tiles + reports (clubs come from Locations above) */}
          {form.role === 'custom' && (
            <div className="rounded-lg border border-border p-3 space-y-4">
              <p className="text-xs text-text-muted">
                Custom role: this person sees only the tiles and reports you check below.
                Their clubs are the Locations selected above.
              </p>
              <div>
                <p className="text-xs text-text-muted font-medium mb-1.5">Tiles</p>
                {['apps', 'tools'].map(group => (
                  <div key={group} className="mb-2">
                    <p className="text-[10px] uppercase tracking-wider text-text-muted/70 mb-1">{group}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {PORTAL_TILE_CATALOG.filter(t => t.group === group).map(t => {
                        const on = form.custom_tiles.includes(t.key)
                        return (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => toggleInList('custom_tiles', t.key)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${on ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
                          >{t.label}</button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-text-muted font-medium mb-1.5">Reports</p>
                <div className="flex flex-wrap gap-1.5">
                  {CUSTOM_REPORT_CATALOG.map(r => {
                    const on = form.custom_reports.includes(r.key)
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => toggleInList('custom_reports', r.key)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${on ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
                      >{r.label}</button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

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
    </div>
  )
}

export default function AdminStaffTab() {
  const [staff, setStaff] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalMember, setModalMember] = useState(undefined) // undefined=closed, null=new, object=edit

  // Filters. Defaults: every location + active employees only.
  const [search, setSearch] = useState('')
  const [locationFilter, setLocationFilter] = useState('all') // 'all' | location id
  const [statusFilter, setStatusFilter] = useState('active')  // 'active' | 'inactive' | 'all'

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

  async function handleToggleActive(member) {
    const next = member.is_active === false // currently inactive → reactivating
    const verb = next ? 'reactivate' : 'deactivate'
    const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email
    if (!window.confirm(
      next
        ? `Reactivate ${name}? They'll be able to sign in to the portal again.`
        : `Deactivate ${name}? They'll be blocked from signing in. You can reactivate them later.`
    )) return
    setError(null)
    try {
      await setStaffActive(member.id, next)
      await loadData()
    } catch (e) {
      setError(e.message || `Failed to ${verb} staff member`)
    }
  }

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLowerCase()
    return staff.filter(m => {
      const isActive = m.is_active !== false
      if (statusFilter === 'active' && !isActive) return false
      if (statusFilter === 'inactive' && isActive) return false
      if (locationFilter !== 'all' && !(m.locations || []).some(l => l.id === locationFilter)) return false
      if (term) {
        const hay = [m.first_name, m.last_name, m.display_name, m.email].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [staff, search, locationFilter, statusFilter])

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

      {/* Filters + add. Defaults to all locations + active employees. */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Search</label>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Name or email..."
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Location</label>
          <select
            value={locationFilter}
            onChange={e => setLocationFilter(e.target.value)}
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
          >
            <option value="all">All locations</option>
            {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Status</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
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
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Status</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredStaff.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted text-sm">
                  {staff.length === 0 ? 'No staff members found.' : 'No staff match these filters.'}
                </td>
              </tr>
            )}
            {filteredStaff.map(member => {
              const isActive = member.is_active !== false
              return (
              <tr key={member.id} className={`border-b border-border last:border-0 hover:bg-bg transition-colors ${isActive ? '' : 'opacity-60'}`}>
                <td className="px-4 py-3 text-text-primary font-medium">
                  {[member.first_name, member.last_name].filter(Boolean).join(' ') || member.display_name || '—'}
                </td>
                <td className="px-4 py-3 text-text-muted">{member.email}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="px-2 py-0.5 bg-bg border border-border rounded text-xs text-text-primary capitalize">
                      {member.role?.replace(/_/g, ' ') || '—'}
                    </span>
                    {member.marketing_addon && (
                      <span className="px-2 py-0.5 bg-wcs-red/10 border border-wcs-red/20 rounded text-[10px] font-semibold text-wcs-red uppercase tracking-wide">
                        Marketing
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-text-muted text-xs">
                  {member.locations?.length
                    ? member.locations.map(l => l.name).join(', ')
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  {isActive ? (
                    <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">
                      Active
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-bg border border-border rounded text-[10px] font-semibold text-text-muted uppercase tracking-wide">
                      Inactive
                    </span>
                  )}
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
                      onClick={() => handleToggleActive(member)}
                      className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
                    >
                      {isActive ? 'Deactivate' : 'Reactivate'}
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
              )
            })}
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
