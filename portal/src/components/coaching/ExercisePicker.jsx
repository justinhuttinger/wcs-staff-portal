import { useEffect, useRef, useState } from 'react'
import { exercisesApi } from './coachingApi'
import ExerciseThumb from './ExerciseThumb.jsx'
import { titleCase } from './volume'

const PAGE_SIZE = 24

// Search the exercise library, preview one, tick several and add them all to
// a section in one go. "Add your own" covers anything the library lacks.
// `max`: how many more exercises the day has room for (the builder's limit).
export default function ExercisePicker({ sectionLabel, onAdd, onClose, max = Infinity }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [muscle, setMuscle] = useState('')
  const [equipment, setEquipment] = useState('')
  const [facets, setFacets] = useState({ muscles: [], equipment: [] })
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState([]) // exercises, in the order ticked
  const [preview, setPreview] = useState(null)
  const [adding, setAdding] = useState(false)
  const searchRef = useRef(null)

  useEffect(() => { searchRef.current?.focus() }, [])
  useEffect(() => {
    exercisesApi.facets().then(setFacets).catch(() => {})
  }, [])
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(id)
  }, [q])

  // A new search starts at page 1; "Load more" appends.
  useEffect(() => { setPage(1) }, [debounced, muscle, equipment])
  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    exercisesApi.search({ q: debounced, muscle, equipment, page, pageSize: PAGE_SIZE })
      .then(r => {
        if (!live) return
        setResults(prev => (page === 1 ? r.exercises : [...prev, ...r.exercises]))
        setTotal(r.total)
      })
      .catch(err => { if (live) setError(err.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [debounced, muscle, equipment, page])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (preview) setPreview(null)
      else if (adding) setAdding(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, adding, onClose])

  const isSelected = (id) => selected.some(s => s.id === id)
  const toggle = (ex) => setSelected(list => {
    if (list.some(s => s.id === ex.id)) return list.filter(s => s.id !== ex.id)
    return list.length >= max ? list : [...list, ex]
  })
  const atMax = selected.length >= max

  const field = 'px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 sm:p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label="Add exercises"
        className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-border space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-text-primary">Add exercises{sectionLabel ? ` to ${sectionLabel}` : ''}</h3>
              <p className="text-xs text-text-muted">Click to select several, or open one to see how it is done.</p>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={searchRef} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search exercises, e.g. incline press"
              className={`${field} flex-1 min-w-[200px]`}
            />
            <select value={muscle} onChange={e => setMuscle(e.target.value)} className={field} aria-label="Muscle">
              <option value="">All muscles</option>
              {facets.muscles.map(m => <option key={m} value={m}>{titleCase(m)}</option>)}
            </select>
            <select value={equipment} onChange={e => setEquipment(e.target.value)} className={field} aria-label="Equipment">
              <option value="">All equipment</option>
              {facets.equipment.map(m => <option key={m} value={m}>{titleCase(m)}</option>)}
            </select>
            <button onClick={() => setAdding(true)} className="px-3 py-2 rounded-lg border border-border text-sm font-semibold hover:border-text-muted">
              + Add your own
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-bg">
          {error ? <p className="text-sm text-wcs-red mb-3">{error}</p> : null}
          {!loading && results.length === 0 && !error ? (
            <div className="text-center py-12">
              <p className="text-sm text-text-muted">Nothing matches that. Try fewer words, or add it yourself.</p>
              <button onClick={() => setAdding(true)} className="mt-3 text-sm font-semibold text-wcs-red hover:underline">Add “{q.trim() || 'a new exercise'}”</button>
            </div>
          ) : null}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {results.map(ex => {
              const on = isSelected(ex.id)
              return (
                <div
                  key={ex.id}
                  className={`relative rounded-xl border bg-surface overflow-hidden transition-shadow ${on ? 'border-wcs-red ring-2 ring-wcs-red/40' : 'border-border hover:shadow-md'}`}
                >
                  <button onClick={() => toggle(ex)} className="block w-full text-left" aria-pressed={on}>
                    <ExerciseThumb exercise={ex} size="md" />
                    <div className="p-2.5">
                      <div className="text-sm font-semibold text-text-primary leading-snug line-clamp-2">{ex.name}</div>
                      <div className="text-xs text-text-muted mt-0.5">
                        {titleCase(ex.primary_muscle) || 'Other'}{ex.equipment ? ` · ${titleCase(ex.equipment)}` : ''}
                      </div>
                    </div>
                  </button>
                  <span className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow ${on ? 'bg-wcs-red text-white' : 'bg-white/90 text-text-muted border border-border'}`}>
                    {on ? selected.findIndex(s => s.id === ex.id) + 1 : '+'}
                  </span>
                  <button
                    onClick={() => setPreview(ex)}
                    className="absolute top-2 right-2 px-2 py-1 rounded-md bg-white/90 border border-border text-xs font-semibold hover:bg-white"
                  >
                    {ex.has_video ? 'Video' : 'View'}
                  </button>
                </div>
              )
            })}
          </div>
          {results.length < total ? (
            <div className="text-center mt-4">
              <button
                disabled={loading} onClick={() => setPage(p => p + 1)}
                className="px-4 py-2 rounded-lg border border-border bg-surface text-sm font-semibold disabled:opacity-50"
              >
                {loading ? 'Loading…' : `Show more (${total - results.length} left)`}
              </button>
            </div>
          ) : null}
          {loading && results.length === 0 ? <p className="text-sm text-text-muted text-center py-8">Loading the library…</p> : null}
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-border flex items-center gap-3">
          <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto">
            {selected.length === 0
              ? <span className="text-sm text-text-muted">No exercises selected yet.{Number.isFinite(max) ? ` This day has room for ${max} more.` : ''}</span>
              : selected.map((s, i) => (
                <button key={s.id} onClick={() => toggle(s)} title="Remove"
                        className="shrink-0 px-2 py-1 rounded-full bg-bg border border-border text-xs font-medium hover:border-wcs-red">
                  {i + 1}. {s.name} ×
                </button>
              ))}
            {atMax && selected.length ? <span className="shrink-0 self-center text-xs text-text-muted">That fills the day.</span> : null}
          </div>
          <button onClick={onClose} className="px-3 py-2 text-sm text-text-muted hover:text-text-primary">Cancel</button>
          <button
            disabled={selected.length === 0}
            onClick={() => onAdd(selected)}
            className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold disabled:opacity-40 hover:bg-wcs-red-hover"
          >
            Add {selected.length || ''} exercise{selected.length === 1 ? '' : 's'}
          </button>
        </div>

        {preview ? (
          <ExercisePreview
            exercise={preview}
            selected={isSelected(preview.id)}
            onToggle={() => toggle(preview)}
            onClose={() => setPreview(null)}
          />
        ) : null}
        {adding ? (
          <CustomExerciseForm
            initialName={q.trim()}
            muscles={facets.muscles}
            equipment={facets.equipment}
            onCancel={() => setAdding(false)}
            onCreated={(ex) => {
              setAdding(false)
              setResults(list => [ex, ...list.filter(r => r.id !== ex.id)])
              setSelected(list => (list.length >= max ? list : [...list, ex]))
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

// Also used by the Coaching exercise library (ExerciseLibrary.jsx), which
// passes `fixed` (no picker modal around it), no onToggle and its own footer.
export function ExercisePreview({ exercise, selected, onToggle, onClose, fixed = false, footer = null }) {
  const [detail, setDetail] = useState(null)
  const [video, setVideo] = useState(null) // { url } | 'none' | 'loading'

  useEffect(() => {
    let live = true
    exercisesApi.get(exercise.id).then(r => { if (live) setDetail(r.exercise) }).catch(() => {})
    return () => { live = false }
  }, [exercise.id])

  async function playVideo() {
    setVideo('loading')
    try {
      const r = await exercisesApi.video(exercise.id)
      const url = r.videoUrl || r.hlsUrl
      setVideo(url ? { url } : 'none')
    } catch {
      // 503 means no video for this one yet (image-only library, or YMove not
      // connected). Anything else is treated the same: show the still.
      setVideo('none')
    }
  }

  const ex = detail || exercise
  return (
    <div className={`${fixed ? 'fixed z-[70]' : 'absolute z-10'} inset-0 bg-black/40 flex items-center justify-center p-3`} onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-2xl max-h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="grid sm:grid-cols-2 gap-4 p-4 sm:p-5">
          <div className="space-y-2">
            {video && video.url ? (
              <video src={video.url} controls autoPlay loop muted playsInline className="w-full rounded-xl bg-black aspect-[4/3]" />
            ) : (
              <ExerciseThumb exercise={ex} size="lg" />
            )}
            {!video || video === 'loading' ? (
              <button
                onClick={playVideo} disabled={video === 'loading'}
                className="w-full px-3 py-2 rounded-lg border border-border text-sm font-semibold hover:border-text-muted disabled:opacity-50"
              >
                {video === 'loading' ? 'Loading video…' : '▶ Play video'}
              </button>
            ) : video === 'none' ? (
              <p className="text-xs text-text-muted text-center">No video for this one yet.</p>
            ) : null}
          </div>
          <div className="space-y-3 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-lg font-bold text-text-primary leading-tight">{ex.name}</h4>
              <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close preview">✕</button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {ex.primary_muscle ? <span className="px-2 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red font-semibold">{titleCase(ex.primary_muscle)}</span> : null}
              {(ex.secondary_muscles || []).map(m => <span key={m} className="px-2 py-0.5 rounded-full bg-bg border border-border">{titleCase(m)}</span>)}
              {ex.equipment ? <span className="px-2 py-0.5 rounded-full bg-bg border border-border">{titleCase(ex.equipment)}</span> : null}
            </div>
            {ex.cues?.length ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Cues</div>
                <ul className="text-sm list-disc pl-5 space-y-0.5">{ex.cues.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            ) : null}
            {ex.instructions?.length ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">How to</div>
                <ol className="text-sm list-decimal pl-5 space-y-1">{ex.instructions.map((c, i) => <li key={i}>{c}</li>)}</ol>
              </div>
            ) : !detail ? <p className="text-sm text-text-muted">Loading…</p> : null}
            {onToggle ? (
              <button
                onClick={() => { onToggle(); onClose() }}
                className={`w-full px-4 py-2 rounded-lg text-sm font-semibold ${selected ? 'border border-border' : 'bg-wcs-red text-white hover:bg-wcs-red-hover'}`}
              >
                {selected ? 'Remove from selection' : 'Select this exercise'}
              </button>
            ) : null}
            {footer ? footer(ex) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// `existing` edits a custom exercise (PUT) instead of adding one; `fixed`
// when it opens outside the picker modal.
export function CustomExerciseForm({ initialName, muscles, equipment, onCancel, onCreated, existing = null, fixed = false, submitLabel }) {
  const [name, setName] = useState(existing?.name || initialName || '')
  const [primary, setPrimary] = useState(existing?.primary_muscle || '')
  const [secondary, setSecondary] = useState(existing?.secondary_muscles || [])
  const [equip, setEquip] = useState(existing?.equipment || '')
  const [notes, setNotes] = useState((existing?.instructions || []).join('\n'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const body = {
        name, primary_muscle: primary, secondary_muscles: secondary, equipment: equip,
        instructions: notes.trim() ? notes.split('\n').map(s => s.trim()).filter(Boolean) : [],
      }
      const r = existing ? await exercisesApi.update(existing.id, body) : await exercisesApi.create(body)
      onCreated(r.exercise)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const field = 'w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm'
  return (
    <div className={`${fixed ? 'fixed z-[70]' : 'absolute z-10'} inset-0 bg-black/40 flex items-center justify-center p-3`} onClick={onCancel}>
      <form onSubmit={save} onClick={e => e.stopPropagation()}
            className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-md p-5 space-y-3">
        <div>
          <h4 className="text-base font-bold text-text-primary">{existing ? 'Edit your exercise' : 'Add your own exercise'}</h4>
          <p className="text-xs text-text-muted">Every WCS trainer will be able to use it.</p>
        </div>
        <label className="block text-sm">
          <span className="block text-text-muted mb-1">Name</span>
          <input autoFocus className={field} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Landmine press" required />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="block text-text-muted mb-1">Main muscle</span>
            <select className={field} value={primary} onChange={e => setPrimary(e.target.value)} required>
              <option value="">Pick one</option>
              {muscles.map(m => <option key={m} value={m}>{titleCase(m)}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="block text-text-muted mb-1">Equipment</span>
            <input className={field} list="coaching-equipment" value={equip} onChange={e => setEquip(e.target.value)} placeholder="dumbbell" />
            <datalist id="coaching-equipment">{equipment.map(m => <option key={m} value={m} />)}</datalist>
          </label>
        </div>
        <div className="text-sm">
          <span className="block text-text-muted mb-1">Also works (counts half a set)</span>
          <div className="flex flex-wrap gap-1.5">
            {muscles.filter(m => m !== primary).map(m => {
              const on = secondary.includes(m)
              return (
                <button type="button" key={m}
                        onClick={() => setSecondary(s => (on ? s.filter(x => x !== m) : [...s, m]))}
                        className={`px-2 py-0.5 rounded-full text-xs border ${on ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg border-border'}`}>
                  {titleCase(m)}
                </button>
              )
            })}
          </div>
        </div>
        <label className="block text-sm">
          <span className="block text-text-muted mb-1">How to do it (optional, one step per line)</span>
          <textarea className={field} rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
        </label>
        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-text-muted">Cancel</button>
          <button disabled={busy} className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold disabled:opacity-50">
            {busy ? 'Saving…' : (submitLabel || (existing ? 'Save' : 'Add and select'))}
          </button>
        </div>
      </form>
    </div>
  )
}
