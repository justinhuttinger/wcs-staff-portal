import { useEffect, useState } from 'react'
import { exercisesApi } from './coachingApi'
import ExerciseThumb from './ExerciseThumb.jsx'
import { ExercisePreview, CustomExerciseForm } from './ExercisePicker.jsx'
import { titleCase } from './volume'
import { Card, field, primaryBtn, btn } from './ui.jsx'

const PAGE_SIZE = 36

// Browse the exercise library: search, filter by muscle and equipment,
// preview (video when there is one), and add or edit your own.
export default function ExerciseLibrary({ me }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [muscle, setMuscle] = useState('')
  const [equipment, setEquipment] = useState('')
  const [source, setSource] = useState('')
  const [facets, setFacets] = useState({ muscles: [], equipment: [] })
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const [editing, setEditing] = useState(null) // 'new' | exercise
  const [bump, setBump] = useState(0)

  useEffect(() => { exercisesApi.facets().then(setFacets).catch(() => {}) }, [])
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(id)
  }, [q])
  useEffect(() => { setPage(1) }, [debounced, muscle, equipment, source, bump])
  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    exercisesApi.search({ q: debounced, muscle, equipment, source, page, pageSize: PAGE_SIZE })
      .then(r => {
        if (!live) return
        setResults(prev => (page === 1 ? r.exercises : [...prev, ...r.exercises]))
        setTotal(r.total)
      })
      .catch(err => { if (live) setError(err.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [debounced, muscle, equipment, source, page, bump])

  const canEdit = (ex) => ex.source === 'custom' && (me.isManager || (ex.created_by && ex.created_by === me.email))

  return (
    <div className="space-y-4">
      <Card bodyClass="p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px]">
            <h3 className="text-lg font-bold text-text-primary">Exercise library</h3>
            <p className="text-xs text-text-muted">{total ? `${total.toLocaleString()} exercises` : 'Every exercise you can put in a program.'} Custom ones are shared with every WCS trainer.</p>
          </div>
          <button className={primaryBtn} onClick={() => setEditing('new')}>+ Add exercise</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search, e.g. romanian deadlift" className={`${field} flex-1 min-w-[200px]`} />
          <select value={muscle} onChange={e => setMuscle(e.target.value)} className={field} aria-label="Muscle">
            <option value="">All muscles</option>
            {facets.muscles.map(m => <option key={m} value={m}>{titleCase(m)}</option>)}
          </select>
          <select value={equipment} onChange={e => setEquipment(e.target.value)} className={field} aria-label="Equipment">
            <option value="">All equipment</option>
            {facets.equipment.map(m => <option key={m} value={m}>{titleCase(m)}</option>)}
          </select>
          <select value={source} onChange={e => setSource(e.target.value)} className={field} aria-label="Source">
            <option value="">Library and custom</option>
            <option value="custom">Custom only</option>
          </select>
        </div>
        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
      </Card>

      <Card bodyClass="p-3 sm:p-4">
        {!loading && results.length === 0 && !error ? (
          <div className="text-center py-10 space-y-2">
            <p className="text-sm text-text-muted">Nothing matches that.</p>
            <button onClick={() => setEditing('new')} className="text-sm font-semibold text-wcs-red hover:underline">Add “{q.trim() || 'a new exercise'}”</button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-3">
          {results.map(ex => (
            <button key={ex.id} onClick={() => setPreview(ex)} className="text-left rounded-xl border border-border bg-surface overflow-hidden hover:shadow-md transition-shadow relative">
              <ExerciseThumb exercise={ex} size="md" />
              <div className="p-2.5">
                <div className="text-sm font-semibold text-text-primary leading-snug line-clamp-2">{ex.name}</div>
                <div className="text-xs text-text-muted mt-0.5">
                  {titleCase(ex.primary_muscle) || 'Other'}{ex.equipment ? ` · ${titleCase(ex.equipment)}` : ''}
                </div>
              </div>
              {ex.source === 'custom' ? <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-navy text-white">Custom</span> : null}
              {ex.has_video ? <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-white/90 border border-border text-text-primary">Video</span> : null}
            </button>
          ))}
        </div>
        {results.length < total ? (
          <div className="text-center mt-4">
            <button disabled={loading} onClick={() => setPage(p => p + 1)} className={btn}>
              {loading ? 'Loading…' : `Show more (${(total - results.length).toLocaleString()} left)`}
            </button>
          </div>
        ) : null}
        {loading && results.length === 0 ? <p className="text-sm text-text-muted text-center py-8">Loading the library…</p> : null}
      </Card>

      {preview ? (
        <ExercisePreview
          fixed
          exercise={preview}
          onClose={() => setPreview(null)}
          footer={(ex) => (canEdit(ex)
            ? <button className={`${btn} w-full`} onClick={() => { setPreview(null); setEditing(ex) }}>Edit this exercise</button>
            : null)}
        />
      ) : null}
      {editing ? (
        <CustomExerciseForm
          fixed
          existing={editing === 'new' ? null : editing}
          initialName={editing === 'new' ? q.trim() : ''}
          muscles={facets.muscles}
          equipment={facets.equipment}
          submitLabel={editing === 'new' ? 'Add exercise' : 'Save'}
          onCancel={() => setEditing(null)}
          onCreated={(ex) => { setEditing(null); setPreview(ex); setBump(n => n + 1) }}
        />
      ) : null}
    </div>
  )
}
