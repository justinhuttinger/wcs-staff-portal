import { useState, useEffect, useCallback } from 'react'
import {
  getMarketingResearch, runMarketingResearch, updateMarketingResearch, deleteMarketingResearch,
  createMarketingEffort, createMarketingNeed,
} from '../lib/api'
import { LOCATION_OPTIONS } from '../config/locations'

const CLUBS = LOCATION_OPTIONS.filter(o => o.slug !== 'all')
const inputCls = 'px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-primary focus:outline-none focus:border-wcs-red'
const btnPrimary = 'px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50'
const btnGhost = 'px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-semibold text-text-muted hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-50'

const CAT_CLS = {
  festival: 'bg-purple-50 text-purple-700 border-purple-200',
  race: 'bg-blue-50 text-blue-700 border-blue-200',
  market: 'bg-amber-50 text-amber-700 border-amber-200',
  sponsorship: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  community: 'bg-pink-50 text-pink-700 border-pink-200',
  fair: 'bg-teal-50 text-teal-700 border-teal-200',
  sports: 'bg-indigo-50 text-indigo-700 border-indigo-200',
}
const KINDS = [
  { key: 'graphic_design', label: 'Graphic Design' }, { key: 'media', label: 'Media / Video' },
  { key: 'print', label: 'Print' }, { key: 'social', label: 'Social' }, { key: 'web', label: 'Web' }, { key: 'other', label: 'Other' },
]

const toDateInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Pull a {start, end} (YYYY-MM-DD) out of a free-text event_date label, handling
// ranges the AI / sources write many ways:
//   "Jul 19, 2026"            -> start only
//   "Aug 28–Sep 7, 2026"      -> cross-month range
//   "Jul 9–12, 2026"          -> same-month day range
//   "Recurring (Dec 6, 2026)" -> the one dated mention
function parseEventDates(text) {
  const out = { start: '', end: '' }
  if (!text) return out
  const yearM = text.match(/\b(20\d{2})\b/)
  const year = yearM ? yearM[1] : String(new Date().getFullYear())
  const mk = (mon, day) => {
    const d = new Date(`${String(mon).slice(0, 3)} ${day}, ${year}`)
    return isNaN(d.getTime()) ? '' : toDateInput(d)
  }
  const tokens = [...text.matchAll(/([A-Za-z]{3,9})\.?\s+(\d{1,2})/g)]
  // Same-month day range: "Jul 9-12" (second number is a bare day, not a month)
  const sameMonth = text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})(?!\s*[A-Za-z])/)
  if (tokens.length >= 2) {
    out.start = mk(tokens[0][1], tokens[0][2])
    out.end = mk(tokens[1][1], tokens[1][2])
  } else if (sameMonth) {
    out.start = mk(sameMonth[1], sameMonth[2])
    out.end = mk(sameMonth[1], sameMonth[3])
  } else if (tokens.length === 1) {
    out.start = mk(tokens[0][1], tokens[0][2])
  }
  return out
}

function ClubChips({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CLUBS.map(o => (
        <button key={o.slug} type="button"
          onClick={() => onChange(value.includes(o.slug) ? value.filter(l => l !== o.slug) : [...value, o.slug])}
          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${value.includes(o.slug) ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>
          {o.label}</button>
      ))}
    </div>
  )
}

