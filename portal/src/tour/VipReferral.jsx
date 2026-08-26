import { useEffect, useRef, useState } from 'react'
import { publicTour } from '../lib/api'

/**
 * Who sent this person, shown when the outcome is a VIP pass.
 *
 * Two states, decided by what GHL already holds:
 *
 *   known    the contact already has a referrer and/or a team member. Shown as
 *            a note, read-only. Staff are checking somebody in, not doing data
 *            entry, and re-asking a question we already have the answer to is
 *            how a 30-second job becomes a minute.
 *   blank    ask. Both questions are optional -- plenty of VIP passes come from
 *            a friend with no team member involved, or a team member handing
 *            out cards to strangers.
 *
 * Picking a referrer from the list also captures their ABC member id, which is
 * the part that lets anything downstream actually credit the right person. The
 * list is active members of THIS club only, with phone and email shown, because
 * "Chris Miller" is three different people and staff need to see which one.
 *
 * The team member is a dropdown off the same roster as Tour Member rather than
 * a text box: it cannot be mistyped, and a typo here is invisible until someone
 * runs a report and finds "Caleb Ivey" split across four spellings.
 */
export default function VipReferral({ token, intakeId, value, onChange, employees }) {
  const [loading, setLoading] = useState(true)
  const [known, setKnown] = useState(null)

  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [searching, setSearching] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    let live = true
    publicTour.referral(token, intakeId)
      .then(r => {
        if (!live) return
        // Only treat it as known when there is something to show.
        setKnown(r.fullName || r.teamMember ? r : null)
        if (r.fullName || r.teamMember) {
          onChange({
            referred_by_full_name: r.fullName || '',
            referred_by_abc_id: r.abcId || '',
            vip_team_member: r.teamMember || '',
          })
        }
      })
      .catch(() => {})
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [token, intakeId])

  // Referrer search, debounced. A stale response must not overwrite a newer one.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setMatches([]); return }
    const mine = ++seq.current
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await publicTour.memberSearch(token, q)
        if (mine === seq.current) setMatches(r.members || [])
      } catch {
        if (mine === seq.current) setMatches([])
      } finally {
        if (mine === seq.current) setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query, token])

  function pick(m) {
    const name = `${m.firstName} ${m.lastName}`.trim()
    onChange({ ...value, referred_by_full_name: name, referred_by_abc_id: m.memberId })
    setQuery(name)
    setMatches([])
  }

  if (loading) {
    return <p className="mt-3 text-sm text-text-muted">Checking who referred them…</p>
  }

  if (known) {
    return (
      <div className="mt-3 rounded-xl border border-border bg-bg p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
          Already on file
        </p>
        {known.fullName && (
          <p className="text-sm text-text-primary">
            Referred by <span className="font-semibold">{known.fullName}</span>
            {known.abcId ? '' : ' (no ABC match on file)'}
          </p>
        )}
        {known.teamMember && (
          <p className="text-sm text-text-primary">
            Card from <span className="font-semibold">{known.teamMember}</span>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-border p-3 space-y-3">
      <div>
        <label className="block text-sm font-semibold text-text-primary mb-1">
          Who referred them? <span className="font-normal text-text-muted">(optional)</span>
        </label>
        <input
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            // Typing past a picked name invalidates the id that came with it.
            onChange({ ...value, referred_by_full_name: e.target.value, referred_by_abc_id: '' })
          }}
          placeholder="Start typing a member's name"
          className="w-full px-3 py-2 rounded-xl border border-border text-sm"
        />
        {searching && <p className="text-xs text-text-muted mt-1">Searching…</p>}

        {matches.length > 0 && (
          <ul className="mt-2 border border-border rounded-xl overflow-hidden">
            {matches.map(m => (
              <li key={m.memberId}>
                <button
                  type="button"
                  onClick={() => pick(m)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-bg border-b border-border last:border-b-0"
                >
                  <div className="font-medium text-text-primary">
                    {m.firstName} {m.lastName}
                  </div>
                  {/* Enough to tell two people with the same name apart. */}
                  <div className="text-xs text-text-muted">
                    {[m.phone, m.email].filter(Boolean).join(' · ') || 'no contact details on file'}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {value.referred_by_abc_id && (
          <p className="text-xs text-green-600 mt-1">Matched to an ABC member.</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-semibold text-text-primary mb-1">
          Team member who gave them the card{' '}
          <span className="font-normal text-text-muted">(optional)</span>
        </label>
        <select
          value={value.vip_team_member}
          onChange={e => onChange({ ...value, vip_team_member: e.target.value })}
          className="w-full px-3 py-2 rounded-xl border border-border text-sm bg-surface"
        >
          <option value="">Nobody / not sure</option>
          {(employees || []).map(e => (
            <option key={e.id || e.name} value={e.name}>{e.name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
