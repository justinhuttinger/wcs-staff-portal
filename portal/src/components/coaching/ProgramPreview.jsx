import { useEffect, useState } from 'react'
import { coachingApi } from './coachingApi'
import ExerciseThumb from './ExerciseThumb.jsx'
import { VolumeChips } from './ProgramBuilder.jsx'
import { SECTIONS, formatRest, titleCase } from './volume'

// Read-only Kahunas preview: day tabs, volume chips, then rows A, B, A1/A2
// with thumbnails. Used by the template library and a client's program list.
// `actions` renders buttons in the header (Assign, Edit, ...).
export default function ProgramPreview({ programId, onBack, backLabel = 'Back', actions }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [active, setActive] = useState(0)
  const [whole, setWhole] = useState(false)

  useEffect(() => {
    let live = true
    setData(null); setError(null); setActive(0)
    coachingApi.getProgram(programId)
      .then(r => { if (live) setData(r) })
      .catch(err => { if (live) setError(err.message) })
    return () => { live = false }
  }, [programId])

  const back = onBack ? (
    <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      {backLabel}
    </button>
  ) : null

  if (!data) {
    return (
      <div className="border border-border rounded-xl bg-surface p-5 space-y-3">
        {back}
        <p className={`text-sm ${error ? 'text-wcs-red' : 'text-text-muted'}`}>{error || 'Loading program…'}</p>
      </div>
    )
  }

  const { program, days } = data
  const day = days[active]
  const facts = [
    program.goal, program.level,
    program.days_per_week ? `${program.days_per_week} days/week` : null,
    program.equipment,
    `${days.length} day${days.length === 1 ? '' : 's'}`,
  ].filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-xl bg-surface p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {back}
          <div className="ml-auto flex flex-wrap gap-2">{actions ? actions(program, data) : null}</div>
        </div>
        <div>
          <h3 className="text-xl font-bold text-text-primary">{program.name}</h3>
          <p className="text-xs text-text-muted mt-0.5">{facts.join(' · ')}</p>
        </div>
        {program.tags?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {program.tags.map(t => <span key={t} className="px-2 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red text-xs font-semibold">{t}</span>)}
          </div>
        ) : null}
        {program.overview ? <p className="text-sm text-text-primary whitespace-pre-line">{program.overview}</p> : null}
      </div>

      {days.length === 0 ? (
        <div className="border border-border rounded-xl bg-surface p-6 text-sm text-text-muted text-center">No days in this program yet.</div>
      ) : (
        <>
          <div className="border border-border rounded-xl bg-surface p-2 flex gap-1 overflow-x-auto" role="tablist">
            {days.map((d, i) => (
              <button key={d.id} role="tab" aria-selected={i === active} onClick={() => setActive(i)}
                      className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold ${i === active ? 'bg-wcs-red text-white' : 'hover:bg-bg'}`}>
                {d.name}
              </button>
            ))}
          </div>

          <div className="border border-border rounded-xl bg-surface p-4 sm:p-5 space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Total volume sets</span>
                <button onClick={() => setWhole(w => !w)} className="text-xs text-wcs-red hover:underline">
                  {whole ? 'Show this day' : 'Show whole program'}
                </button>
              </div>
              <VolumeChips volume={whole ? data.volume : day.volume} empty="No working sets." />
            </div>

            {SECTIONS.map(s => {
              const items = day.items.filter(it => it.section === s.key)
              if (!items.length) return null
              return (
                <div key={s.key}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">{s.label}</div>
                  <ul className="divide-y divide-border border border-border rounded-lg">
                    {items.map((it, i) => {
                      const sup = it.superset_group && (items[i - 1]?.superset_group === it.superset_group || items[i + 1]?.superset_group === it.superset_group)
                      const parts = [
                        it.sets != null && it.reps ? `${it.sets} × ${it.reps}` : it.sets != null ? `${it.sets} sets` : it.reps,
                        it.weight,
                        it.rir ? `RIR ${it.rir}` : null,
                        it.rest_seconds != null ? `Rest ${formatRest(it.rest_seconds)}` : null,
                      ].filter(Boolean)
                      return (
                        <li key={it.id} className={`flex items-center gap-3 px-3 py-2 ${sup ? 'border-l-4 border-l-wcs-red' : ''}`}>
                          <span className={`inline-flex items-center justify-center min-w-[30px] h-7 px-1 rounded-md text-xs font-bold text-white ${sup ? 'bg-wcs-red' : 'bg-navy'}`}>{it.label}</span>
                          <ExerciseThumb exercise={it.exercise} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-text-primary truncate">{it.exercise?.name}</div>
                            <div className="text-xs text-text-muted">{parts.join(' · ')}{it.exercise?.primary_muscle ? ` · ${titleCase(it.exercise.primary_muscle)}` : ''}</div>
                            {it.notes ? <div className="text-xs text-text-primary italic mt-0.5">{it.notes}</div> : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
            {day.items.length === 0 ? <p className="text-sm text-text-muted">No exercises on this day.</p> : null}
            {day.instructions ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Instructions</div>
                <p className="text-sm whitespace-pre-line">{day.instructions}</p>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