// Modal to review/edit before pushing a research item to the Tracker (as an
// event) or the Needs List.
function AddModal({ item, target, onClose, onAdded }) {
  const isTracker = target === 'tracker'
  const baseNotes = [item.event_date && `When: ${item.event_date}`, item.description, item.relevance && `Why: ${item.relevance}`, item.url].filter(Boolean).join('\n')
  const parsed = parseEventDates(item.event_date)
  const [form, setForm] = useState({
    title: item.title,
    start: item.event_start || parsed.start || toDateInput(new Date()),
    end: item.event_end || parsed.end || '',  // blank = single-day
    locations: CLUBS.some(c => c.slug === item.location) ? [item.location] : [],
    notes: baseNotes,
    kind: 'other',
    priority: 'normal',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.title.trim()) { setError('Title is required'); return }
    if (isTracker && form.locations.length === 0) { setError('Pick at least one club'); return }
    if (form.end && form.end < form.start) { setError('End date must be on or after the start date'); return }
    setSaving(true); setError('')
    try {
      if (isTracker) {
        await createMarketingEffort({
          title: form.title.trim(),
          type: 'event',
          status: 'planned',
          start_at: new Date(form.start + 'T12:00:00').toISOString(),
          end_at: form.end ? new Date(form.end + 'T12:00:00').toISOString() : null,
          locations: form.locations,
          notes: form.notes,
        })
      } else {
        await createMarketingNeed({
          title: form.title.trim(),
          kind: form.kind,
          priority: form.priority,
          locations: form.locations,
          due_date: form.start,
          description: form.notes,
        })
      }
      const res = await updateMarketingResearch(item.id, 'added')
      onAdded(res.item)
      onClose()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-text-primary mb-1">{isTracker ? 'Add to Tracker' : 'Add to Needs List'}</h3>
        <p className="text-[11px] text-text-muted mb-4">{isTracker ? 'Goes in as a marketing Event. Review the details below.' : 'Creates a request in the Needs List.'}</p>
        <div className="space-y-3">
          <input value={form.title} onChange={e => set('title', e.target.value)} className={inputCls + ' w-full'} placeholder="Title *" autoFocus />
          <div className="flex gap-3 flex-wrap">
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">{isTracker ? 'Start date' : 'Due date'}</span>
              <input type="date" value={form.start} onChange={e => set('start', e.target.value)} className={inputCls + ' w-44'} />
            </div>
            {isTracker && (
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">End date <span className="normal-case text-text-muted/70">(multi-day)</span></span>
                <input type="date" value={form.end} min={form.start} onChange={e => set('end', e.target.value)} className={inputCls + ' w-44'} />
              </div>
            )}
          </div>
          {!isTracker && (
            <div className="grid grid-cols-2 gap-3">
              <select value={form.kind} onChange={e => set('kind', e.target.value)} className={inputCls + ' w-full'}>
                {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
              <select value={form.priority} onChange={e => set('priority', e.target.value)} className={inputCls + ' w-full'}>
                {['high', 'normal', 'low'].map(p => <option key={p} value={p}>{p} priority</option>)}
              </select>
            </div>
          )}
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Clubs{isTracker ? ' *' : ''}</span>
            <ClubChips value={form.locations} onChange={v => set('locations', v)} />
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">{isTracker ? 'Notes' : 'Details'}</span>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={4} className={inputCls + ' w-full'} />
          </div>
          {error && <p className="text-xs text-wcs-red">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className={btnGhost} onClick={onClose}>Cancel</button>
            <button className={btnPrimary} onClick={submit} disabled={saving}>{saving ? 'Adding...' : isTracker ? 'Add to Tracker' : 'Add to Needs'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MarketingResearch() {
  const [location, setLocation] = useState(CLUBS[0]?.slug || 'salem')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [addModal, setAddModal] = useState(null) // { item, target }

  const load = useCallback(() => {
    setLoading(true)
    getMarketingResearch({ location }).then(res => setItems(res.research || [])).catch(err => setError(err.message)).finally(() => setLoading(false))
  }, [location])
  useEffect(() => { load() }, [load])

  async function run() {
    setRunning(true); setError('')
    try {
      const res = await runMarketingResearch(location)
      if ((res.research || []).length === 0) setError('No opportunities came back this time — try again.')
      setItems(prev => [...(res.research || []), ...prev])
    } catch (err) { setError(err.message) } finally { setRunning(false) }
  }
  async function removeFromList(it) {
    try { await deleteMarketingResearch(it.id); setItems(list => list.filter(x => x.id !== it.id)) }
    catch (err) { setError(err.message) }
  }
  const onAdded = (updated) => setItems(list => list.map(x => x.id === updated.id ? updated : x))

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-wcs-red bg-surface border border-border rounded-lg px-3 py-2">{error}</p>}

      <div className="bg-surface border border-border rounded-xl p-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Club / Area</span>
          <select value={location} onChange={e => setLocation(e.target.value)} className={inputCls + ' w-44'}>
            {CLUBS.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[220px]">
          <p className="text-xs text-text-muted">AI searches the web for upcoming local events, festivals, races, markets and sponsorship openings near this club. Takes ~20–40 seconds.</p>
        </div>
        <button onClick={run} disabled={running} className={btnPrimary}>{running ? 'Researching…' : 'Run Research'}</button>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {loading ? (
          <p className="text-sm text-text-muted p-6 text-center">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-muted p-8 text-center">No research yet for this club. Hit “Run Research” to find local opportunities.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {items.map(it => {
              const added = it.status === 'added'
              return (
                <div key={it.id} className={`p-4 ${added ? 'bg-emerald-50/30' : ''}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-text-primary">{it.title}</span>
                        {it.category && <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${CAT_CLS[it.category] || 'bg-bg text-text-muted border-border'}`}>{it.category}</span>}
                        {it.event_date && <span className="text-[11px] text-text-muted">{it.event_date}</span>}
                        {added && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-700 bg-emerald-100 border border-emerald-300 rounded-full px-2 py-0.5">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>Added
                        </span>}
                      </div>
                      {it.description && <p className="text-xs text-text-muted mt-1">{it.description}</p>}
                      {it.relevance && <p className="text-xs text-text-primary mt-1"><span className="text-text-muted">Why: </span>{it.relevance}</p>}
                      {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-wcs-red hover:underline">Source ↗</a>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!added && (
                        <>
                          <button onClick={() => setAddModal({ item: it, target: 'tracker' })} className={btnPrimary}>+ Tracker</button>
                          <button onClick={() => setAddModal({ item: it, target: 'needs' })} className={btnGhost}>+ Needs</button>
                        </>
                      )}
                      <button onClick={() => removeFromList(it)} className="text-[11px] font-semibold text-text-muted hover:text-wcs-red">Remove from list</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {addModal && (
        <AddModal
          item={addModal.item}
          target={addModal.target}
          onClose={() => setAddModal(null)}
          onAdded={onAdded}
        />
      )}
    </div>
  )
}
