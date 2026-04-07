import { useState, useEffect } from 'react'
import { getRoleVisibility, updateRoleVisibility } from '../lib/api'

const ROLES = ['front_desk', 'personal_trainer', 'manager', 'director', 'admin']
const TOOLS = ['grow', 'abc', 'wheniwork', 'paychex', 'gmail', 'drive']

const TOOL_LABELS = {
  grow: 'Grow (CRM)',
  abc: 'ABC Financial',
  wheniwork: 'WhenIWork',
  paychex: 'Paychex',
  gmail: 'Gmail',
  drive: 'Google Drive',
}

export default function AdminRolesTab() {
  const [visibility, setVisibility] = useState([])
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
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  function isVisible(role, toolKey) {
    const entry = visibility.find(v => v.role === role && v.tool_key === toolKey)
    return entry ? entry.visible : true
  }

  function toggle(role, toolKey) {
    setVisibility(prev => prev.map(v =>
      v.role === role && v.tool_key === toolKey
        ? { ...v, visible: !v.visible }
        : v
    ))
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
                <th key={role} className="text-center px-3 py-3 font-medium text-text-muted text-xs">
                  {role.replace('_', ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TOOLS.map(tool => (
              <tr key={tool} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-text-primary font-medium">{TOOL_LABELS[tool] || tool}</td>
                {ROLES.map(role => (
                  <td key={role} className="text-center px-3 py-3">
                    <input
                      type="checkbox"
                      checked={isVisible(role, tool)}
                      onChange={() => toggle(role, tool)}
                      className="accent-wcs-red w-4 h-4 cursor-pointer"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted mt-3">
        Uncheck a box to hide that tool from staff with that role.
      </p>
    </div>
  )
}
