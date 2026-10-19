import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { coachingApi } from './coachingApi'
import ExercisePicker from './ExercisePicker.jsx'
import ExerciseThumb from './ExerciseThumb.jsx'
import {
  SECTIONS, itemLabels, volumeByMuscle, mergeVolume, volumeChips, titleCase, formatSets, formatRest, parseRest,
} from './volume'

// The Kahunas-style program builder: title, tags, overview, day tabs, and per
// day three sections of exercise rows (A, B, A1/A2 for supersets) with sets,
// reps, weight, RIR, rest and notes, plus live volume per muscle.
//
// Saves send the whole tree WITH row ids; the server diffs it, so an edit
// never detaches a client's logged sets from the rows they were logged on.

const SECTION_ORDER = Object.fromEntries(SECTIONS.map((s, i) => [s.key, i]))
const GOALS = ['Strength', 'Hypertrophy', 'Fat loss', 'General fitness', 'Conditioning', 'Athletic performance', 'Healthy aging', 'Rehabilitation']
const LEVELS = ['Beginner', 'Intermediate', 'Advanced']
const EQUIPMENT = ['Full gym', 'Dumbbells only', 'Barbell', 'Kettlebells', 'Bodyweight']

let seq = 0
const uid = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`
// superset_group is at most 4 characters server-side.
const groupId = () => Math.random().toString(36).slice(2, 6)

// Rows stay grouped warm up -> workout -> cool down so positions save in the
// order the coach sees them.
const ordered = (items) => items
  .map((it, i) => [it, i])
  .sort((a, b) => (SECTION_ORDER[a[0].section] - SECTION_ORDER[b[0].section]) || (a[1] - b[1]))
  .map(([it]) => it)

// A "superset" of one is just an exercise: drop orphaned groups.
function tidySupersets(items) {
  const out = items.map(it => ({ ...it }))
  let i = 0
  while (i < out.length) {
    const g = out[i].superset_group
    let j = i + 1
    if (g) while (j < out.length && out[j].section === out[i].section && out[j].superset_group === g) j++
    if (g && j - i === 1) out[i].superset_group = null
    i = j
  }
  return out
}

const blankDay = (n) => ({ key: uid(), name: `Day ${n}`, instructions: '', items: [] })

function fromServer(res, kindFallback) {
  const p = res.program
  return {
    id: p.id,
    kind: p.kind || kindFallback,
    owner_staff_id: p.owner_staff_id ?? null,
    member_id: p.member_id, club_number: p.club_number,
    name: p.name || '',
    overview: p.overview || '',
    tags: p.tags || [],
    goal: p.goal || '', level: p.level || '',
    days_per_week: p.days_per_week ?? '', equipment: p.equipment || '',
    days: (res.days || []).map(d => ({
      key: d.id, id: d.id, name: d.name, instructions: d.instructions || '',
      items: ordered((d.items || []).map(it => ({
        key: it.id, id: it.id, section: it.section, exercise_id: it.exercise_id, exercise: it.exercise,
        sets: it.sets ?? '', reps: it.reps || '', weight: it.weight || '', rir: it.rir || '',
        rest_seconds: it.rest_seconds ?? null, notes: it.notes || '', superset_group: it.superset_group || null,
      }))),
    })),
  }
}

function toBody(d) {
  return {
    name: d.name,
    overview: d.overview,
    tags: d.tags,
    goal: d.goal, level: d.level, equipment: d.equipment,
    days_per_week: d.days_per_week === '' ? null : Number(d.days_per_week),
    days: d.days.map(day => ({
      id: day.id, name: day.name, instructions: day.instructions,
      items: ordered(day.items).map(it => ({
        id: it.id, section: it.section, exercise_id: it.exercise_id,
        sets: it.sets === '' ? null : Number(it.sets), reps: it.reps, weight: it.weight, rir: it.rir,
        rest_seconds: it.rest_seconds, notes: it.notes, superset_group: it.superset_group,
      })),
    })),
  }
}

/**
 * @param {string} [programId]   open an existing program
 * @param {object} [create]      { kind, member?, publish?, name? } for a new one
 * @param {string} [clientName]  shown in the header on a client program
 * @param {(changed:boolean)=>void} onClose
 */
export default function ProgramBuilder({ programId, create, clientName, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => (programId ? null : {
    kind: create?.kind || 'template',
    name: create?.name || '', overview: '', tags: [],
    goal: '', level: '', days_per_week: '', equipment: '',
    days: [blankDay(1)],
  }))
  const [active, setActive] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedOnce, setSavedOnce] = useState(false)
  const [flash, setFlash] = useState(null)
  const [error, setError] = useState(null)
  const [picker, setPicker] = useState(null) // section key
  const [showProgramVolume, setShowProgramVolume] = useState(false)
  const titleRef = useRef(null)

  useEffect(() => {
    if (!programId) { titleRef.current?.focus(); return }
    let live = true
    coachingApi.getProgram(programId)
      .then(r => { if (live) setDraft(fromServer(r)) })
      .catch(err => { if (live) setError(err.message) })
    return () => { live = false }
  }, [programId])

  // Every edit goes through here so "unsaved changes" is always right.
  const change = useCallback((fn) => {
    setDraft(d => fn(d))
    setDirty(true)
  }, [])

  const setField = (k, v) => change(d => ({ ...d, [k]: v }))
  const setDay = (i, patch) => change(d => ({ ...d, days: d.days.map((day, di) => (di === i ? { ...day, ...patch } : day)) }))
  const setItems = (i, fn) => change(d => ({
    ...d,
    days: d.days.map((day, di) => (di === i ? { ...day, items: tidySupersets(ordered(fn(day.items))) } : day)),
  }))

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = useCallback(async (close) => {
    if (!draft || saving) return
    if (!draft.name.trim()) { setError('Give the program a title first.'); titleRef.current?.focus(); return }
    setSaving(true); setError(null)
    try {
      const body = toBody(draft)
      let res
      if (draft.id) {
        res = await coachingApi.saveProgram(draft.id, body)
      } else {
        const member = create?.member
        res = await coachingApi.createProgram({
          ...body,
          kind: draft.kind,
          publish: Boolean(create?.publish),
          ...(draft.kind === 'client' && member ? {
            member_id: member.member_id, club_number: member.club_number,
            coach_staff_id: member.coach_staff_id || null,
          } : {}),
        })
      }
      setSavedOnce(true)
      setDirty(false)
      onSaved?.(res.program)
      if (close) { onClose(true); return }
      // Take the server's copy so new rows carry their ids into the next save.
      const fresh = fromServer(res, draft.kind)
      setDraft(fresh)
      setActive(a => Math.min(a, Math.max(0, fresh.days.length - 1)))
      setFlash('Saved')
      setTimeout(() => setFlash(null), 1800)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [draft, saving, create, onClose, onSaved])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  function close() {
    if (dirty && !window.confirm('You have unsaved changes. Close without saving?')) return
    onClose(savedOnce)
  }

  const day = draft?.days[active]
  const dayVolume = useMemo(() => volumeByMuscle(day?.items), [day])
  const programVolume = useMemo(
    () => mergeVolume((draft?.days || []).map(d => volumeByMuscle(d.items))),
    [draft],
  )

  if (!draft) {
    return (
      <div className="border border-border rounded-xl bg-surface p-6 text-sm text-text-muted">
        {error ? <span className="text-wcs-red">{error}</span> : 'Loading program…'}
        <div><button onClick={() => onClose(false)} className="mt-3 text-text-primary underline">Back</button></div>
      </div>
    )
  }

  // ---- days ----------------------------------------------------------------
  const addDay = () => {
    change(d => ({ ...d, days: [...d.days, blankDay(d.days.length + 1)] }))
    setActive(draft.days.length)
  }
  const duplicateDay = (i) => {
    const src = draft.days[i]
    const copy = {
      key: uid(), name: `${src.name} (copy)`.slice(0, 80), instructions: src.instructions,
      items: src.items.map(({ id, key, ...it }) => ({ ...it, key: uid() })),
    }
    change(d => ({ ...d, days: [...d.days.slice(0, i + 1), copy, ...d.days.slice(i + 1)] }))
    setActive(i + 1)
  }
  const deleteDay = (i) => {
    const target = draft.days[i]
    if (target.items.length && !window.confirm(`Delete "${target.name}" and its ${target.items.length} exercise${target.items.length === 1 ? '' : 's'}?`)) return
    change(d => ({ ...d, days: d.days.filter((_, di) => di !== i) }))
    setActive(a => Math.max(0, Math.min(a, draft.days.length - 2)))
  }
  const moveDay = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= draft.days.length) return
    change(d => {
      const days = [...d.days]
      ;[days[i], days[j]] = [days[j], days[i]]
      return { ...d, days }
    })
    setActive(j)
  }

  // ---- items ---------------------------------------------------------------
  const addExercises = (section, exercises) => {
    const isWork = section === 'workout'
    setItems(active, items => [
      ...items,
      ...exercises.map(ex => ({
        key: uid(), section, exercise_id: ex.id, exercise: ex,
        sets: isWork ? 3 : 1, reps: isWork ? '8-12' : '', weight: '', rir: '',
        rest_seconds: isWork ? 90 : null, notes: '', superset_group: null,
      })),
    ])
    setPicker(null)
  }
  const patchItem = (key, patch) => setItems(active, items => items.map(it => (it.key === key ? { ...it, ...patch } : it)))
  const removeItem = (key) => setItems(active, items => items.filter(it => it.key !== key))
  const moveItem = (key, section, index) => setItems(active, items => {
    const moving = items.find(it => it.key === key)
    if (!moving) return items
    const rest = items.filter(it => it.key !== key)
    const inSection = rest.filter(it => it.section === section)
    const before = inSection[index]
    const updated = { ...moving, section, superset_group: moving.section === section ? moving.superset_group : null }
    if (!before) {
      const lastIdx = rest.map(it => it.section).lastIndexOf(section)
      const at = lastIdx === -1 ? rest.length : lastIdx + 1
      return [...rest.slice(0, at), updated, ...rest.slice(at)]
    }
    const at = rest.indexOf(before)
    return [...rest.slice(0, at), updated, ...rest.slice(at)]
  })
  const nudge = (key, dir) => {
    const it = day.items.find(x => x.key === key)
    const list = day.items.filter(x => x.section === it.section)
    const idx = list.indexOf(it)
    const to = idx + dir
    if (to < 0 || to >= list.length) return
    // moveItem's index counts the section without the moving row, which is
    // exactly `to` in both directions.
    moveItem(key, it.section, to)
  }
  // Link this row with the next one in its section (or unlink them).
  const toggleSuperset = (key) => setItems(active, items => {
    const i = items.findIndex(it => it.key === key)
    const next = items[i + 1]
    if (!next || next.section !== items[i].section) return items
    const a = items[i]
    const out = items.map(it => ({ ...it }))
    if (a.superset_group && a.superset_group === next.superset_group) {
      // Split the run after this row.
      const g = groupId()
      for (let k = i + 1; k < out.length && out[k].superset_group === a.superset_group && out[k].section === a.section; k++) {
        out[k].superset_group = g
      }
      return out
    }
    const g = a.superset_group || next.superset_group || groupId()
    const old = next.superset_group
    out[i].superset_group = g
    out[i + 1].superset_group = g
    if (old && old !== g) {
      for (let k = i + 2; k < out.length && out[k].superset_group === old && out[k].section === a.section; k++) out[k].superset_group = g
    }
    return out
  })

  const labels = itemLabels(day?.items || [])
  const labelFor = (key) => labels[day.items.findIndex(it => it.key === key)]
  const isTemplate = draft.kind === 'template'
  const field = 'w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red/30 focus:border-wcs-red'

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="border border-border rounded-xl bg-surface p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={close} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back
          </button>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${isTemplate ? 'bg-navy text-white' : 'bg-wcs-red/10 text-wcs-red'}`}>
            {isTemplate
              ? ((draft.id ? draft.owner_staff_id == null : create?.publish) ? 'WCS template' : 'My template')
              : `Client program${clientName ? ` · ${clientName}` : ''}`}
          </span>
          <span className="text-xs text-text-muted" aria-live="polite">
            {flash ? <span className="text-green-700 font-semibold">{flash}</span> : dirty ? 'Unsaved changes' : draft.id ? 'All changes saved' : 'New, not saved yet'}
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => save(false)} disabled={saving}
                    className="px-4 py-2 rounded-lg border border-border bg-surface text-sm font-semibold hover:border-text-muted disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => save(true)} disabled={saving}
                    className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red-hover disabled:opacity-50">
              Save &amp; close
            </button>
          </div>
        </div>

        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}

        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Program title</span>
          <input
            ref={titleRef} value={draft.name} maxLength={120}
            onChange={e => setField('name', e.target.value)}
            placeholder="e.g. Upper / Lower, 4 days"
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-surface text-lg font-bold text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30 focus:border-wcs-red"
          />
        </label>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Tags</span>
            <TagInput tags={draft.tags} onChange={tags => setField('tags', tags)} />
          </div>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Program overview</span>
            <textarea
              value={draft.overview} onChange={e => setField('overview', e.target.value)} rows={2} maxLength={2000}
              placeholder="What this program is for and how to run it"
              className={field}
            />
          </label>
        </div>

        {isTemplate ? (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm">
              <span className="block text-text-muted mb-1">Goal</span>
              <input className={field} list="coaching-goals" value={draft.goal} onChange={e => setField('goal', e.target.value)} />
              <datalist id="coaching-goals">{GOALS.map(g => <option key={g} value={g} />)}</datalist>
            </label>
            <label className="block text-sm">
              <span className="block text-text-muted mb-1">Level</span>
              <select className={field} value={draft.level} onChange={e => setField('level', e.target.value)}>
                <option value="">Any level</option>
                {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                {draft.level && !LEVELS.includes(draft.level) ? <option value={draft.level}>{draft.level}</option> : null}
              </select>
            </label>
            <label className="block text-sm">
              <span className="block text-text-muted mb-1">Days per week</span>
              <select className={field} value={draft.days_per_week} onChange={e => setField('days_per_week', e.target.value)}>
                <option value="">Not set</option>
                {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="block text-text-muted mb-1">Equipment</span>
              <input className={field} list="coaching-equipment-kinds" value={draft.equipment} onChange={e => setField('equipment', e.target.value)} />
              <datalist id="coaching-equipment-kinds">{EQUIPMENT.map(g => <option key={g} value={g} />)}</datalist>
            </label>
          </div>
        ) : null}
      </div>

      {/* Day tabs */}
      <div className="border border-border rounded-xl bg-surface p-2 flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Days">
        {draft.days.map((d, i) => (
          <button
            key={d.key} role="tab" aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${i === active ? 'bg-wcs-red text-white' : 'text-text-primary hover:bg-bg'}`}
          >
            {d.name || `Day ${i + 1}`}
            <span className={`ml-1.5 text-xs font-normal ${i === active ? 'text-white/80' : 'text-text-muted'}`}>{d.items.length}</span>
          </button>
        ))}
        <button onClick={addDay} className="shrink-0 px-3 py-2 rounded-lg text-sm font-semibold text-wcs-red hover:bg-wcs-red/10">
          + Add day
        </button>
      </div>

      {day ? (
        <>
          {/* Day header */}
          <div className="border border-border rounded-xl bg-surface p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block flex-1 min-w-[200px]">
                <span className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Day name</span>
                <input
                  value={day.name} maxLength={80} onChange={e => setDay(active, { name: e.target.value })}
                  placeholder="e.g. Push A" className={`${field} font-semibold`}
                />
              </label>
              <div className="flex gap-1">
                <IconButton label="Move day left" disabled={active === 0} onClick={() => moveDay(active, -1)} d="M15 19l-7-7 7-7" />
                <IconButton label="Move day right" disabled={active === draft.days.length - 1} onClick={() => moveDay(active, 1)} d="M9 5l7 7-7 7" />
                <button onClick={() => duplicateDay(active)} className="px-3 py-2 rounded-lg border border-border text-sm font-medium hover:border-text-muted">Duplicate</button>
                <button onClick={() => deleteDay(active)} className="px-3 py-2 rounded-lg border border-border text-sm font-medium text-text-muted hover:text-wcs-red hover:border-wcs-red">Delete</button>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Total volume sets</span>
                <button onClick={() => setShowProgramVolume(v => !v)} className="text-xs text-wcs-red hover:underline">
                  {showProgramVolume ? 'Show this day' : 'Show whole program'}
                </button>
              </div>
              <VolumeChips volume={showProgramVolume ? programVolume : dayVolume}
                           empty={showProgramVolume ? 'No working sets in this program yet.' : 'Add Workout exercises to see sets per muscle.'} />
            </div>
          </div>

          {/* Sections */}
          {SECTIONS.map(s => (
            <SectionCard
              key={s.key} section={s}
              items={day.items.filter(it => it.section === s.key)}
              labelFor={labelFor}
              onAdd={() => setPicker(s.key)}
              onPatch={patchItem}
              onRemove={removeItem}
              onMove={moveItem}
              onNudge={nudge}
              onSuperset={toggleSuperset}
            />
          ))}

          <div className="border border-border rounded-xl bg-surface p-4 sm:p-5">
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Instructions</span>
              <textarea
                value={day.instructions} rows={3} maxLength={2000}
                onChange={e => setDay(active, { instructions: e.target.value })}
                placeholder="Anything the client should know about this day: tempo, how hard, what to do if short on time"
                className={field}
              />
            </label>
          </div>
        </>
      ) : (
        <div className="border border-border rounded-xl bg-surface p-8 text-center">
          <p className="text-sm text-text-muted mb-3">This program has no days yet.</p>
          <button onClick={addDay} className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold">Add the first day</button>
        </div>
      )}

      {picker ? (
        <ExercisePicker
          sectionLabel={SECTIONS.find(s => s.key === picker)?.label}
          onClose={() => setPicker(null)}
          onAdd={(list) => addExercises(picker, list)}
        />
      ) : null}
    </div>
  )
}

function IconButton({ label, d, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
            className="p-2 rounded-lg border border-border hover:border-text-muted disabled:opacity-30">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d={d} /></svg>
    </button>
  )
}

export function VolumeChips({ volume, empty }) {
  const chips = volumeChips(volume)
  if (!chips.length) return <p className="text-xs text-text-muted">{empty}</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(c => (
        <span key={c.muscle} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-0.5 rounded-full bg-bg border border-border text-xs">
          <span className="font-medium text-text-primary">{titleCase(c.muscle)}</span>
          <span className="px-1.5 rounded-full bg-navy text-white font-semibold tabular-nums">{formatSets(c.sets)}</span>
        </span>
      ))}
    </div>
  )
}

function TagInput({ tags, onChange }) {
  const [text, setText] = useState('')
  const add = (raw) => {
    const t = raw.trim().slice(0, 40)
    if (!t || tags.some(x => x.toLowerCase() === t.toLowerCase()) || tags.length >= 12) return
    onChange([...tags, t])
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border bg-surface min-h-[42px] focus-within:ring-2 focus-within:ring-wcs-red/30 focus-within:border-wcs-red">
      {tags.map(t => (
        <span key={t} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red text-xs font-semibold">
          {t}
          <button onClick={() => onChange(tags.filter(x => x !== t))} aria-label={`Remove ${t}`} className="w-4 h-4 rounded-full hover:bg-wcs-red hover:text-white leading-none">×</button>
        </span>
      ))}
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); setText('') }
          else if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1))
        }}
        onBlur={() => { if (text.trim()) { add(text); setText('') } }}
        placeholder={tags.length ? '' : 'Type a tag and press Enter'}
        className="flex-1 min-w-[120px] px-1 py-1 text-sm bg-transparent focus:outline-none"
      />
    </div>
  )
}

const ROW_GRID = 'lg:grid lg:grid-cols-[20px_34px_40px_minmax(150px,1.4fr)_60px_76px_76px_56px_68px_minmax(110px,1fr)_auto] lg:items-center'

function SectionCard({ section, items, labelFor, onAdd, onPatch, onRemove, onMove, onNudge, onSuperset }) {
  const [armed, setArmed] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [hint, setHint] = useState(null) // index within this section

  useEffect(() => {
    const clear = () => setArmed(null)
    window.addEventListener('pointerup', clear)
    return () => window.removeEventListener('pointerup', clear)
  }, [])

  const onRowDragOver = (e, idx) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setHint(e.clientY < rect.top + rect.height / 2 ? idx : idx + 1)
  }
  const onDrop = (e) => {
    e.preventDefault()
    const key = e.dataTransfer.getData('text/coaching-item')
    if (key && hint != null) {
      // Dropping below itself in the same section shifts the index by one.
      const from = items.findIndex(it => it.key === key)
      const to = from !== -1 && from < hint ? hint - 1 : hint
      if (from === -1 || to !== from) onMove(key, section.key, to)
    }
    setHint(null); setDragging(null)
  }

  return (
    <div
      className="border border-border rounded-xl bg-surface overflow-hidden"
      onDragOver={e => { if (e.dataTransfer.types.includes('text/coaching-item')) { e.preventDefault(); setHint(h => (h == null ? items.length : h)) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHint(null) }}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border">
        <h4 className="font-bold text-text-primary">
          {section.label}
          <span className="ml-2 text-xs font-normal text-text-muted">{items.length ? `${items.length} exercise${items.length === 1 ? '' : 's'}` : ''}</span>
        </h4>
        <button onClick={onAdd} className="text-sm font-semibold text-wcs-red hover:underline">+ Add an exercise</button>
      </div>

      {items.length ? (
        <div className={`hidden ${ROW_GRID} gap-2 px-4 sm:px-5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted`}>
          <span /><span /><span /><span>Exercise</span><span>Sets</span><span>Reps</span><span>Weight</span><span>RIR</span><span>Rest</span><span>Notes</span><span />
        </div>
      ) : null}

      <div className="px-2 sm:px-3 py-2">
        {items.length === 0 ? (
          <button
            onClick={onAdd}
            className={`w-full py-5 rounded-lg border-2 border-dashed text-sm transition-colors ${hint != null ? 'border-wcs-red text-wcs-red bg-wcs-red/5' : 'border-border text-text-muted hover:border-text-muted'}`}
          >
            {hint != null ? 'Drop here' : `Nothing in ${section.label.toLowerCase()} yet. Add an exercise`}
          </button>
        ) : items.map((it, idx) => {
          const next = items[idx + 1]
          const prev = items[idx - 1]
          const linkedNext = Boolean(it.superset_group && next && next.superset_group === it.superset_group)
          const inSuperset = Boolean(it.superset_group && (linkedNext || (prev && prev.superset_group === it.superset_group)))
          return (
            <div key={it.key}>
              {hint === idx ? <div className="h-0.5 bg-wcs-red rounded mx-2 my-0.5" /> : null}
              <ItemRow
                item={it} label={labelFor(it.key)} first={idx === 0} last={idx === items.length - 1}
                inSuperset={inSuperset} linkedNext={linkedNext} canLink={Boolean(next)}
                draggable={armed === it.key}
                dragging={dragging === it.key}
                onArm={() => setArmed(it.key)}
                onDragStart={e => {
                  e.dataTransfer.setData('text/coaching-item', it.key)
                  e.dataTransfer.effectAllowed = 'move'
                  setDragging(it.key)
                }}
                onDragEnd={() => { setDragging(null); setArmed(null); setHint(null) }}
                onDragOver={e => onRowDragOver(e, idx)}
                onPatch={patch => onPatch(it.key, patch)}
                onRemove={() => onRemove(it.key)}
                onUp={() => onNudge(it.key, -1)}
                onDown={() => onNudge(it.key, 1)}
                onSuperset={() => onSuperset(it.key)}
              />
            </div>
          )
        })}
        {hint === items.length && items.length > 0 ? <div className="h-0.5 bg-wcs-red rounded mx-2 my-0.5" /> : null}
      </div>
    </div>
  )
}

function ItemRow({
  item, label, first, last, inSuperset, linkedNext, canLink, draggable, dragging,
  onArm, onDragStart, onDragEnd, onDragOver, onPatch, onRemove, onUp, onDown, onSuperset,
}) {
  const cell = 'w-full px-2 py-1.5 rounded-md border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30 focus:border-wcs-red'
  const mini = (text) => <span className="block lg:hidden text-[10px] font-semibold uppercase tracking-wide text-text-muted mb-0.5">{text}</span>
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      className={`relative ${ROW_GRID} gap-2 px-2 py-2 rounded-lg transition-colors ${dragging ? 'opacity-40' : 'hover:bg-bg/70'} ${inSuperset ? 'border-l-4 border-wcs-red pl-1.5 bg-wcs-red/[0.03]' : 'border-l-4 border-transparent pl-1.5'}`}
    >
      <div className="flex items-center gap-2 lg:contents">
        {/* A span, not a button: some browsers will not start a drag from a button. */}
        <span
          onPointerDown={onArm} aria-hidden="true" title="Drag to reorder"
          className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text-primary touch-none"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><circle cx="7" cy="5" r="1.5" /><circle cx="13" cy="5" r="1.5" /><circle cx="7" cy="10" r="1.5" /><circle cx="13" cy="10" r="1.5" /><circle cx="7" cy="15" r="1.5" /><circle cx="13" cy="15" r="1.5" /></svg>
        </span>
        <span className={`inline-flex items-center justify-center min-w-[30px] h-7 px-1 rounded-md text-xs font-bold ${inSuperset ? 'bg-wcs-red text-white' : 'bg-navy text-white'}`}>{label}</span>
        <ExerciseThumb exercise={item.exercise} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary truncate" title={item.exercise?.name}>{item.exercise?.name || 'Exercise'}</div>
          <div className="text-xs text-text-muted truncate">{titleCase(item.exercise?.primary_muscle)}{item.exercise?.equipment ? ` · ${titleCase(item.exercise.equipment)}` : ''}</div>
        </div>
        <div className="flex items-center gap-0.5 lg:order-last">
          <RowAction label="Move up" disabled={first} onClick={onUp} d="M5 15l7-7 7 7" />
          <RowAction label="Move down" disabled={last} onClick={onDown} d="M19 9l-7 7-7-7" />
          <button
            type="button" onClick={onSuperset} disabled={!canLink}
            aria-pressed={linkedNext}
            title={linkedNext ? 'Unlink from the next exercise' : 'Superset with the next exercise'}
            aria-label={linkedNext ? 'Unlink superset' : 'Superset with next'}
            className={`p-1.5 rounded-md disabled:opacity-25 ${linkedNext ? 'text-wcs-red bg-wcs-red/10' : 'text-text-muted hover:text-text-primary hover:bg-bg'}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
          </button>
          <RowAction label="Remove" onClick={onRemove} d="M6 18L18 6M6 6l12 12" danger />
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-2 lg:mt-0 lg:contents">
        <label>{mini('Sets')}<input className={`${cell} tabular-nums`} type="number" min={0} max={20} inputMode="numeric" aria-label="Sets"
                    value={item.sets} onChange={e => onPatch({ sets: e.target.value === '' ? '' : Math.max(0, Math.min(20, Math.trunc(Number(e.target.value)) || 0)) })} /></label>
        <label>{mini('Reps')}<input className={cell} aria-label="Reps" placeholder="8-12" maxLength={40} value={item.reps} onChange={e => onPatch({ reps: e.target.value })} /></label>
        <label>{mini('Weight')}<input className={cell} aria-label="Weight" placeholder="—" maxLength={40} value={item.weight} onChange={e => onPatch({ weight: e.target.value })} /></label>
        <label>{mini('RIR')}<input className={cell} aria-label="RIR" placeholder="2" maxLength={40} value={item.rir} onChange={e => onPatch({ rir: e.target.value })} /></label>
        <label>{mini('Rest')}<RestInput className={`${cell} tabular-nums`} seconds={item.rest_seconds} onChange={v => onPatch({ rest_seconds: v })} /></label>
        <label className="col-span-3 sm:col-span-1">{mini('Notes')}<input className={cell} aria-label="Notes" placeholder="Notes" maxLength={400} value={item.notes} onChange={e => onPatch({ notes: e.target.value })} /></label>
      </div>
    </div>
  )
}

function RowAction({ label, d, onClick, disabled, danger }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
            className={`p-1.5 rounded-md disabled:opacity-25 text-text-muted hover:bg-bg ${danger ? 'hover:text-wcs-red' : 'hover:text-text-primary'}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d={d} /></svg>
    </button>
  )
}

// Rest is stored in seconds (the app counts it down) but typed as m:ss.
function RestInput({ seconds, onChange, className }) {
  const [text, setText] = useState(formatRest(seconds))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(formatRest(seconds)) }, [seconds, focused])
  const commit = () => {
    const v = parseRest(text)
    onChange(v)
    setText(formatRest(v))
  }
  return (
    <input
      className={className} aria-label="Rest (m:ss)" placeholder="1:30" value={text}
      onFocus={() => setFocused(true)}
      onChange={e => setText(e.target.value)}
      onBlur={() => { setFocused(false); commit() }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}
