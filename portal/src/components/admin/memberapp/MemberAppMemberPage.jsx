import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import MemberAppPrograms from './MemberAppPrograms.jsx'
import MemberAppHabits from './MemberAppHabits.jsx'
import MemberAppNutrition from './MemberAppNutrition.jsx'
import MemberAppMessages from './MemberAppMessages.jsx'

const TABS = [
  { key: 'programs', label: 'Programs' },
  // Habits are for every member, not just the coached ones.
  { key: 'habits', label: 'Habits' },
  { key: 'nutrition', label: 'Nutrition' },
  { key: 'messages', label: 'Messages' },
]

export default function MemberAppMemberPage({ member, onChange, onBack }) {
  const [tab, setTab] = useState('programs')
  const [coaches, setCoaches] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    api('/member-app/coaches')
      .then(r => setCoaches(r.coaches || []))
      .catch(() => setCoaches([]))
  }, [])

  async function save(patch) {
    const next = { ...member, ...patch }
    setSaving(true); setError(null); setNotice(null)
    // Optimistic, reverted only if the save fails.
    onChange(next)
    try {
      await api(`/member-app/members/${encodeURIComponent(member.member_id)}/tier`, {
        method: 'PUT',
        body: JSON.stringify({
          club_number: member.club_number,
          tier: next.tier,
          coach_staff_id: next.coach_staff_id || null,
        }),
      })
      setNotice('Saved.')
    } catch (err) {
      onChange(member)
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const select = 'px-2 py-2 rounded border border-border bg-surface text-text-primary'

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        All members
      </button>

      <div className="border border-border rounded-lg bg-surface p-4 space-y-3">
        <div>
          <h3 className="text-lg font-bold text-text-primary">
            {member.first_name} {member.last_name}
          </h3>
          <p className="text-xs text-text-muted">Club {member.club_number}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-text-muted mb-1">Tier</span>
            <select
              className={select} value={member.tier || 'basic'} disabled={saving}
              onChange={e => save({ tier: e.target.value })}
            >
              <option value="basic">Basic</option>
              <option value="training">Training</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-text-muted mb-1">Coach</span>
            <select
              className={select} value={member.coach_staff_id || ''} disabled={saving}
              onChange={e => save({ coach_staff_id: e.target.value || null })}
            >
              <option value="">No coach</option>
              {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>

        {member.tier !== 'training' ? (
          <p className="text-xs text-text-muted">
            Basic members can still message you. Set them to Training to give them a program.
          </p>
        ) : null}

        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
        {notice ? <p className="text-sm text-green-700">{notice}</p> : null}
      </div>

      <div className="flex gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'px-4 py-2 rounded-lg text-sm font-semibold border transition-colors',
              tab === t.key
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-surface text-text-primary border-border hover:border-text-muted',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'programs' && <MemberAppPrograms member={member} />}
      {tab === 'habits' && <MemberAppHabits member={member} />}
      {tab === 'nutrition' && <MemberAppNutrition member={member} />}
      {tab === 'messages' && <MemberAppMessages member={member} />}
    </div>
  )
}
