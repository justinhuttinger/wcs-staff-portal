import { useState, useEffect } from 'react'
import { getAppSettings, saveAppSettings } from '../../lib/api'
import { LOCATION_NAMES } from '../../config/locations'

// Must match the goalKey values in KpiReport.jsx KPI_DEFS.
const GOAL_FIELDS = [
  { prefix: 'kpi_goal_trial', label: 'Trial Conversion Goal %' },
  { prefix: 'kpi_goal_dayone', label: 'Day One Attachment Goal %' },
  { prefix: 'kpi_goal_vip', label: 'VIP Collection Goal %' },
  { prefix: 'kpi_goal_speed', label: 'Speed to Lead Goal (min)' },
  { prefix: 'kpi_goal_ops', label: 'Operational Compliance Goal %' },
  { prefix: 'kpi_goal_c2s', label: 'Click2Save Utilization Goal %' },
]

export default function KpiGoalsAdmin() {
  const [goals, setGoals] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    // 'kpi_' covers both kpi_goal_* values and kpi_off_* per-club toggles.
    getAppSettings('kpi_')
      .then(map => setGoals(map || {}))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function handleChange(key, value) {
    setGoals(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      await saveAppSettings(goals)
      setMessage({ type: 'success', text: 'Saved!' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-text-muted p-4">Loading...</p>

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-text-primary">KPI Goals</h3>
          <p className="text-xs text-text-muted mt-1">Set per-club target percentages for the experimental KPIs report. Leave blank for no goal. Toggle a KPI Off for clubs that don't use it — it won't show in that club's view and won't count toward blended numbers.</p>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <span className={`text-xs font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
              {message.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {LOCATION_NAMES.map(loc => {
          const slug = loc.toLowerCase()
          return (
            <div key={slug} className="bg-surface border border-border rounded-xl p-4">
              <h4 className="text-sm font-bold text-text-primary mb-3">{loc}</h4>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {GOAL_FIELDS.map(field => {
                  const key = `${field.prefix}_${slug}`
                  // kpi_goal_trial → kpi_off_trial_{slug}; must match offFor() in KpiReport.jsx
                  const offKey = `kpi_off_${field.prefix.replace('kpi_goal_', '')}_${slug}`
                  const isOff = goals[offKey] === '1'
                  return (
                    <div key={key} className={isOff ? 'opacity-60' : ''}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wide">{field.label}</label>
                        <button
                          type="button"
                          onClick={() => handleChange(offKey, isOff ? '' : '1')}
                          title={isOff ? 'Turn this KPI on for this club' : 'Turn this KPI off for this club'}
                          className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border transition-colors flex-shrink-0 ${
                            isOff
                              ? 'bg-bg text-text-muted border-border hover:text-text-primary'
                              : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                          }`}
                        >
                          {isOff ? 'Off' : 'On'}
                        </button>
                      </div>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={goals[key] ?? ''}
                        onChange={e => handleChange(key, e.target.value)}
                        placeholder={isOff ? 'Off at this club' : 'e.g. 65'}
                        disabled={isOff}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
