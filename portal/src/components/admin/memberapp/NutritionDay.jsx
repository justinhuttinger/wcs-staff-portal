import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'

const nf = new Intl.NumberFormat('en-US')

const FIELDS = [
  { key: 'calories', label: 'Calories', unit: '' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
]

export const shiftDay = (dayKey, days) => {
  const d = new Date(`${dayKey}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const prettyDay = (dayKey, today) => {
  if (dayKey === today) return 'Today'
  if (dayKey === shiftDay(today, -1)) return 'Yesterday'
  return new Date(`${dayKey}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

const slotLabel = (m) => (m.name || (m.slot ? m.slot[0].toUpperCase() + m.slot.slice(1) : 'Meal'))

// What the member actually ate on one day. Averages tell a coach whether to
// have the conversation; this is what the conversation is about.
export default function NutritionDay({ member, today, initialDay }) {
  const [day, setDay] = useState(initialDay || today)
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { if (initialDay) setDay(initialDay) }, [initialDay])

  const load = useCallback(async (forDay) => {
    try {
      setState(await api(
        `/member-app/nutrition/day?member_id=${encodeURIComponent(member.member_id)}` +
        `&club_number=${encodeURIComponent(member.club_number)}&date=${forDay}`
      ))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [member])

  useEffect(() => { load(day) }, [load, day])

  const arrow = 'px-3 py-1.5 rounded-lg border border-border bg-surface disabled:opacity-40'

  return (
    <div className="border border-border rounded-lg bg-surface p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="font-semibold">{prettyDay(day, today)}</p>
        <div className="flex gap-2">
          <button className={arrow} onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day">
            &larr;
          </button>
          <button
            className={arrow} disabled={day >= today}
            onClick={() => setDay(shiftDay(day, 1))} aria-label="Next day"
          >
            &rarr;
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-wcs-red">{error}</p> : null}

      {!state ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {FIELDS.map(f => {
              const left = state.remaining?.[f.key]
              return (
                <div key={f.key}>
                  <p className="text-xs text-text-muted">{f.label}</p>
                  <p className="text-lg font-bold">
                    {nf.format(state.totals[f.key])}{f.unit}
                  </p>
                  <p className={left != null && left < 0 ? 'text-xs text-wcs-red' : 'text-xs text-text-muted'}>
                    {state.target?.[f.key] == null
                      ? 'no goal'
                      : left < 0
                        ? `${nf.format(Math.abs(left))}${f.unit} over`
                        : `${nf.format(left)}${f.unit} left`}
                  </p>
                </div>
              )
            })}
          </div>

          {state.meals.length === 0 ? (
            <p className="text-sm text-text-muted">Nothing logged this day.</p>
          ) : (
            <ul className="divide-y divide-border">
              {state.meals.map(m => (
                <li key={m.id} className="py-2 flex justify-between gap-4 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium">{slotLabel(m)}</span>
                    {m.created_by ? (
                      <span className="block text-xs text-text-muted">Logged by {m.created_by}</span>
                    ) : null}
                  </span>
                  <span className="text-text-muted whitespace-nowrap">
                    {nf.format(m.calories ?? 0)} cal
                    {m.protein_g == null ? '' : ` · ${nf.format(m.protein_g)}g P`}
                    {m.carbs_g == null ? '' : ` · ${nf.format(m.carbs_g)}g C`}
                    {m.fat_g == null ? '' : ` · ${nf.format(m.fat_g)}g F`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
