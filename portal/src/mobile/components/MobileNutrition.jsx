import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import MobileHeader from './MobileHeader'

const nf = new Intl.NumberFormat('en-US')
const field = 'w-full px-3 py-3 rounded-lg border border-border bg-bg text-base'

const FIELDS = [
  { key: 'calories', label: 'Calories', unit: '' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
]

const blank = { calories: '', protein_g: '', carbs_g: '', fat_g: '' }
const show = (v, unit) => (v == null ? '—' : `${nf.format(v)}${unit}`)

const shiftDay = (dayKey, days) => {
  const d = new Date(`${dayKey}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const prettyDay = (dayKey, today) => {
  if (dayKey === today) return 'Today'
  if (dayKey === shiftDay(today, -1)) return 'Yesterday'
  return new Date(`${dayKey}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

const mealLabel = (m) => (m.name || (m.slot ? m.slot[0].toUpperCase() + m.slot.slice(1) : 'Meal'))

// Setting someone's goals from the floor, and checking what they actually eat.
export default function MobileNutrition({ member, onBack }) {
  const [state, setState] = useState(null)
  const [day, setDay] = useState(null)
  const [dayState, setDayState] = useState(null)
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setState(await api(
        `/member-app/nutrition?member_id=${encodeURIComponent(member.member_id)}` +
        `&club_number=${encodeURIComponent(member.club_number)}`
      ))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [member])

  useEffect(() => { load() }, [load])

  // The day the coach is looking at, which starts as today and walks back.
  useEffect(() => { if (state?.today && !day) setDay(state.today) }, [state, day])

  const loadDay = useCallback(async () => {
    if (!day) return  // waits one tick for today to arrive from the summary
    try {
      setDayState(await api(
        `/member-app/nutrition/day?member_id=${encodeURIComponent(member.member_id)}` +
        `&club_number=${encodeURIComponent(member.club_number)}&date=${day}`
      ))
    } catch (err) {
      setError(err.message)
    }
  }, [member, day])

  useEffect(() => { loadDay() }, [loadDay])

  async function run(work) {
    setBusy(true); setError(null)
    try {
      await work()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const base = { member_id: member.member_id, club_number: member.club_number }

  if (!state) {
    return (
      <div className="pt-4 px-4">
        <MobileHeader title="Nutrition" onBack={onBack} />
        {error ? <p className="text-sm text-wcs-red">{error}</p> : <p className="text-sm text-text-muted">Loading…</p>}
      </div>
    )
  }

  // Falls back to today for the one render before the effect sets it.
  const viewDay = day || state.today

  return (
    <div className="pt-4 px-4 pb-8">
      <MobileHeader title="Nutrition" onBack={onBack} />

      {error ? <p className="text-sm text-wcs-red mb-2">{error}</p> : null}

      <button
        onClick={() => run(() => api('/member-app/nutrition/enabled', {
          method: 'PUT', body: JSON.stringify({ ...base, enabled: !state.enabled }),
        }))}
        disabled={busy}
        className={[
          'w-full py-3 mb-4 rounded-lg font-semibold border disabled:opacity-40',
          state.enabled
            ? 'bg-surface text-text-primary border-border'
            : 'bg-wcs-red text-white border-wcs-red',
        ].join(' ')}
      >
        {state.enabled ? 'Turn tracking off' : 'Turn tracking on'}
      </button>

      {!state.enabled ? (
        <p className="text-sm text-text-muted">
          Off. Nothing about food shows up in their app.
        </p>
      ) : (
        <>
          <div className="border border-border rounded-xl bg-surface p-4 mb-3">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="font-bold">{prettyDay(viewDay, state.today)}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDay(shiftDay(viewDay, -1))} aria-label="Previous day"
                  className="px-3 py-1.5 rounded-lg border border-border"
                >
                  &larr;
                </button>
                <button
                  onClick={() => setDay(shiftDay(viewDay, 1))} aria-label="Next day"
                  disabled={viewDay >= state.today}
                  className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40"
                >
                  &rarr;
                </button>
              </div>
            </div>

            <ul className="space-y-2">
              {FIELDS.map(f => (
                <li key={f.key} className="flex justify-between text-sm">
                  <span>{f.label}</span>
                  <span className={dayState?.remaining?.[f.key] < 0 ? 'text-wcs-red' : 'text-text-muted'}>
                    {show(dayState?.totals?.[f.key] ?? null, f.unit)}
                    {dayState?.target?.[f.key] == null ? '' : ` of ${show(dayState.target[f.key], f.unit)}`}
                  </span>
                </li>
              ))}
            </ul>

            {/* What they actually ate, which is what the conversation is about. */}
            <p className="text-xs text-text-muted mt-4 mb-1">Meals</p>
            {!dayState ? (
              <p className="text-sm text-text-muted">Loading…</p>
            ) : dayState.meals.length === 0 ? (
              <p className="text-sm text-text-muted">Nothing logged this day.</p>
            ) : (
              <ul className="divide-y divide-border">
                {dayState.meals.map(m => (
                  <li key={m.id} className="py-2">
                    <p className="text-sm font-medium">{mealLabel(m)}</p>
                    <p className="text-xs text-text-muted">
                      {nf.format(m.calories ?? 0)} cal
                      {m.protein_g == null ? '' : ` · ${nf.format(m.protein_g)}g P`}
                      {m.carbs_g == null ? '' : ` · ${nf.format(m.carbs_g)}g C`}
                      {m.fat_g == null ? '' : ` · ${nf.format(m.fat_g)}g F`}
                      {m.created_by ? ` · by ${m.created_by}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border border-border rounded-xl bg-surface p-4 mb-4">
            <p className="font-bold">Last 7 days</p>
            <p className="text-xs text-text-muted mb-3">
              Averaged over the {state.averages[7].days_logged} day
              {state.averages[7].days_logged === 1 ? '' : 's'} they logged.
            </p>
            <ul className="space-y-2">
              {FIELDS.map(f => (
                <li key={f.key} className="flex justify-between text-sm">
                  <span>{f.label}</span>
                  <span className="text-text-muted">
                    {show(state.averages[7][f.key], f.unit)}
                    {state.target?.[f.key] == null ? '' : ` vs ${show(state.target[f.key], f.unit)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <form
            onSubmit={e => {
              e.preventDefault()
              run(async () => {
                await api('/member-app/nutrition/targets', {
                  method: 'POST', body: JSON.stringify({ ...base, ...form }),
                })
                setForm(blank)
              })
            }}
          >
            <p className="font-bold mb-1">Set goals</p>
            <p className="text-xs text-text-muted mb-3">
              Leave one empty for no goal. Past days keep the goals they had.
            </p>
            {FIELDS.map(f => (
              <label key={f.key} className="block text-sm mb-2">
                <span className="block text-text-muted mb-1">{f.label}</span>
                <input
                  className={field} inputMode="numeric" value={form[f.key]}
                  placeholder={state.target?.[f.key] == null ? '' : String(state.target[f.key])}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                />
              </label>
            ))}
            <button
              type="submit" disabled={busy}
              className="w-full py-3 mt-2 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
            >
              Save goals
            </button>
          </form>
        </>
      )}
    </div>
  )
}
