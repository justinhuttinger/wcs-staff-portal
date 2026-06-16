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

export default function MarketingResearch() {
  const [location, setLocation] = useState(CLUBS[0]?.slug || 'salem')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    getMarketingResearch({ location })
      .then(res => setItems(res.research || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
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

  async function dismiss(it) {
    try { await updateMarketingResearch(it.id, 'dismissed'); setItems(list => list.filter(x => x.id !== it.id)) }
    catch (err) { setError(err.message) }
  }
  async function removeItem(it) {
    try { await deleteMarketingResearch(it.id); setItems(list => list.filter(x => x.id !== it.id)) }
    catch (err) { setError(err.message) }
  }

  async function addToTracker(it) {
    setBusyId(it.id); setError('')
    try {
      const notes = [it.event_date && `When: ${it.event_date}`, it.description, it.relevance && `Why: ${it.relevance}`, it.url]
        .filter(Boolean).join('\n')
      await createMarketingEffort({
        title: it.title,
        type: 'event',
        status: 'planned',
        start_at: new Date().toISOString(),
        locations: [it.location],
        notes,
      })
      const res = await updateMarketingResearch(it.id, 'added')
      setItems(list => list.map(x => x.id === it.id ? res.item : x))
    } catch (err) { setError(err.message) } finally { setBusyId(null) }
  }

  async function addToNeeds(it) {
    setBusyId(it.id); setError('')
    try {
      const description = [it.event_date && `When: ${it.event_date}`, it.relevance, it.url].filter(Boolean).join('\n')
      await createMarketingNeed({
        title: `Promote: ${it.title}`,
        kind: 'other',
        description,
        locations: [it.location],
      })
      const res = await updateMarketingResearch(it.id, 'added')
      setItems(list => list.map(x => x.id === it.id ? res.item : x))
    } catch (err) { setError(err.message) } finally { setBusyId(null) }
  }

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
          <p className="text-xs text-text-muted">AI searches the web for upcoming local events, festivals, races, markets and sponsorship openings near this club that the gym could participate in. Takes ~20–40 seconds.</p>
        </div>
        <button onClick={run} disabled={running} className={btnPrimary}>
          {running ? 'Researching…' : 'Run Research'}
        </button>
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
                <div key={it.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-text-primary">{it.title}</span>
                        {it.category && <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${CAT_CLS[it.category] || 'bg-bg text-text-muted border-border'}`}>{it.category}</span>}
                        {it.event_date && <span className="text-[11px] text-text-muted">{it.event_date}</span>}
                        {added && <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">Added</span>}
                      </div>
                      {it.description && <p className="text-xs text-text-muted mt-1">{it.description}</p>}
                      {it.relevance && <p className="text-xs text-text-primary mt-1"><span className="text-text-muted">Why: </span>{it.relevance}</p>}
                      {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-wcs-red hover:underline">Source ↗</a>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!added && (
                        <>
                          <button onClick={() => addToTracker(it)} disabled={busyId === it.id} className={btnPrimary}>+ Tracker</button>
                          <button onClick={() => addToNeeds(it)} disabled={busyId === it.id} className={btnGhost}>+ Needs</button>
                          <button onClick={() => dismiss(it)} className="text-text-muted hover:text-wcs-red p-1" title="Dismiss">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </>
                      )}
                      {added && (
                        <button onClick={() => removeItem(it)} className="text-text-muted hover:text-wcs-red p-1" title="Remove">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
