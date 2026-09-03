import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'

export default function MemberAppMembers({ selected, onSelect }) {
  const [q, setQ] = useState('')
  const [members, setMembers] = useState([])
  const [coaches, setCoaches] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    api('/member-app/coaches')
      .then(r => setCoaches(r.coaches || []))
      .catch(() => setCoaches([]))
  }, [])

  async function search(e) {
    e?.preventDefault()
    if (q.trim().length < 2) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const r = await api(`/member-app/members?q=${encodeURIComponent(q.trim())}`)
      setMembers(r.members || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function save(member, patch) {
    setError(null); setNotice(null)
    const next = { ...member, ...patch }
    // Optimistic: the row updates immediately and reverts only if the save fails.
    setMembers(list => list.map(m => (m.member_id === member.member_id ? next : m)))
    try {
      await api(`/member-app/members/${encodeURIComponent(member.member_id)}/tier`, {
        method: 'PUT',
        body: JSON.stringify({
          club_number: member.club_number,
          tier: next.tier,
          coach_staff_id: next.coach_staff_id || null,
        }),
      })
      setNotice(`Saved ${next.first_name} ${next.last_name}.`)
      if (selected?.member_id === member.member_id) onSelect(next)
    } catch (err) {
      setMembers(list => list.map(m => (m.member_id === member.member_id ? member : m)))
      setError(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={search} className="flex gap-2">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search members by name or email"
          className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-text-primary"
        />
        <button
          type="submit"
          disabled={busy || q.trim().length < 2}
          className="px-4 py-2 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
      {notice ? <p className="text-sm text-green-700">{notice}</p> : null}

      {members.length === 0 ? (
        <p className="text-sm text-text-muted">
          Search for a member to set them to Training and give them a coach.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="py-2 pr-3">Member</th>
                <th className="py-2 pr-3">Club</th>
                <th className="py-2 pr-3">Tier</th>
                <th className="py-2 pr-3">Coach</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={`${m.member_id}-${m.club_number}`} className="border-b border-border">
                  <td className="py-2 pr-3">
                    <div className="font-semibold">{m.first_name} {m.last_name}</div>
                    <div className="text-text-muted text-xs">{m.email || 'no email'}</div>
                  </td>
                  <td className="py-2 pr-3">{m.club_number}</td>
                  <td className="py-2 pr-3">
                    <select
                      value={m.tier}
                      onChange={e => save(m, { tier: e.target.value })}
                      className="px-2 py-1 rounded border border-border bg-surface"
                    >
                      <option value="basic">Basic</option>
                      <option value="training">Training</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={m.coach_staff_id || ''}
                      onChange={e => save(m, { coach_staff_id: e.target.value || null })}
                      className="px-2 py-1 rounded border border-border bg-surface"
                    >
                      <option value="">No coach</option>
                      {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => onSelect(m)}
                      className="text-wcs-red font-semibold hover:underline"
                    >
                      Use
                    </button>
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
