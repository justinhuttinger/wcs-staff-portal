import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../../lib/api'
import {
  DOW, gridFor, longDay, monthKey, monthName, monthRange, stepMonth,
} from '../../../lib/calendarGrid.js'

const nf = new Intl.NumberFormat('en-US')

// A month of a member's days: workouts, the habits they kept, and whether food
// landed over or under. Habits are shown only when kept - the grid is not a
// place to point at the days someone missed.
export default function MemberAppCalendar({ member }) {
  const [month, setMonth] = useState(null)
  const [state, setState] = useState(null)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async (forMonth) => {
    try {
      const { from, to } = monthRange(forMonth)
      const r = await api(
        `/member-app/calendar?member_id=${encodeURIComponent(member.member_id)}` +
        `&club_number=${encodeURIComponent(member.club_number)}&from=${from}&to=${to}`
      )
      setState(r)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [member])

  // Start on the month containing today, which the API tells us.
  useEffect(() => {
    api(
      `/member-app/calendar?member_id=${encodeURIComponent(member.member_id)}` +
      `&club_number=${encodeURIComponent(member.club_number)}`
    )
      .then(r => { setState(r); setMonth(monthKey(r.today)) })
      .catch(err => setError(err.message))
  }, [member])

  useEffect(() => { if (month) load(month) }, [month, load])

  const cells = useMemo(() => (month ? gridFor(month) : []), [month])

  if (error) return <p className="text-sm text-wcs-red">{error}</p>
  if (!state || !month) return <p className="text-sm text-text-muted">Loading…</p>

  const step = (n) => {
    setMonth(stepMonth(month, n))
    setSelected(null)
  }

  const open = selected ? (state.days[selected] || {}) : null
  const nav = 'px-3 py-1.5 rounded-lg border border-border bg-surface hover:border-text-muted disabled:opacity-40'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{monthName(month)}</p>
        <div className="flex gap-2">
          <button className={nav} onClick={() => step(-1)} aria-label="Previous month">&larr;</button>
          <button
            className={nav} onClick={() => step(1)} aria-label="Next month"
            disabled={month >= monthKey(state.today)}
          >
            &rarr;
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border border border-border rounded-lg overflow-hidden">
        {DOW.map(d => (
          <div key={d} className="bg-surface px-2 py-1 text-xs text-text-muted font-medium text-center">
            {d}
          </div>
        ))}

        {cells.map(({ key, inMonth }) => {
          const day = state.days[key] || {}
          const kept = day.habits?.length ?? 0
          const isToday = key === state.today
          return (
            <button
              key={key}
              onClick={() => setSelected(key)}
              className={[
                'bg-surface min-h-[74px] p-2 text-left align-top transition-colors',
                inMonth ? '' : 'opacity-35',
                selected === key ? 'ring-2 ring-inset ring-wcs-red' : 'hover:bg-bg',
              ].join(' ')}
            >
              <span className={isToday ? 'text-xs font-bold text-wcs-red' : 'text-xs text-text-muted'}>
                {Number(key.slice(8))}
              </span>

              <span className="block mt-1 space-y-0.5">
                {day.workouts?.length ? (
                  <span className="block text-[11px] font-semibold truncate">
                    {day.workouts.length > 1
                      ? `${day.workouts.length} workouts`
                      : day.workouts[0].name}
                  </span>
                ) : null}

                {/* Only ever what they kept. */}
                {kept ? (
                  <span className="block text-[11px] text-text-muted">
                    {kept} habit{kept === 1 ? '' : 's'}
                  </span>
                ) : null}

                {day.food ? (
                  <span
                    className={day.food.over ? 'block text-[11px] text-wcs-red' : 'block text-[11px] text-green-700'}
                  >
                    {nf.format(day.food.totals.calories)}
                    {day.food.difference == null
                      ? ''
                      : day.food.over ? ' ▲' : ' ▼'}
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>

      {selected ? (
        <div className="border border-border rounded-lg bg-surface p-4 space-y-3">
          <p className="font-semibold">{longDay(selected)}</p>

          {open.workouts?.length ? (
            <div>
              <p className="text-xs text-text-muted mb-1">Workouts</p>
              <ul className="text-sm space-y-1">
                {open.workouts.map(w => <li key={w.id}>{w.name}</li>)}
              </ul>
            </div>
          ) : null}

          {open.habits?.length ? (
            <div>
              <p className="text-xs text-text-muted mb-1">Habits kept</p>
              <p className="text-sm">{open.habits.join(' · ')}</p>
            </div>
          ) : null}

          {state.nutritionEnabled ? (
            <div>
              <p className="text-xs text-text-muted mb-1">Food</p>
              {!open.food ? (
                <p className="text-sm text-text-muted">Nothing logged.</p>
              ) : (
                <>
                  <p className={open.food.over ? 'text-sm text-wcs-red' : 'text-sm'}>
                    {nf.format(open.food.totals.calories)} cal
                    {open.food.difference == null
                      ? ''
                      : open.food.over
                        ? ` · ${nf.format(open.food.difference)} over`
                        : ` · ${nf.format(Math.abs(open.food.difference))} under`}
                    {' · '}{nf.format(open.food.totals.protein_g)}g protein
                  </p>
                  <ul className="text-sm text-text-muted mt-1 space-y-0.5">
                    {open.food.meals.map((m, i) => (
                      <li key={i} className="flex justify-between gap-4">
                        <span>{m.name}</span>
                        <span className="whitespace-nowrap">{nf.format(m.calories ?? 0)} cal</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}

          {!open.workouts?.length && !open.habits?.length && !state.nutritionEnabled ? (
            <p className="text-sm text-text-muted">Nothing recorded this day.</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-text-muted">Pick a day to see what is behind it.</p>
      )}
    </div>
  )
}
