import { useState, useEffect } from 'react'
import { getRoleVisibility, updateRoleVisibility } from '../lib/api'

const ROLES = ['front_desk', 'personal_trainer', 'manager', 'director', 'admin']

const BUILTIN_TOOLS = {
  grow: 'Grow (CRM)',
  abc: 'ABC Financial',
  wheniwork: 'WhenIWork',
  paychex: 'Paychex',
  gmail: 'Gmail',
  drive: 'Google Drive',
}

export default function AdminRolesTab() {
  const [visibility, setVisibility] = useState([])
  const [tileLabels, setTileLabels] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const res = await getRoleVisibility()
      setVisibility(res.visibility || [])
      setTileLabels(res.tile_labels || {})
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  // Get unique tool keys from visibility data
  const allToolKeys = [...new Set(visibility.map(v => v.tool_key))].sort((a, b) => {
    // Built-in tools first, then custom tiles
    const aBuiltin = !a.startsWith('tile:')
    const bBuiltin = !b.startsWith('tile:')
    if (aBuiltin && !bBuiltin) return -1
    if (!aBuiltin && bBuiltin) return 1
    return getToolLabel(a).localeCompare(getToolLabel(b))
  })

  function getToolLabel(toolKey) {
    if (BUILTIN_TOOLS[toolKey]) return BUILTIN_TOOLS[toolKey]
    const tileMeta = tileLabels[toolKey]
    if (tileMeta) {
      const prefix = tileMeta.icon ? tileMeta.icon + ' ' : ''
      return prefix + tileMeta.label
    }
    return toolKey
  }

  function isVisible(role, toolKey) {
    const entry = visibility.find(v => v.role === role && v.tool_key === toolKey)
    return entry ? entry.visible : true
  }

  function toggle(role, toolKey) {
    setVisibility(prev => {
      const exists = prev.find(v => v.role === role && v.tool_key === toolKey)
      if (exists) {
        return prev.map(v =>
          v.role === role && v.tool_key === toolKey ? { ...v, visible: !v.visible } : v
        )
      }
      return [...prev, { role, tool_key: toolKey, visible: false }]
    })
    setMessage('')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const updates = visibility.map(v => ({
        role: v.role,
        tool_key: v.tool_key,
        visible: v.visible,
      }))
      await updateRoleVisibility(updates)
      setMessage('Saved!')
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  if (loading) return <p className="text-text-muted text-sm p-4">Loading role settings...</p>

  // Separate built-in and custom tile keys
  const builtinKeys = allToolKeys.filter(k => !k.startsWith('tile:'))
  const tileKeys = allToolKeys.filter(k => k.startsWith('tile:'))

  // Group tile keys by parent
  const parentTiles = tileKeys.filter(k => {
    const meta = tileLabels[k]
    return meta && !meta.parent_id
  })
  const childTiles = tileKeys.filter(k => {
    const meta = tileLabels[k]
    return meta && meta.parent_id
  })

  function renderRow(toolKey) {
    const isChild = tileLabels[toolKey]?.parent_id
    return (
      <tr key={toolKey} className="border-b border-border last:border-0">
        <td className={`px-4 py-3 text-text-primary font-medium ${isChild ? 'pl-10 text-sm' : ''}`}>
          {isChild ? '└ ' : ''}{getToolLabel(toolKey)}
        </td>
        {ROLES.map(role => (
          <td key={role} className="text-center px-3 py-3">
            <input
              type="checkbox"
              checked={isVisible(role, toolKey)}
              onChange={() => toggle(role, toolKey)}
              className="accent-wcs-red w-4 h-4 cursor-pointer"
            />
          </td>
        ))}
      </tr>
    )
  }

  return (
    <div>
      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}
      {message && <p className="text-sm text-green-600 mb-4">{message}</p>}

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-text-primary">Tool Visibility by Role</h3>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red-hover transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 font-medium text-text-muted">Tool</th>
              {ROLES.map(role => (
                <th key={role} className="text-center px-3 py-3 font-medium text-text-muted text-xs capitalize">
                  {role.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {builtinKeys.length > 0 && (
              <tr><td colSpan={ROLES.length + 1} className="px-4 py-2 bg-bg text-xs font-semibold text-text-muted uppercase tracking-wider">Built-in Tools</td></tr>
            )}
            {builtinKeys.map(renderRow)}
            {parentTiles.length > 0 && (
              <tr><td colSpan={ROLES.length + 1} className="px-4 py-2 bg-bg text-xs font-semibold text-text-muted uppercase tracking-wider">Custom Tiles</td></tr>
            )}
            {parentTiles.map(k => {
              const tileId = k.replace('tile:', '')
              const children = childTiles.filter(ck => tileLabels[ck]?.parent_id === tileId)
              return [renderRow(k), ...children.map(renderRow)]
            })}
            {/* Orphan tiles (no parent, not a group) */}
            {tileKeys.filter(k => {
              const meta = tileLabels[k]
              return meta && !meta.parent_id && !parentTiles.includes(k)
            }).map(renderRow)}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted mt-3">
        Uncheck a box to hide that tool from staff with that role.
      </p>
    </div>
  )
}
