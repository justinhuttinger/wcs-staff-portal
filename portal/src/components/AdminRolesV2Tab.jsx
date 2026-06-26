import { useState, useEffect, useMemo } from 'react'
import { getRolesAdmin, createRole, renameRole, deleteRole, updateRoleVisibility } from '../lib/api'

const TIERS = ['team_member', 'lead', 'manager', 'corporate', 'admin']
const TIER_LABEL = { team_member: 'Team Member', lead: 'Lead', manager: 'Manager', corporate: 'Corporate', admin: 'Admin' }
const CATEGORIES = ['Apps', 'Tools', 'Reports', 'Actions']

export default function AdminRolesV2Tab() {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null) // role name
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTier, setNewTier] = useState('lead')
  const [localVis, setLocalVis] = useState({}) // tool_key -> bool for selected role

  async function load() {
    setError('')
    try {
      const res = await getRolesAdmin()
      setData(res)
      setSelected(prev => prev || (res.roles.length ? res.roles[0].name : null))
    } catch (e) { setError(e.message || 'Failed to load roles') }
  }
  useEffect(() => { load() }, [])

  const selectedRole = useMemo(() => (data?.roles || []).find(r => r.name === selected), [data, selected])

  useEffect(() => {
    if (!data || !selected) return
    const map = {}
    for (const v of data.visibility) if (v.role === selected) map[v.tool_key] = v.visible
    setLocalVis(map)
  }, [data, selected])

  if (!data) return <div className="p-6 text-sm text-text-muted">{error || 'Loading roles...'}</div>

  // Tool-visibility editing of existing roles is always available (this is the
  // single roles admin page). Creating/renaming/deleting custom roles is gated
  // behind RBAC_V2_ENABLED until the full custom-role system is switched on.
  const canManageRoles = !!data.rbac_v2_enabled

  function toggle(permKey) {
    setLocalVis(prev => ({ ...prev, [permKey]: !prev[permKey] }))
  }

  async function saveGrid() {
    setSaving(true); setError('')
    try {
      const updates = data.grid.map(row => ({ role: selected, tool_key: row.perm_key, visible: !!localVis[row.perm_key] }))
      await updateRoleVisibility(updates)
      await load()
    } catch (e) { setError(e.message || 'Failed to save') } finally { setSaving(false) }
  }

  async function handleCreate() {
    setError('')
    try {
      const res = await createRole({ name: newName, base_tier: newTier })
      setNewName(''); setCreating(false)
      await load()
      setSelected(res.role.name)
    } catch (e) { setError(e.message || 'Failed to create role') }
  }

  async function handleRename(role) {
    const name = window.prompt('Rename role', role.name)
    if (!name || name === role.name) return
    try { await renameRole(role.id, name); setSelected(name); await load() }
    catch (e) { setError(e.message || 'Failed to rename') }
  }

  async function handleDelete(role) {
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return
    try { await deleteRole(role.id); setSelected(null); await load() }
    catch (e) { setError(e.message || 'Failed to delete') }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-4 flex gap-6">
      {/* Roles list */}
      <div className="w-64 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-text-primary">Roles</h3>
          {canManageRoles && (
            <button onClick={() => setCreating(c => !c)} className="text-xs font-semibold text-wcs-red">+ New role</button>
          )}
        </div>
        {canManageRoles && creating && (
          <div className="mb-3 p-3 rounded-lg border border-border bg-surface space-y-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Role name"
              className="w-full px-2 py-1.5 rounded border border-border text-sm bg-bg text-text-primary" />
            <select value={newTier} onChange={e => setNewTier(e.target.value)} className="w-full px-2 py-1.5 rounded border border-border text-sm bg-bg text-text-primary">
              {TIERS.map(t => <option key={t} value={t}>{TIER_LABEL[t]} tier</option>)}
            </select>
            <button onClick={handleCreate} className="w-full py-1.5 rounded bg-wcs-red text-white text-sm font-semibold">Create</button>
          </div>
        )}
        <div className="space-y-1">
          {data.roles.map(r => (
            <button key={r.id} onClick={() => setSelected(r.name)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm border ${selected === r.name ? 'border-wcs-red bg-wcs-red/5' : 'border-border bg-surface'}`}>
              <span className="font-medium text-text-primary">{r.name}</span>
              <span className="block text-[11px] text-text-muted">{TIER_LABEL[r.base_tier]} tier {r.is_builtin ? '(built-in)' : `, ${r.assigned_count} assigned`}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Permission grid */}
      <div className="flex-1 min-w-0">
        {error && <p className="text-sm text-wcs-red mb-3">{error}</p>}
        {selectedRole && (
          <>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-text-primary">{selectedRole.name}</h3>
                <p className="text-xs text-text-muted">Toggle exactly what this role can see and do</p>
              </div>
              <div className="flex items-center gap-2">
                {canManageRoles && !selectedRole.is_builtin && <button onClick={() => handleRename(selectedRole)} className="text-xs font-semibold text-text-muted">Rename</button>}
                {canManageRoles && !selectedRole.is_builtin && <button onClick={() => handleDelete(selectedRole)} className="text-xs font-semibold text-wcs-red">Delete</button>}
                <button onClick={saveGrid} disabled={saving} className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
            {CATEGORIES.map(cat => {
              const rows = data.grid.filter(r => r.category === cat)
              if (!rows.length) return null
              return (
                <div key={cat} className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">{cat}</p>
                  <div className="rounded-lg border border-border divide-y divide-border bg-surface">
                    {rows.map(row => {
                      const on = !!localVis[row.perm_key]
                      return (
                        <label key={row.perm_key} className="flex items-center justify-between px-3 py-2 text-sm cursor-pointer">
                          <span className="text-text-primary">{row.label}</span>
                          <input type="checkbox" checked={on} onChange={() => toggle(row.perm_key)} />
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
