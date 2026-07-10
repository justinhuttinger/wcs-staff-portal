import { useState, useEffect } from 'react'
import { getTillSettings, setTillFloat } from '../../lib/api'

// Per-location standard float (the cash the drawer resets to each night). This
// value is the baseline the Till reconciliation report measures overnight drift
// and bag drops against, so it's edited here rather than on the report itself.
export default function TillSettingsAdmin() {
  const [rows, setRows] = useState([])
  const [drafts, setDrafts] = useState({})   // location_slug -> string input value
  const [loading, setLoading] = useState(true)
  const [savingSlug, setSavingSlug] = useState(null)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getTillSettings()
      .then(({ settings }) => {
        const list = settings || []
        setRows(list)
        setDrafts(Object.fromEntries(list.map(s => [s.location_slug, String(s.standard_float)])))
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function save(slug) {
    const raw = drafts[slug]
    const val = parseFloat(raw)
    if (!Number.isFinite(val) || val < 0) {
      setMessage({ slug, type: 'error', text: 'Enter a non-negative number' })
      return
    }
    setSavingSlug(slug)
    setMessage(null)
    try {
      const { setting } = await setTillFloat(slug, val)
      setRows(prev => prev.map(r => r.location_slug === slug ? { ...r, standard_float: setting.standard_float, updated_at: setting.updated_at } : r))
      setDrafts(prev => ({ ...prev, [slug]: String(setting.standard_float) }))
      setMessage({ slug, type: 'success', text: 'Saved' })
    } catch (err) {
      setMessage({ slug, type: 'error', text: err.message })
    }
    setSavingSlug(null)
  }

  if (loading) return <p className="text-sm text-text-muted p-4">Loading...</p>
  if (error) return <p className="text-sm text-red-500 p-4">{error}</p>

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-text-primary">Till Float</h3>
        <p className="text-xs text-text-muted mt-1">
          The standard float each club's cash drawer resets to. The Till report reconciles overnight drift and bag drops against this baseline.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted">
              <th className="text-left font-semibold py-2 pr-4">Club</th>
              <th className="text-left font-semibold py-2 px-2">Standard Float</th>
              <th className="text-left font-semibold py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const slug = r.location_slug
              const dirty = drafts[slug] !== String(r.standard_float)
              const msg = message && message.slug === slug ? message : null
              return (
                <tr key={slug} className="border-t border-border">
                  <td className="py-2.5 pr-4 font-semibold text-text-primary capitalize whitespace-nowrap">{slug}</td>
                  <td className="py-2.5 px-2">
                    <div className="flex items-center gap-1">
                      <span className="text-text-muted">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={drafts[slug] ?? ''}
                        onChange={e => setDrafts(prev => ({ ...prev, [slug]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') save(slug) }}
                        className="w-28 bg-bg border border-border rounded-lg px-2 py-1 text-text-primary focus:outline-none focus:border-wcs-red"
                      />
                    </div>
                  </td>
                  <td className="py-2.5 px-2">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => save(slug)}
                        disabled={savingSlug === slug || !dirty}
                        className="text-xs bg-wcs-red text-white rounded-lg px-3 py-1 font-medium hover:bg-wcs-red/90 disabled:opacity-40"
                      >
                        {savingSlug === slug ? 'Saving...' : 'Save'}
                      </button>
                      {msg && (
                        <span className={`text-xs font-medium ${msg.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                          {msg.text}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
