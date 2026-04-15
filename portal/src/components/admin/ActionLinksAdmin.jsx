import { useState, useEffect } from 'react'
import { getAppSettings, saveAppSettings } from '../../lib/api'
import { LOCATION_NAMES } from '../../config/locations'

export default function ActionLinksAdmin() {
  const [links, setLinks] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    Promise.all([
      getAppSettings('tour_url_'),
      getAppSettings('dayone_url_'),
      getAppSettings('vip_url_'),
    ]).then(([tour, d1, vip]) => {
      setLinks({ ...tour, ...d1, ...vip })
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  function handleChange(key, value) {
    setLinks(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      await saveAppSettings(links)
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
          <h3 className="text-sm font-bold text-text-primary">Action Button Links</h3>
          <p className="text-xs text-text-muted mt-1">Configure the Gym Tour, Day One, and VIP URLs per location. These show as action buttons on the home screen.</p>
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
          const tourKey = `tour_url_${slug}`
          const d1Key = `dayone_url_${slug}`
          const vipKey = `vip_url_${slug}`
          return (
            <div key={slug} className="bg-surface border border-border rounded-xl p-4">
              <h4 className="text-sm font-bold text-text-primary mb-3">{loc}</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">Gym Tour Booking URL</label>
                  <input
                    type="url"
                    value={links[tourKey] || ''}
                    onChange={e => handleChange(tourKey, e.target.value)}
                    placeholder="https://api.westcoaststrength.com/widget/booking/..."
                    className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">Day One Booking URL</label>
                  <input
                    type="url"
                    value={links[d1Key] || ''}
                    onChange={e => handleChange(d1Key, e.target.value)}
                    placeholder="https://api.westcoaststrength.com/widget/booking/..."
                    className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">VIP Survey URL</label>
                  <input
                    type="url"
                    value={links[vipKey] || ''}
                    onChange={e => handleChange(vipKey, e.target.value)}
                    placeholder="https://api.westcoaststrength.com/widget/survey/..."
                    className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-bg text-text-primary focus:outline-none focus:border-wcs-red"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
