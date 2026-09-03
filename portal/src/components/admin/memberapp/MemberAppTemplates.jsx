import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'

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


// Browse the template library and drop one on a member, optionally dated so it
// takes over later.
export default function MemberAppTemplates({ member, onAssigned, onCancel }) {
  const [q, setQ] = useState('')
  const [goal, setGoal] = useState('')
  const [level, setLevel] = useState('')
  const [templates, setTemplates] = useState([])
  const [goals, setGoals] = useState([])
  const [levels, setLevels] = useState([])
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
      if (level) params.set('level', level)
      const r = await api(`/member-app/templates?${params}`)
      setTemplates(r.templates || [])
      // Only seed the dropdowns from an unfiltered load, or they shrink to
      // whatever the current filter happens to contain.
      if (!goal && !level) { setGoals(r.goals || []); setLevels(r.levels || []) }
    } catch (err) {
      setError(err.message)
    }
  }, [q, goal, level])

  useEffect(() => {
    const id = setTimeout(load, 200) // debounce the search box
    return () => clearTimeout(id)
  }, [load])

  async function assign(template) {
    setBusy(true); setError(null)
    try {
      await api(`/member-app/templates/${template.id}/assign`, {
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

  const field = 'px-3 py-2 rounded-lg border border-border bg-surface text-text-primary'

  if (preview) {
    return (
      <div className="space-y-4">
        <button onClick={() => setPreview(null)} className="text-sm text-text-muted hover:text-text-primary">
          &larr; All templates
        </button>
        <div>
          <h3 className="text-lg font-bold">{preview.template.name}</h3>
          <p className="text-xs text-text-muted">
            {[preview.template.goal, preview.template.level,
              scheduleSummary(preview.template, preview.days.length),
              preview.template.equipment].filter(Boolean).join(' · ')}
          </p>
          {preview.template.description ? (
            <p className="text-sm text-text-muted mt-2">{preview.template.description}</p>
          ) : null}
        </div>

        {preview.days.map(d => (
          <div key={d.id} className="border border-border rounded-lg bg-surface p-4">
            <p className="font-semibold mb-2">{d.name}</p>
            <ul className="space-y-1">
              {d.exercises.map(e => (
                <li key={e.id} className="flex justify-between text-sm">
                  <span>{e.name}</span>
                  <span className="text-text-muted">
                    {[e.sets, e.reps && `x ${e.reps}`, e.weight,
                      e.rest_seconds && `${e.rest_seconds}s`].filter(Boolean).join(' ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="border border-border rounded-lg bg-surface p-4 space-y-3">
          <label className="block text-sm">
            <span className="block text-text-muted mb-1">Start date</span>
            <input type="date" className={field} value={startsOn} onChange={e => setStartsOn(e.target.value)} />
            <span className="block text-xs text-text-muted mt-1">
              Leave empty to start now. A future date keeps their current program until then.
            </span>
          </label>
          {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
          <button
            onClick={() => assign(preview.template)} disabled={busy}
            className="px-4 py-2 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
          >
            {busy ? 'Assigning…' : `Assign to ${member.first_name || 'member'}`}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button onClick={onCancel} className="text-sm text-text-muted hover:text-text-primary">
        &larr; Back to programs
      </button>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search templates"
          className={`${field} w-full`}
        />
        <select className={field} value={goal} onChange={e => setGoal(e.target.value)}>
          <option value="">Any goal</option>
          {goals.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className={field} value={level} onChange={e => setLevel(e.target.value)}>
          <option value="">Any level</option>
          {levels.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {error ? <p className="text-sm text-wcs-red">{error}</p> : null}

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
                className="w-full text-left border border-border rounded-lg px-4 py-3 bg-surface hover:border-text-muted transition-colors"
              >
                <span className="block font-semibold">{t.name}</span>
                <span className="block text-xs text-text-muted">
                  {[t.goal, t.level, scheduleSummary(t, t.workout_count), t.equipment]
                    .filter(Boolean).join(' · ')}
                </span>
                {t.description ? (
                  <span className="block text-sm text-text-muted mt-1">{t.description}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
