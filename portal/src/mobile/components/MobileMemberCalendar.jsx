import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import MobileHeader from './MobileHeader'
import { at, shiftDay } from '../../lib/calendarGrid.js'

const nf = new Intl.NumberFormat('en-US')

const label = (key, today) => {
  if (key === today) return 'Today'
  if (key === shiftDay(today, -1)) return 'Yesterday'
  return at(key).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  })
}

// A member's last few weeks on the floor: newest first, so a coach standing
// with them opens on the days that are still worth talking about.
export default function MobileMemberCalendar({ member, onBack }) {
  const [state, setState] = useState(null)
  const [openDay, setOpenDay] = useState(null)
  const [weeks, setWeeks] = useState(2)
  const [error, setError] = useState(null)

  const load = useCallback(async (span) => {
    try {
      const r = await api(
        `/member-app/calendar?member_id=${encodeURIComponent(member.member_id)}` +
        `&club_number=${encodeURIComponent(member.club_number)}` +
        `&from=${span}`
      )
      setState(r)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [member])

  useEffect(() => {
    // The first load has no date to count back from, so it takes the default
    // window and widens once today is known.
    api(
      `/member-app/calendar?member_id=${encodeURIComponent(member.member_id)}` +
      `&club_number=${encodeURIComponent(member.club_number)}`
    ).then(setState).catch(err => setError(err.message))
  }, [member])

  useEffect(() => {
    if (state?.today && weeks > 2) load(shiftDay(state.today, -(weeks * 7 - 1)))
  }, [state?.today, weeks, load])

  if (!state) {
    return (
      <div className="pt-4 px-4">
        <MobileHeader title="Calendar" onBack={onBack} />
        {error ? <p className="text-sm text-wcs-red">{error}</p> : <p className="text-sm text-text-muted">Loading…</p>}
      </div>
    )
  }

  // Newest first, every day in the window so the quiet ones are visible too.
  const days = []
  for (let key = state.to; key >= state.from; key = shiftDay(key, -1)) days.push(key)

  return (
    <div className="pt-4 px-4 pb-8">
      <MobileHeader title="Calendar" onBack={onBack} />

      {error ? <p className="text-sm text-wcs-red mb-2">{error}</p> : null}

      <ul className="space-y-2">
        {days.map(key => {
          const day = state.days[key] || {}
          const open = openDay === key
          const kept = day.habits?.length ?? 0
          const quiet = !day.workouts?.length && !kept && !day.food
          return (
            <li key={key} className="border border-border rounded-xl bg-surface">
              <button
                className="w-full text-left px-4 py-3"
                onClick={() => setOpenDay(open ? null : key)}
              >
                <span className="flex justify-between items-baseline gap-3">
                  <span className={key === state.today ? 'font-bold text-wcs-red' : 'font-bold'}>
                    {label(key, state.today)}
                  </span>
                  {day.food ? (
                    <span className={day.food.over ? 'text-sm text-wcs-red' : 'text-sm text-green-700'}>
                      {nf.format(day.food.totals.calories)} cal
                      {day.food.difference == null
                        ? ''
                        : day.food.over
                          ? ` · ${nf.format(day.food.difference)} over`
                          : ` · ${nf.format(Math.abs(day.food.difference))} under`}
                    </span>
                  ) : state.nutritionEnabled ? (
                    <span className="text-sm text-text-muted">No food logged</span>
                  ) : null}
                </span>

                <span className="block text-xs text-text-muted mt-1">
                  {day.workouts?.length
                    ? day.workouts.map(w => w.name).join(', ')
                    : null}
                  {day.workouts?.length && kept ? ' · ' : null}
                  {/* Habits appear only when kept. */}
                  {kept ? `${kept} habit${kept === 1 ? '' : 's'}` : null}
                  {quiet ? 'Nothing recorded' : null}
                </span>
              </button>

              {open && (day.habits?.length || day.food) ? (
                <div className="px-4 pb-3 -mt-1 space-y-2">
                  {day.habits?.length ? (
                    <p className="text-sm">
                      <span className="text-text-muted">Habits: </span>
                      {day.habits.join(' · ')}
                    </p>
                  ) : null}
                  {day.food ? (
                    <div>
                      <p className="text-sm text-text-muted">
                        {nf.format(day.food.totals.protein_g)}g protein ·{' '}
                        {nf.format(day.food.totals.carbs_g)}g carbs ·{' '}
                        {nf.format(day.food.totals.fat_g)}g fat
                      </p>
                      <ul className="text-sm mt-1 space-y-0.5">
                        {day.food.meals.map((m, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span className="min-w-0 truncate">{m.name}</span>
                            <span className="text-text-muted whitespace-nowrap">
                              {nf.format(m.calories ?? 0)} cal
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {weeks < 8 ? (
        <button
          onClick={() => setWeeks(w => w + 2)}
          className="w-full py-3 mt-3 rounded-lg border border-border bg-surface font-semibold"
        >
          Two weeks further back
        </button>
      ) : null}
    </div>
  )
}
