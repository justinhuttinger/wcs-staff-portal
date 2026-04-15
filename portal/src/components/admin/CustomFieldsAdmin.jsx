import { useState } from 'react'
import { getCustomFields } from '../../lib/api'

export default function CustomFieldsAdmin() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expandedLoc, setExpandedLoc] = useState(null)
  const [search, setSearch] = useState('')

  async function handleFetch() {
    setLoading(true)
    setError(null)
    try {
      const res = await getCustomFields()
      setData(res.locations)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  function copyJSON() {
    if (!data) return
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
  }

  const searchLower = search.toLowerCase()

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-text-primary">GHL Custom Fields — All Locations</h3>
          <p className="text-xs text-text-muted mt-1">Pull custom field definitions and sample values from GHL</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleFetch}
            disabled={loading}
            className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
          >
            {loading ? 'Pulling...' : 'Pull Custom Fields'}
          </button>
          {data && (
            <button
              onClick={copyJSON}
              className="text-xs bg-surface border border-border rounded-lg px-4 py-1.5 font-medium text-text-muted hover:text-text-primary transition-colors"
            >
              Copy JSON
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {data && (
        <>
          <input
            type="text"
            placeholder="Search field name, key, or ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full text-xs bg-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />

          <div className="space-y-2">
            {data.map(loc => {
              const expanded = expandedLoc === loc.name
              const defs = (loc.definitions || []).filter(d =>
                !searchLower || (d.name || '').toLowerCase().includes(searchLower) ||
                (d.fieldKey || '').toLowerCase().includes(searchLower) ||
                (d.id || '').toLowerCase().includes(searchLower)
              )

              return (
                <div key={loc.name} className="bg-surface border border-border rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedLoc(expanded ? null : loc.name)}
                    className="w-full flex items-center justify-between px-5 py-3 hover:bg-bg/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                      <span className="text-sm font-bold text-text-primary">{loc.name}</span>
                      <span className="text-xs text-text-muted font-mono">{loc.locationId}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-muted">{loc.definitions?.length || 0} fields</span>
                      {loc.error && <span className="text-xs text-red-500">{loc.error}</span>}
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t border-border">
                      {loc.defError && <p className="text-xs text-red-500 px-5 py-2">Definition error: {loc.defError}</p>}

                      {defs.length > 0 && (
                        <>
                          <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[11px] text-text-muted uppercase tracking-wide font-semibold bg-bg/50">
                            <span className="col-span-4">Name</span>
                            <span className="col-span-3">Field Key</span>
                            <span className="col-span-3">ID</span>
                            <span className="col-span-2">Type</span>
                          </div>
                          {defs.map(d => {
                            const isDate = d.dataType === 'DATE' || (d.name || '').toLowerCase().includes('date')
                            return (
                              <div key={d.id} className={`grid grid-cols-12 gap-2 px-5 py-2 text-xs border-t border-border/50 items-center ${isDate ? 'bg-yellow-50/50' : ''}`}>
                                <span className="col-span-4 text-text-primary font-medium">{d.name}</span>
                                <span className="col-span-3 text-text-muted font-mono text-[11px]">{d.fieldKey}</span>
                                <span className="col-span-3 text-text-muted font-mono text-[11px]">{d.id}</span>
                                <span className="col-span-2 text-text-muted">{d.dataType}</span>
                              </div>
                            )
                          })}
                        </>
                      )}

                      {(loc.contactFields || []).length > 0 && (
                        <>
                          <div className="px-5 py-2 text-[11px] text-text-muted uppercase tracking-wide font-semibold bg-bg/50 border-t border-border">
                            Sample Values from Contacts
                          </div>
                          {loc.contactFields
                            .filter(f => !searchLower || (f.id || '').toLowerCase().includes(searchLower) || String(f.sampleValue || '').toLowerCase().includes(searchLower))
                            .map(f => {
                              const val = typeof f.sampleValue === 'string' ? f.sampleValue : JSON.stringify(f.sampleValue)
                              const isDate = typeof f.sampleValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.sampleValue)
                              return (
                                <div key={f.id} className={`grid grid-cols-12 gap-2 px-5 py-2 text-xs border-t border-border/50 items-center ${isDate ? 'bg-yellow-50/50' : ''}`}>
                                  <span className="col-span-4 text-text-muted font-mono text-[11px]">{f.id}</span>
                                  <span className="col-span-6 text-text-primary truncate">{val}</span>
                                  <span className="col-span-2 text-text-muted">{isDate ? 'DATE' : ''}</span>
                                </div>
                              )
                            })}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
