import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import MobileHeader from './MobileHeader'

const field = 'w-full px-3 py-3 rounded-lg border border-border bg-bg text-base'

// Some programs are a rotation rather than one workout per session: Push Pull
// Legs is 3 workouts trained 6 days a week, 5x5 alternates two across three.
// Showing days_per_week alone makes those look like they are missing days.
function scheduleSummary(t, workoutCount) {
  const parts = []
  if (workoutCount) parts.push(`${workoutCount} workout${workoutCount === 1 ? '' : 's'}`)
  if (t.days_per_week) parts.push(`${t.days_per_week} days/week`)
  if (workoutCount && t.days_per_week && t.days_per_week > workoutCount) {
    parts.push('repeat the cycle')
  }
  return parts.join(' · ')
}


// Browse the template library and assign one, optionally dated so it takes
// over later. Same endpoints as desktop; the difference is one column.
export default function MobileTemplates({ member, onAssigned, onBack }) {
  const [q, setQ] = useState('')
  const [goal, setGoal] = useState('')
  const [templates, setTemplates] = useState([])
  const [goals, setGoals] = useState([])
  const [preview, setPreview] = useState(null)
  const [startsOn, setStartsOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (goal) params.set('goal', goal)
      const r = await api(`/member-app/templates?${params}`)
      setTemplates(r.templates || [])
      // Only seed the filter from an unfiltered load, or it shrinks to
      // whatever the current filter happens to contain.
      if (!goal) setGoals(r.goals || [])
    } catch (err) {
      setError(err.message)
    }
  }, [q, goal])

  useEffect(() => {
    const id = setTimeout(load, 200) // debounce the search box
    return () => clearTimeout(id)
  }, [load])

  async function assign() {
    setBusy(true); setError(null)
    try {
      await api(`/member-app/templates/${preview.template.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({
          member_id: member.member_id,
          club_number: member.club_number,
          starts_on: startsOn || null,
        }),
      })
      onAssigned(startsOn)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (preview) {
    const t = preview.template
    return (
      <div className="pt-4 px-4 pb-8">
        <MobileHeader title={t.name} onBack={() => setPreview(null)} />
        <p className="text-xs text-text-muted mb-1">
          {[t.goal, t.level, scheduleSummary(t, preview.days.length), t.equipment]
            .filter(Boolean).join(' · ')}
        </p>
        {t.description ? <p className="text-sm text-text-muted mb-4">{t.description}</p> : null}

        {preview.days.map(d => (
          <div key={d.id} className="border border-border rounded-xl bg-surface p-3 mb-3">
            <p className="font-bold mb-2">{d.name}</p>
            <ul className="space-y-1">
              {d.exercises.map(e => (
                <li key={e.id} className="flex justify-between text-sm gap-3">
                  <span className="min-w-0 truncate">{e.name}</span>
                  <span className="text-text-muted whitespace-nowrap">
                    {[e.sets, e.reps && `x ${e.reps}`, e.weight].filter(Boolean).join(' ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <label className="block text-sm mb-2">
          <span className="block text-text-muted mb-1">Start date</span>
          <input type="date" className={field} value={startsOn} onChange={e => setStartsOn(e.target.value)} />
          <span className="block text-xs text-text-muted mt-1">
            Leave empty to start now. A future date keeps their current program until then.
          </span>
        </label>

        {error ? <p className="text-sm text-wcs-red mb-2">{error}</p> : null}

        <button
          onClick={assign} disabled={busy}
          className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
        >
          {busy ? 'Assigning…' : `Assign to ${member.first_name || 'member'}`}
        </button>
      </div>
    )
  }

  return (
    <div className="pt-4 px-4 pb-8">
      <MobileHeader title="Templates" onBack={onBack} />

      <input
        value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search templates"
        className={`${field} mb-2`}
      />
      <select className={`${field} mb-4`} value={goal} onChange={e => setGoal(e.target.value)}>
        <option value="">Any goal</option>
        {goals.map(g => <option key={g} value={g}>{g}</option>)}
      </select>

      {error ? <p className="text-sm text-wcs-red mb-2">{error}</p> : null}

      {templates.length === 0 ? (
        <p className="text-sm text-text-muted">No templates matched.</p>
      ) : (
        <ul className="space-y-2">
          {templates.map(t => (
            <li key={t.id}>
              <button
                onClick={async () => {
                  try { setPreview(await api(`/member-app/templates/${t.id}`)) }
                  catch (err) { setError(err.message) }
                }}
                className="w-full text-left border border-border rounded-xl px-4 py-3 bg-surface"
              >
                <span className="block font-semibold">{t.name}</span>
                <span className="block text-xs text-text-muted">
                  {[t.goal, t.level, scheduleSummary(t, t.workout_count)]
                    .filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
