// portal/src/components/admin/ClubInfo.jsx
//
// Per-club values the waiver pipeline falls back to when a prospect's own
// answer is unusable.
//
// ABC refuses an entire prospect over one bad field and names the rule rather
// than the field, so a form that asked for a state and got "Not Sure" cost us
// three people in a single day - waiver signed, nothing in ABC, nobody aware
// until the front desk went looking.
//
// These are NOT the club's general contact details. They are only ever
// substituted when the alternative is losing the record, which is why the
// screen says so rather than presenting them as neutral club info.
import { useState, useEffect } from 'react'
import { clubIntegrationsAdmin } from '../../lib/api'

const FIELDS = [
  {
    key: 'fallback_state',
    label: 'State',
    placeholder: 'OR',
    width: 'w-20',
    // The one that actually caused the outage.
    hint: 'Two letters. Used whenever the answer is not a recognisable state.',
  },
  { key: 'fallback_address1', label: 'Street address', placeholder: '123 Main St', width: 'flex-1' },
  { key: 'fallback_city', label: 'City', placeholder: 'Salem', width: 'w-40' },
  { key: 'fallback_postal_code', label: 'ZIP', placeholder: '97301', width: 'w-24' },
  { key: 'fallback_phone', label: 'Phone', placeholder: '(503) 555-0100', width: 'w-40' },
]

export default function ClubInfo() {
  const [clubs, setClubs] = useState([])
  const [edits, setEdits] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [warning, setWarning] = useState(null)
  const [savingClub, setSavingClub] = useState(null)
  const [savedClub, setSavedClub] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await clubIntegrationsAdmin.list()
      setClubs(res.clubs || [])
      setWarning(res.warning || null)
      const seeded = {}
      for (const c of (res.clubs || [])) {
        seeded[c.abc_club_number] = Object.fromEntries(FIELDS.map(f => [f.key, c[f.key] || '']))
      }
      setEdits(seeded)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  function setField(clubNumber, key, value) {
    setEdits(m => ({ ...m, [clubNumber]: { ...(m[clubNumber] || {}), [key]: value } }))
  }

  async function save(club) {
    const n = club.abc_club_number
    setSavingClub(n)
    setError(null)
    setFieldErrors(f => ({ ...f, [n]: {} }))
    try {
      // Only the fallback fields are sent, so saving here can never disturb the
      // webhook URLs the Club Integrations screen owns on the same row.
      await clubIntegrationsAdmin.update(n, edits[n] || {})
      setSavedClub(n)
      setTimeout(() => setSavedClub(s => (s === n ? null : s)), 2000)
    } catch (e) {
      // The server returns which field it refused; showing it on the field
      // beats a generic banner when five inputs are on one row.
      const fields = e?.fields || e?.data?.fields
      if (fields) setFieldErrors(f => ({ ...f, [n]: fields }))
      setError(e.message)
    }
    setSavingClub(null)
  }

  if (loading) return <p className="loading-card mx-auto block my-6">Loading clubs…</p>

  return (
    <div className="space-y-4">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5">
        <h3 className="text-sm font-bold text-text-primary">Club Info</h3>
        <p className="text-xs text-text-muted mt-1">
          Values the waiver pipeline substitutes when a member&rsquo;s own answer is unusable. ABC rejects the
          whole prospect over a single bad field, so a fallback is the difference between a thin record and no
          record at all.
        </p>
        <p className="text-[11px] text-text-muted mt-2">
          These are used <span className="font-semibold">only</span> as a last resort, never to overwrite a real
          answer. Leave a field blank to keep whatever <span className="font-mono">clubs-config.json</span> has.
        </p>
      </div>

      {warning && (
        <div className="bg-surface/95 rounded-xl border border-border p-4">
          <p className="text-xs text-amber-600">{warning}</p>
        </div>
      )}
      {error && (
        <div className="bg-surface/95 rounded-xl border border-border p-4">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        {clubs.map(club => {
          const n = club.abc_club_number
          const row = edits[n] || {}
          const errs = fieldErrors[n] || {}
          return (
            <div key={n} className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm font-semibold text-text-primary">{club.display_name}</span>
                  <span className="text-[11px] text-text-muted ml-2">club {n}</span>
                </div>
                <div className="flex items-center gap-2">
                  {savedClub === n && <span className="text-[11px] text-green-600 font-medium">Saved</span>}
                  <button
                    onClick={() => save(club)}
                    disabled={savingClub === n}
                    className="text-xs bg-wcs-red text-white rounded-lg px-3 py-1.5 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
                  >
                    {savingClub === n ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {FIELDS.map(f => (
                  <div key={f.key} className={f.width}>
                    <label className="block text-[10px] text-text-muted mb-0.5">{f.label}</label>
                    <input
                      type="text"
                      value={row[f.key] ?? ''}
                      onChange={e => setField(n, f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className={
                        'w-full text-xs bg-bg border rounded-lg px-2 py-1.5 text-text-primary ' +
                        'focus:outline-none focus:ring-2 focus:ring-wcs-red/30 ' +
                        (errs[f.key] ? 'border-red-500' : 'border-border')
                      }
                    />
                    {errs[f.key] && <p className="text-[10px] text-red-500 mt-0.5">{errs[f.key]}</p>}
                    {f.hint && !errs[f.key] && (
                      <p className="text-[10px] text-text-muted mt-0.5">{f.hint}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
