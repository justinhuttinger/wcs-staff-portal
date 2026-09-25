import React, { useState, useEffect } from 'react'
import { tourOutcomesAdmin } from '../../lib/api'

// Admin -> Tour Check-In -> Outcomes. The buttons staff pick from when they
// finish a tour, per club, and how long a pass each one hands out. Saved to
// tour_outcomes, which the iPad, the desktop queue and the kiosk all read.

const EMPTY = {
  outcome: '', pass_mode: 'none', pass_days: '', location_slugs: null,
  counts_as_tour: true,
}

function passSummary(o) {
  if (o.pass_mode === 'fixed') return `${o.default_pass_days} day pass`
  if (o.pass_mode === 'choose') return 'Staff choose days'
  return 'No pass'
}

function clubSummary(o, clubs) {
  if (!o.location_slugs) return 'All clubs'
  const names = Object.fromEntries(clubs.map(c => [c.slug, c.name]))
  return o.location_slugs.map(s => names[s] || s).join(', ')
}

export default function TourOutcomesEditor() {
  const [outcomes, setOutcomes] = useState([])
  const [clubs, setClubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // outcome name, or 'new'

  async function load() {
    setError('')
    try {
      const r = await tourOutcomesAdmin.list()
      setOutcomes(r.outcomes || [])
      setClubs(r.clubs || [])
    } catch (e) {
      setError(e.message || 'Failed to load outcomes')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function move(i, dir) {
    const next = [...outcomes]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setOutcomes(next)
    try {
      await tourOutcomesAdmin.reorder(next.map(o => o.outcome))
    } catch (e) {
      setError(e.message || 'Failed to reorder')
      load()
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-text-primary">Outcomes</h3>
          <p className="text-xs text-text-muted">
            The buttons staff pick when they finish a tour. Changes show on the iPads and kiosk within a minute.
          </p>
        </div>
        {editing !== 'new' && (
          <button onClick={() => setEditing('new')}
            className="px-3 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold shrink-0">
            Add outcome
          </button>
        )}
      </div>

      {loading && <p className="text-text-muted text-sm">Loading…</p>}
      {error && <p className="text-wcs-red text-sm">{error}</p>}

      {editing === 'new' && (
        <OutcomeForm
          initial={EMPTY} clubs={clubs} isNew
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}

      <div className="divide-y divide-border border border-border rounded-xl">
        {outcomes.map((o, i) => (
          <div key={o.outcome} className="p-3">
            {editing === o.outcome ? (
              <OutcomeForm
                initial={{ ...o, pass_days: o.default_pass_days ?? '' }} clubs={clubs}
                onCancel={() => setEditing(null)}
                onSaved={() => { setEditing(null); load() }}
              />
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"
                    className="text-text-muted disabled:opacity-20 leading-none px-1">▲</button>
                  <button onClick={() => move(i, 1)} disabled={i === outcomes.length - 1} aria-label="Move down"
                    className="text-text-muted disabled:opacity-20 leading-none px-1">▼</button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text-primary">{o.outcome}</span>
                    <Badge>{passSummary(o)}</Badge>
                    {!o.counts_as_tour && <Badge>Not a tour</Badge>}
                  </div>
                  <p className="text-xs text-text-muted truncate">{clubSummary(o, clubs)}</p>
                </div>
                <button onClick={() => setEditing(o.outcome)}
                  className="px-3 py-1.5 rounded-lg border border-border text-text-muted text-sm">Edit</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Badge({ children }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg border border-border text-text-muted">
      {children}
    </span>
  )
}

function OutcomeForm({ initial, clubs, isNew, onCancel, onSaved }) {
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = patch => setF(prev => ({ ...prev, ...patch }))

  const allClubs = f.location_slugs === null
  function toggleClub(slug) {
    const cur = f.location_slugs || []
    set({ location_slugs: cur.includes(slug) ? cur.filter(s => s !== slug) : [...cur, slug] })
  }

  async function save() {
    setSaving(true); setError('')
    const body = {
      outcome: f.outcome,
      pass_mode: f.pass_mode,
      pass_days: f.pass_mode === 'fixed' ? Number(f.pass_days) : null,
      location_slugs: f.location_slugs,
      counts_as_tour: f.counts_as_tour,
    }
    try {
      if (isNew) await tourOutcomesAdmin.create(body)
      else await tourOutcomesAdmin.update(initial.outcome, body)
      onSaved()
    } catch (e) {
      setError(e.message || 'Failed to save'); setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${initial.outcome}" from every club? Past tours keep the outcome they were saved with.`)) return
    setSaving(true); setError('')
    try {
      await tourOutcomesAdmin.remove(initial.outcome)
      onSaved()
    } catch (e) {
      setError(e.message || 'Failed to delete'); setSaving(false)
    }
  }

  const radio = (mode, label) => (
    <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
      <input type="radio" checked={f.pass_mode === mode} onChange={() => set({ pass_mode: mode })} />
      {label}
    </label>
  )

  return (
    <div className="space-y-4 rounded-xl border border-border bg-bg p-3">
      {isNew ? (
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
          <input value={f.outcome} onChange={e => set({ outcome: e.target.value })} maxLength={40}
            placeholder="e.g. Guest, Punch Card"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
          <p className="text-[11px] text-text-muted mt-1">
            The name can't be changed later: it's what past tours and the webhook record.
          </p>
        </div>
      ) : (
        <p className="font-semibold text-text-primary">{initial.outcome}</p>
      )}

      <div>
        <p className="text-xs font-medium text-text-muted mb-2">Pass length</p>
        <div className="space-y-2">
          {radio('none', 'No pass')}
          <div className="flex items-center gap-2">
            {radio('fixed', 'Fixed length')}
            {f.pass_mode === 'fixed' && (
              <>
                <input value={f.pass_days} inputMode="numeric" aria-label="Pass days"
                  onChange={e => set({ pass_days: e.target.value.replace(/\D+/g, '').slice(0, 2) })}
                  className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-text-primary" />
                <span className="text-sm text-text-muted">days</span>
              </>
            )}
          </div>
          {radio('choose', 'Staff choose the days on each tour')}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-text-muted mb-2">Clubs</p>
        <label className="flex items-center gap-2 text-sm text-text-primary mb-2 cursor-pointer">
          <input type="checkbox" checked={allClubs}
            onChange={() => set({ location_slugs: allClubs ? [] : null })} />
          All clubs
        </label>
        {!allClubs && (
          <div className="flex flex-wrap gap-2">
            {clubs.map(c => {
              const on = (f.location_slugs || []).includes(c.slug)
              return (
                <button key={c.slug} type="button" onClick={() => toggleClub(c.slug)}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${
                    on ? 'bg-wcs-red text-white border-wcs-red' : 'bg-surface text-text-muted border-border'}`}>
                  {c.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
          <input type="checkbox" checked={f.counts_as_tour} onChange={e => set({ counts_as_tour: e.target.checked })} />
          Counts as a tour <span className="text-text-muted text-xs">(Tours Given and Tour Conversion)</span>
        </label>
      </div>

      {error && <p className="text-wcs-red text-sm">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} disabled={saving}
          className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm">Cancel</button>
        {!isNew && (
          <button onClick={remove} disabled={saving}
            className="ml-auto px-3 py-2 rounded-lg text-wcs-red text-sm">Delete</button>
        )}
      </div>
    </div>
  )
}
