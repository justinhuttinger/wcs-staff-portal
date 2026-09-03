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

// Setting someone's goals from the floor, and checking what they actually eat.
export default function MobileNutrition({ member, onBack }) {
  const [state, setState] = useState(null)
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
            <p className="font-bold mb-3">Today</p>
            <ul className="space-y-2">
              {FIELDS.map(f => (
                <li key={f.key} className="flex justify-between text-sm">
                  <span>{f.label}</span>
                  <span className="text-text-muted">
                    {show(state.totals[f.key], f.unit)}
                    {state.target?.[f.key] == null ? '' : ` of ${show(state.target[f.key], f.unit)}`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-text-muted mt-3">
              {state.meals.length} meal{state.meals.length === 1 ? '' : 's'} logged
            </p>
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
