import { useState, useEffect } from 'react'
import { getStaffOverrides, updateStaffOverrides } from '../lib/api'

const TIERS = ['team_member', 'lead', 'manager', 'corporate', 'admin']
const TIER_LABEL = { team_member: 'Team Member', lead: 'Lead', manager: 'Manager', corporate: 'Corporate', admin: 'Admin' }
const CATEGORIES = ['Apps', 'Tools', 'Reports', 'Actions']
const STATES = [
  { key: 'inherit', label: 'Inherit' },
  { key: 'on', label: 'On' },
  { key: 'off', label: 'Off' },
]

// Per-person permission overrides on top of a member's role. Three-state per
// permission: Inherit (follow the role), Force on, Force off. Rows above the
// member's tier ceiling are locked (the server drops a force-on past tier too).
export default function AdminStaffOverrides({ staffId }) {
  const [data, setData] = useState(null)
  const [states, setStates] = useState({}) // perm_key -> 'inherit' | 'on' | 'off'
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null); setError('')
    getStaffOverrides(staffId).then(res => {
      if (!alive) return
      const ovr = {}
      for (const o of (res.overrides || [])) ovr[o.perm_key] = o.visible ? 'on' : 'off'
      const init = {}
      for (const row of (res.grid || [])) init[row.perm_key] = ovr[row.perm_key] || 'inherit'
      setStates(init)
      setData(res)
    }).catch(e => { if (alive) setError(e.message || 'Failed to load permissions') })
    return () => { alive = false }
  }, [staffId])

  if (error) return <p className="text-sm text-wcs-red">{error}</p>
  if (!data) return <p className="text-sm text-text-muted">Loading permissions...</p>
  if (!data.rbac_v2_enabled) {
    return <p className="text-sm text-text-muted">Custom permissions are not enabled yet.</p>
  }

  const baseIdx = TIERS.indexOf(data.base_tier)
  const baseSet = new Set(data.base_keys || [])

  function setStateFor(key, val) {
    setSaved(false)
    setStates(prev => ({ ...prev, [key]: val }))
  }

  async function save() {
    setSaving(true); setError('')
    try {
      const items = (data.grid || []).map(row => ({ perm_key: row.perm_key, state: states[row.perm_key] || 'inherit' }))
      await updateStaffOverrides(staffId, items)
      setSaved(true)
    } catch (e) { setError(e.message || 'Failed to save') } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">
        Overrides apply on top of the <span className="font-semibold capitalize">{(data.role || '').replace(/_/g, ' ')}</span> role
        ({TIER_LABEL[data.base_tier] || data.base_tier} tier ceiling). Inherit follows the role; Force on / Force off override it.
      </p>
      {CATEGORIES.map(cat => {
        const rows = (data.grid || []).filter(r => r.category === cat)
        if (!rows.length) return null
        return (
          <div key={cat}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1">{cat}</p>
            <div className="rounded-lg border border-border divide-y divide-border bg-surface">
              {rows.map(row => {
                const locked = TIERS.indexOf(row.min_tier) > baseIdx
                const inheritOn = baseSet.has(row.perm_key)
                const cur = states[row.perm_key] || 'inherit'
                return (
                  <div key={row.perm_key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <span className="block text-sm text-text-primary truncate">{row.label}</span>
                      {locked
                        ? <span className="text-[11px] text-text-muted">Locked, needs {TIER_LABEL[row.min_tier] || row.min_tier} tier</span>
                        : <span className="text-[11px] text-text-muted">Inherits: {inheritOn ? 'On' : 'Off'}</span>}
                    </div>
                    {locked ? (
                      <span className="text-[11px] text-text-muted shrink-0">—</span>
                    ) : (
                      <div className="flex rounded-md border border-border overflow-hidden shrink-0">
                        {STATES.map(s => (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => setStateFor(row.perm_key, s.key)}
                            className={`px-2.5 py-1 text-xs font-medium ${cur === s.key
                              ? (s.key === 'on' ? 'bg-green-600 text-white' : s.key === 'off' ? 'bg-wcs-red text-white' : 'bg-text-muted/20 text-text-primary')
                              : 'bg-bg text-text-muted hover:bg-surface'}`}
                          >{s.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-50">
          {saving ? 'Saving...' : 'Save overrides'}
        </button>
        {saved && <span className="text-xs text-green-600 font-medium">Saved</span>}
      </div>
    </div>
  )
}
