import { useState, useEffect } from 'react'
import { getAppSettings, saveAppSettings } from '../../lib/api'
import { LOCATION_NAMES } from '../../config/locations'

// The monthly Operandio audits, one per club per department. Keys must match
// auditKey() in AuditsReport.jsx (lowercased department, non-alphanumerics
// collapsed to underscores).
const AUDITS = [
  { key: 'front_desk_audit', label: 'Front Desk' },
  { key: 'pt_audit', label: 'PT' },
  { key: 'membership_coordinator_audit', label: 'Membership Coordinator' },
  { key: 'group_x_audit', label: 'Group X' },
  { key: 'childcare_audit', label: 'Childcare' },
]

export default function AuditTogglesAdmin() {
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    getAppSettings('audit_off_')
      .then(map => setSettings(map || {}))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function toggle(key) {
    setSettings(prev => ({ ...prev, [key]: prev[key] === '1' ? '' : '1' }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      await saveAppSettings(settings)
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
          <h3 className="text-sm font-bold text-text-primary">Audits</h3>
          <p className="text-xs text-text-muted mt-1">Toggle which monthly Operandio audits each club does. Off audits are hidden from that club's Audits report.</p>
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted">
              <th className="text-left font-semibold py-2 pr-4">Club</th>
              {AUDITS.map(a => (
                <th key={a.key} className="text-center font-semibold py-2 px-2 whitespace-nowrap">{a.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LOCATION_NAMES.map(loc => {
              const slug = loc.toLowerCase()
              return (
                <tr key={slug} className="border-t border-border">
                  <td className="py-2.5 pr-4 font-semibold text-text-primary whitespace-nowrap">{loc}</td>
                  {AUDITS.map(a => {
                    const key = `audit_off_${a.key}_${slug}`
                    const isOff = settings[key] === '1'
                    return (
                      <td key={key} className="py-2.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          title={isOff ? `Turn ${a.label} audit on for ${loc}` : `Turn ${a.label} audit off for ${loc}`}
                          className={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border transition-colors ${
                            isOff
                              ? 'bg-bg text-text-muted border-border hover:text-text-primary'
                              : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                          }`}
                        >
                          {isOff ? 'Off' : 'On'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
