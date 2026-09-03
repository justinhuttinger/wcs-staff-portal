import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import NutritionDay from './NutritionDay.jsx'

const nf = new Intl.NumberFormat('en-US')

const FIELDS = [
  { key: 'calories', label: 'Calories', unit: '' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
]

const field = 'px-3 py-2 rounded-lg border border-border bg-surface text-text-primary w-full'
const blank = { calories: '', protein_g: '', carbs_g: '', fat_g: '' }

const show = (v, unit) => (v == null ? '—' : `${nf.format(v)}${unit}`)

// Diet tracking for one member: turn it on, set goals, and read the number that
// actually starts a conversation - what they average against what was asked.
export default function MemberAppNutrition({ member }) {
  const [state, setState] = useState(null)
  const [form, setForm] = useState(blank)
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [openDay, setOpenDay] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await api(
        `/member-app/nutrition?member_id=${encodeURIComponent(member.member_id)}` +
        `&club_number=${encodeURIComponent(member.club_number)}`
      )
      setState(r)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [member])

  useEffect(() => { load() }, [load])

  async function run(work, done) {
    setBusy(true); setError(null); setNotice(null)
    try {
      await work()
      await load()
      if (done) setNotice(done)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const base = { member_id: member.member_id, club_number: member.club_number }

  const toggle = (enabled) => run(() => api('/member-app/nutrition/enabled', {
    method: 'PUT', body: JSON.stringify({ ...base, enabled }),
  }), enabled ? 'Tracking is on for them.' : 'Tracking is off.')

  function saveTarget(event) {
    event.preventDefault()
    run(async () => {
      await api('/member-app/nutrition/targets', {
        method: 'POST',
        body: JSON.stringify({ ...base, ...form, effective_from: effectiveFrom || undefined }),
      })
      setForm(blank)
      setEffectiveFrom('')
    }, 'Goals set.')
  }

  if (!state) {
    return error
      ? <p className="text-sm text-wcs-red">{error}</p>
      : <p className="text-sm text-text-muted">Loading…</p>
  }

  const { target, totals, remaining, averages } = state

  return (
    <div className="space-y-5">
      {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
      {notice ? <p className="text-sm text-green-700">{notice}</p> : null}

      <div className="border border-border rounded-lg bg-surface p-4 flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold">Diet tracking</p>
          <p className="text-xs text-text-muted">
            {state.enabled
              ? 'They can log meals and see their goals in the app.'
              : 'Off. Nothing about food shows up in their app.'}
          </p>
        </div>
        <button
          onClick={() => toggle(!state.enabled)} disabled={busy}
          className={[
            'px-4 py-2 rounded-lg text-sm font-semibold border disabled:opacity-40',
            state.enabled
              ? 'bg-surface text-text-primary border-border hover:border-text-muted'
              : 'bg-wcs-red text-white border-wcs-red',
          ].join(' ')}
        >
          {state.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      {state.enabled ? (
        <>
          <NutritionDay member={member} today={state.today} initialDay={openDay} />

          <div className="border border-border rounded-lg bg-surface p-4">
            <p className="font-semibold mb-1">Averages</p>
            {/* Over days they actually logged: counting untouched days as zero
                would read as starvation for someone who logged twice. */}
            <p className="text-xs text-text-muted mb-3">Across the days they logged.</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-muted">
                  <th className="pb-2 font-medium">Window</th>
                  {FIELDS.map(f => <th key={f.key} className="pb-2 font-medium">{f.label}</th>)}
                  <th className="pb-2 font-medium">Days</th>
                </tr>
              </thead>
              <tbody>
                {[7, 30].map(w => (
                  <tr key={w} className="border-t border-border">
                    <td className="py-2">{w} days</td>
                    {FIELDS.map(f => (
                      <td key={f.key} className="py-2">{show(averages[w][f.key], f.unit)}</td>
                    ))}
                    <td className="py-2 text-text-muted">{averages[w].days_logged}</td>
                  </tr>
                ))}
                {target ? (
                  <tr className="border-t border-border text-text-muted">
                    <td className="py-2">Goal</td>
                    {FIELDS.map(f => (
                      <td key={f.key} className="py-2">{show(target[f.key], f.unit)}</td>
                    ))}
                    <td />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <form onSubmit={saveTarget} className="border border-border rounded-lg bg-surface p-4 space-y-3">
            <div>
              <p className="font-semibold">Set goals</p>
              <p className="text-xs text-text-muted">
                Leave a box empty to set no goal for it. Saving keeps the old goals on
                the days they applied to, so past weeks still read correctly.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {FIELDS.map(f => (
                <label key={f.key} className="text-sm">
                  <span className="block text-text-muted mb-1">{f.label}</span>
                  <input
                    className={field} inputMode="numeric" value={form[f.key]}
                    placeholder={target?.[f.key] == null ? '' : String(target[f.key])}
                    onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <label className="text-sm block">
              <span className="block text-text-muted mb-1">Starts</span>
              <input
                type="date" className={field} value={effectiveFrom}
                onChange={e => setEffectiveFrom(e.target.value)}
              />
              <span className="block text-xs text-text-muted mt-1">
                Empty means today.
              </span>
            </label>
            <button
              type="submit" disabled={busy}
              className="px-4 py-2 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-40"
            >
              Save goals
            </button>
          </form>

          {state.targets.length ? (
            <div className="border border-border rounded-lg bg-surface p-4">
              <p className="font-semibold mb-2">Goal history</p>
              <ul className="text-sm space-y-1">
                {state.targets.map(t => (
                  <li key={t.id} className="flex justify-between gap-4 text-text-muted">
                    <span>
                      From {t.effective_from} · {show(t.calories, '')} cal ·{' '}
                      {show(t.protein_g, 'g')} P / {show(t.carbs_g, 'g')} C / {show(t.fat_g, 'g')} F
                    </span>
                    <span className="whitespace-nowrap">{t.set_by || 'they set it'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {state.days.length ? (
            <div className="border border-border rounded-lg bg-surface p-4">
              <p className="font-semibold mb-2">Recent days</p>
              <ul className="text-sm space-y-1">
                {state.days.map(d => (
                  <li key={d.day}>
                    {/* Opens that day above rather than being a dead list. */}
                    <button
                      onClick={() => setOpenDay(d.day)}
                      className="w-full flex justify-between gap-4 text-left py-1 hover:text-wcs-red transition-colors"
                    >
                      <span>{d.day}</span>
                      <span className="text-text-muted">
                        {nf.format(d.totals.calories)} cal · {nf.format(d.totals.protein_g)}g protein
                        {d.target?.calories
                          ? ` · goal ${nf.format(d.target.calories)}`
                          : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
