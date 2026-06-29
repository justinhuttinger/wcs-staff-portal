import { useState, useEffect } from 'react'
import { onlineJoin } from '../../lib/api'
import { Field, FeaturesEditor, PlanEditor } from './OnlineJoinPlans'

const EMPTY_TYPE = {
  wcs_location_id: '',
  type_key: '',
  type_label: '',
  description: '',
  features: [],
  badge: '',
  age_rule_id: null,
  display_order: 0,
  promo_code: '',
  promo_starts_at: '',
  promo_ends_at: '',
  promo_callout: '',
  promo_callout_enabled: false,
  allow_secondary_members: false,
  active: true,
}

// <input type="datetime-local"> wants 'YYYY-MM-DDTHH:mm' in LOCAL time. The
// API hands back ISO/UTC strings; trim to the minute and drop the zone so the
// browser shows a sensible local value to edit.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// datetime-local value -> ISO string (or null when blank).
function toIso(localValue) {
  if (!localValue) return null
  const d = new Date(localValue)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

function TypeEditor({ type, locations, ageRules, onClose, onSaved }) {
  const isNew = !type.id
  const [draft, setDraft] = useState(() => ({
    ...EMPTY_TYPE,
    ...type,
    features: Array.isArray(type.features) ? type.features : [],
    promo_starts_at: toLocalInput(type.promo_starts_at),
    promo_ends_at: toLocalInput(type.promo_ends_at),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showPromo, setShowPromo] = useState(!!(type.promo_code || type.promo_starts_at || type.promo_ends_at))

  // Child plans (only meaningful once the type exists).
  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null)

  function update(key, value) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  async function loadPlans() {
    if (!type.id) return
    setPlansLoading(true)
    try {
      const r = await onlineJoin.listPlansByType(type.id)
      setPlans(r.plans || [])
    } catch {
      // non-fatal — the type still saves without its plans loaded
    } finally {
      setPlansLoading(false)
    }
  }

  useEffect(() => { loadPlans() }, [type.id])

  async function save() {
    setSaving(true); setError(null)
    try {
      const body = {
        wcs_location_id: draft.wcs_location_id,
        type_key: draft.type_key,
        type_label: draft.type_label,
        description: draft.description || null,
        features: draft.features,
        badge: draft.badge || null,
        age_rule_id: draft.age_rule_id || null,
        display_order: parseInt(draft.display_order) || 0,
        promo_code: draft.promo_code || null,
        promo_starts_at: toIso(draft.promo_starts_at),
        promo_ends_at: toIso(draft.promo_ends_at),
        promo_callout: (draft.promo_callout || '').trim() || null,
        promo_callout_enabled: !!draft.promo_callout_enabled,
        allow_secondary_members: !!draft.allow_secondary_members,
        active: !!draft.active,
      }
      if (isNew) {
        await onlineJoin.createType(body)
      } else {
        // wcs_location_id is immutable; type_key (slug) can be changed.
        const { wcs_location_id, ...patch } = body
        await onlineJoin.updateType(type.id, patch)
      }
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const TERMS = [{ key: '1yr', label: '1-Year' }, { key: 'm2m', label: 'Month-to-Month' }]
  function plansForTerm(term) {
    return plans.filter(p => p.term === term).sort((a, b) => (a.max_members || 1) - (b.max_members || 1))
  }
  function addPlan(term) {
    // For family types suggest the next household size (base 3, then 4, 5…).
    const existing = plansForTerm(term)
    const nextMax = draft.allow_secondary_members
      ? (existing.length ? Math.max(...existing.map(p => p.max_members || 1)) + 1 : 3)
      : 1
    setEditingPlan({
      _isNew: true,
      wcs_location_id: draft.wcs_location_id,
      membership_type_id: type.id,
      term,
      max_members: nextMax,
    })
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{isNew ? 'Add Membership Type' : (draft.type_label || draft.type_key)}</h3>
            <p className="text-xs text-text-muted">{isNew ? 'Create a new membership type' : `Editing ${draft.type_key}`}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Where + Identity</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-text-muted mb-1">Location <span className="text-wcs-red">*</span></span>
                <select
                  value={draft.wcs_location_id}
                  onChange={e => update('wcs_location_id', e.target.value)}
                  disabled={!isNew}
                  className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red disabled:opacity-60"
                >
                  <option value="">— select —</option>
                  {locations.map(l => (
                    <option key={l.wcs_location_id} value={l.wcs_location_id}>
                      {l.display_name} (club #{l.abc_club_number})
                    </option>
                  ))}
                </select>
              </label>
              <Field label="Type key (slug)" value={draft.type_key} onChange={v => update('type_key', v.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="standard" required hint="URL-safe slug; unique per location. You can change this." />
            </div>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Marketing</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type label" value={draft.type_label} onChange={v => update('type_label', v)} required placeholder="Standard Membership" />
              <Field label="Badge (optional)" value={draft.badge} onChange={v => update('badge', v)} placeholder="Most Popular" />
              <Field label="Display order" type="number" value={draft.display_order} onChange={v => update('display_order', v)} />
            </div>
            <div className="mt-3">
              <span className="block text-xs font-medium text-text-muted mb-1">Description</span>
              <textarea
                value={draft.description || ''}
                onChange={e => update('description', e.target.value)}
                rows={2}
                placeholder="Short marketing copy under the type label."
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
              />
            </div>
            <div className="mt-3">
              <span className="block text-xs font-medium text-text-muted mb-1">Amenities / features</span>
              <FeaturesEditor value={draft.features} onChange={v => update('features', v)} />
            </div>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Eligibility</p>
            <label className="block">
              <span className="block text-xs font-medium text-text-muted mb-1">Age rule</span>
              <select
                value={draft.age_rule_id || ''}
                onChange={e => update('age_rule_id', e.target.value || null)}
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
              >
                <option value="">No age restriction</option>
                {ageRules.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.min_age != null || r.max_age != null
                      ? ` (${r.min_age != null ? r.min_age + '+' : ''}${r.max_age != null ? ` to ${r.max_age}` : ''})`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Promo (optional)</p>
              <button
                onClick={() => setShowPromo(s => !s)}
                className="text-[11px] text-wcs-red hover:underline"
              >
                {showPromo ? 'Hide' : 'Add promo'}
              </button>
            </div>
            {showPromo && (
              <>
                <p className="text-[10px] text-text-muted mb-2">
                  A promo type is hidden from the public widget unless the URL has <span className="font-mono">?promo=&lt;code&gt;</span> and the current time is within the start/end window.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Promo code" value={draft.promo_code} onChange={v => update('promo_code', v)} mono placeholder="SUMMER25" />
                  <label className="block">
                    <span className="block text-xs font-medium text-text-muted mb-1">Promo starts</span>
                    <input
                      type="datetime-local"
                      value={draft.promo_starts_at || ''}
                      onChange={e => update('promo_starts_at', e.target.value)}
                      className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-medium text-text-muted mb-1">Promo ends</span>
                    <input
                      type="datetime-local"
                      value={draft.promo_ends_at || ''}
                      onChange={e => update('promo_ends_at', e.target.value)}
                      className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                    />
                  </label>
                </div>
              </>
            )}
          </section>

          <section>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={!!draft.promo_callout_enabled}
                onChange={e => update('promo_callout_enabled', e.target.checked)}
                className="w-4 h-4 mt-0.5"
              />
              <span className="text-sm text-text-primary">
                Show a promo callout on the card
                <span className="block text-[10px] text-text-muted">
                  A red highlight box under the price on this membership card (e.g. "HALF OFF AND NO ENROLLMENT").
                </span>
              </span>
            </label>
            {draft.promo_callout_enabled && (
              <div className="mt-2">
                <Field
                  label="Callout text"
                  value={draft.promo_callout}
                  onChange={v => update('promo_callout', v)}
                  placeholder="HALF OFF AND NO ENROLLMENT"
                />
              </div>
            )}
          </section>

          <section>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={!!draft.allow_secondary_members}
                onChange={e => update('allow_secondary_members', e.target.checked)}
                className="w-4 h-4 mt-0.5"
              />
              <span className="text-sm text-text-primary">
                Allow household / secondary members
                <span className="block text-[10px] text-text-muted">
                  Shows a "Household Members" step on the join flow. Add a plan per household size
                  (set "Covers N total members" on each plan: base = 3, then 4, 5…). The widget
                  auto-picks the plan from the member count.
                </span>
              </span>
            </label>
          </section>

          <section className="flex items-center gap-2">
            <input
              type="checkbox"
              id="type-active"
              checked={!!draft.active}
              onChange={e => update('active', e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="type-active" className="text-sm text-text-primary">Active — show in the public widget</label>
          </section>

          {!isNew && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Plans</p>
              <p className="text-[10px] text-text-muted mb-2">
                {draft.allow_secondary_members
                  ? 'Add one plan per household size — base covers 3, then add 4, 5… each with its own price + ABC payment-plan ID. The join page auto-picks the plan from the member count.'
                  : 'A 1-Year and a Month-to-Month plan, each holding the ABC payment-plan ID and pricing.'}
              </p>
              {plansLoading && <p className="text-xs text-text-muted">Loading plans…</p>}
              <div className="space-y-3">
                {TERMS.map(({ key, label }) => {
                  const termPlans = plansForTerm(key)
                  return (
                    <div key={key} className="bg-bg border border-border rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-semibold text-text-primary">{label}</span>
                        <button onClick={() => addPlan(key)} className="text-xs text-wcs-red hover:underline">
                          + Add {draft.allow_secondary_members ? 'size tier' : 'plan'}
                        </button>
                      </div>
                      {termPlans.length === 0
                        ? <div className="text-[11px] text-text-muted">Not set up yet</div>
                        : (
                          <div className="space-y-1">
                            {termPlans.map(p => (
                              <div key={p.id} className="flex items-center justify-between gap-2">
                                <div className="text-[11px] text-text-muted">
                                  {draft.allow_secondary_members && (
                                    <span className="inline-block px-1.5 py-0.5 mr-2 rounded-full bg-wcs-red/10 text-wcs-red font-medium">Covers {p.max_members || 1}</span>
                                  )}
                                  ${Number(p.today_amount).toFixed(2)} today / ${Number(p.monthly_amount).toFixed(2)} /mo
                                </div>
                                <button onClick={() => setEditingPlan(p)} className="text-xs text-wcs-red hover:underline shrink-0">Edit</button>
                              </div>
                            ))}
                          </div>
                        )
                      }
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 sticky bottom-0 bg-surface">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-60">
            {saving ? 'Saving…' : (isNew ? 'Create type' : 'Save changes')}
          </button>
        </div>
      </div>
    </div>

    {editingPlan && (
      <PlanEditor
        plan={editingPlan}
        locations={locations}
        ageRules={ageRules}
        types={[{ id: type.id, type_label: draft.type_label || type.type_label, wcs_location_id: draft.wcs_location_id }]}
        defaultTerm={editingPlan.term}
        membershipTypeId={type.id}
        onClose={() => setEditingPlan(null)}
        onSaved={() => { setEditingPlan(null); loadPlans() }}
      />
    )}
    </>
  )
}

export default function OnlineJoinTypes() {
  const [types, setTypes] = useState([])
  const [locations, setLocations] = useState([])
  const [ageRules, setAgeRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [locationFilter, setLocationFilter] = useState('')

  async function load() {
    setLoading(true); setError(null)
    try {
      const [typesR, locsR, rulesR] = await Promise.all([
        onlineJoin.listTypes(locationFilter || undefined),
        onlineJoin.listLocations(),
        onlineJoin.listAgeRules(),
      ])
      setTypes(typesR.types || [])
      setLocations(locsR.locations || [])
      setAgeRules(rulesR.age_rules || [])
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [locationFilter])

  async function deactivate(t) {
    if (!confirm(`Deactivate "${t.type_label}"? It will stay in the database but be hidden from the public widget.`)) return
    try {
      await onlineJoin.deactivateType(t.id)
      load()
    } catch (e) {
      alert(e.message || 'Deactivate failed')
    }
  }

  function planCounts(t) {
    const list = t.plans || []
    const has = term => list.some(p => p.term === term)
    return { oneYr: has('1yr'), m2m: has('m2m'), total: list.length }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setLocationFilter('')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${locationFilter === '' ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:border-wcs-red'}`}
          >All</button>
          {locations.map(l => (
            <button
              key={l.wcs_location_id}
              onClick={() => setLocationFilter(l.wcs_location_id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${locationFilter === l.wcs_location_id ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:border-wcs-red'}`}
            >{l.display_name}</button>
          ))}
          <span className="text-xs text-text-muted ml-1">{loading ? 'Loading…' : `${types.length} type${types.length === 1 ? '' : 's'}`}</span>
        </div>
        <button
          onClick={() => setEditing({ _isNew: true, wcs_location_id: locationFilter })}
          disabled={locations.length === 0}
          className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-50"
        >
          + Add Membership Type
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Type</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Location</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Plans</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">Promo</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">Order</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {types.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-text-muted">No membership types yet. Click "Add Membership Type" to create one.</td></tr>
            )}
            {types.map(t => {
              const loc = locations.find(l => l.wcs_location_id === t.wcs_location_id)
              const c = planCounts(t)
              return (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-bg/30">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="text-sm font-semibold text-text-primary">{t.type_label}</div>
                        <div className="text-[10px] text-text-muted font-mono">{t.type_key}</div>
                      </div>
                      {t.badge && <span className="text-[10px] px-1.5 py-0.5 bg-wcs-red/10 text-wcs-red rounded-full font-medium">{t.badge}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">{loc?.display_name || t.wcs_location_id}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c.oneYr ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>1yr</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c.m2m ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>m2m</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {t.promo_code
                      ? <span className="text-[10px] px-1.5 py-0.5 bg-wcs-red/10 text-wcs-red rounded-full font-mono" title={`${t.promo_starts_at || '—'} → ${t.promo_ends_at || '—'}`}>{t.promo_code}</span>
                      : <span className="text-xs text-text-muted">—</span>
                    }
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-text-muted">{t.display_order ?? 0}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${t.active ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                  <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                    <button onClick={() => setEditing(t)} className="text-xs text-wcs-red hover:underline">Edit</button>
                    {t.active && <button onClick={() => deactivate(t)} className="text-xs text-text-muted hover:text-wcs-red">Deactivate</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <TypeEditor
          type={editing}
          locations={locations}
          ageRules={ageRules}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
