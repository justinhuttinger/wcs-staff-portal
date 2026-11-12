import { useState, useEffect } from 'react'
import { getInsurancePrograms, saveInsurancePrograms } from '../../lib/api'

// Which insurance programs each club's Insurance Check page shows
// (book.westcoaststrength.com/insurance/<club>, opened from WCS ABC).
export default function InsuranceProgramsAdmin() {
  const [programs, setPrograms] = useState([])
  const [clubs, setClubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    getInsurancePrograms()
      .then(d => { setPrograms(d.programs || []); setClubs(d.clubs || []) })
      .catch(err => setMessage({ type: 'error', text: err.message }))
      .finally(() => setLoading(false))
  }, [])

  function toggle(slug, key) {
    setClubs(prev => prev.map(c => {
      if (c.slug !== slug) return c
      const on = c.programs.includes(key)
      return { ...c, programs: on ? c.programs.filter(k => k !== key) : [...c.programs, key] }
    }))
    setDirty(true)
    setMessage(null)
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      await saveInsurancePrograms(Object.fromEntries(clubs.map(c => [c.slug, c.programs])))
      setDirty(false)
      setMessage({ type: 'success', text: 'Saved! Pages update within a minute.' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-text-muted p-4">Loading...</p>

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Insurance Programs</h3>
          <p className="text-xs text-text-muted mt-1">
            Which programs each club's Insurance Check page shows. Front desk opens it from Insurance Verification in WCS ABC.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {message && (
            <span className={`text-xs font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
              {message.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {clubs.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 text-[11px] font-semibold text-text-muted uppercase tracking-wide">Club</th>
                {programs.map(p => (
                  <th key={p.key} className="px-4 py-3 text-[11px] font-semibold text-text-muted uppercase tracking-wide text-center">{p.name}</th>
                ))}
                <th className="px-4 py-3 text-[11px] font-semibold text-text-muted uppercase tracking-wide text-right">Page</th>
              </tr>
            </thead>
            <tbody>
              {clubs.map(c => (
                <tr key={c.slug} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-semibold text-text-primary">{c.name}</td>
                  {programs.map(p => (
                    <td key={p.key} className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={c.programs.includes(p.key)}
                        onChange={() => toggle(c.slug, p.key)}
                        aria-label={`${p.name} at ${c.name}`}
                        className="w-4 h-4 accent-wcs-red cursor-pointer"
                      />
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <a
                      href={`https://book.westcoaststrength.com/insurance/${c.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-wcs-red hover:underline"
                    >
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
