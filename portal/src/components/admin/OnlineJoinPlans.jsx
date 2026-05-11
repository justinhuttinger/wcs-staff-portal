import { useState, useEffect, useMemo } from 'react'
import { onlineJoin } from '../../lib/api'

const EMPTY_PLAN = {
  wcs_location_id: '',
  plan_key: '',
  plan_label: '',
  plan_description: '',
  features: [],
  badge: '',
  today_amount: '',
  monthly_amount: '',
  display_order: 0,
  payment_plan_id: '',
  plan_validation_hash: '',
  campaign_id: '',
  sales_person_id: '',
  age_rule_id: null,
  active: true,
}

function Field({ label, value, onChange, type = 'text', placeholder, hint, required, monospace }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-text-muted mb-1">
        {label}{required && <span className="text-wcs-red ml-0.5">*</span>}
      </span>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red ${monospace ? 'font-mono' : ''}`}
      />
      {hint && <span className="block text-[10px] text-text-muted mt-0.5">{hint}</span>}
    </label>
  )
}

function FeaturesEditor({ features, onChange }) {
  const list = Array.isArray(features) ? features : []
  function update(i, v) {
    const next = [...list]
    next[i] = v
    onChange(next)
  }
  function add() { onChange([...list, '']) }
  function remove(i) { onChange(list.filter((_, j) => j !== i)) }
  return (
    <div className="space-y-1">
      {list.map((f, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="text"
            value={f}
            onChange={e => update(i, e.target.value)}
            placeholder="e.g. Unlimited gym access"
            className="flex-1 px-3 py-1 bg-bg border border-border rounded-lg text-sm"
          />
          <button onClick={() => remove(i)} className="px-2 py-1 text-xs text-text-muted hover:text-wcs-red" title="Remove">×</button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-wcs-red hover:underline">+ Add feature</button>
    </div>
  )
}

// ---- "Pull from ABC" picker ----
function AbcPlanPicker({ clubNumber, onPick, onClose }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [plans, setPlans] = useState([])
  const [picking, setPicking] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const r = await onlineJoin.abcPlans(clubNumber)
        if (cancelled) return
        // Tolerate different ABC response shapes — pick the first array we find.
        const list = r.plans || r.clubPlans || r.data || (Array.isArray(r) ? r : [])
        setPlans(list)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load plans from ABC')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [clubNumber])

  async function pick(plan) {
    const planId = plan.paymentPlanId || plan.planId || plan.id
    if (!planId) { setError('Plan has no ID field'); return }
    setPicking(planId)
    try {
      const r = await onlineJoin.abcPlanDetails(clubNumber, planId)
      // Try to find the fields ABC returns. We don't know exact field names so
      // attempt the most likely candidates and pass everything back.
      const details = r.plan || r.planDetails || r.data || r
      onPick({
        payment_plan_id: details.paymentPlanId || details.planId || planId,
        plan_validation_hash: details.planValidationHash || details.validationHash || details.hash || '',
        campaign_id: details.campaignId || details.defaultCampaignId || '',
        sales_person_id: details.salesPersonId || details.defaultSalesPersonId || '',
        // Carry over a name suggestion if our label is blank
        _suggested_label: plan.name || plan.planName || details.name || '',
        _suggested_description: plan.description || details.description || '',
        _raw: details,
      })
    } catch (e) {
      setError(e.message || 'Failed to load plan details from ABC')
      setPicking(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between sticky top-0 bg-surface">
          <div>
            <h3 className="text-base font-bold text-text-primary">Pull from ABC</h3>
            <p className="text-xs text-text-muted">Club {clubNumber} — pick a plan to autofill IDs</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-4 space-y-2">
          {loading && <p className="text-sm text-text-muted text-center py-4">Loading from ABC…</p>}
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}
          {!loading && !error && plans.length === 0 && <p className="text-sm text-text-muted text-center py-4">No plans returned by ABC for this club.</p>}
          {plans.map((p, i) => {
            const id = p.paymentPlanId || p.planId || p.id || `idx-${i}`
            const name = p.name || p.planName || p.description || `Plan ${i + 1}`
            const isPicking = picking === id
            return (
              <button
                key={id}
                onClick={() => pick(p)}
                disabled={!!picking}
                className="w-full text-left px-3 py-2 bg-bg border border-border rounded-lg hover:bg-surface disabled:opacity-50"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{name}</p>
                    <p className="text-[10px] text-text-muted font-mono truncate">{id}</p>
                  </div>
                  {isPicking && <span className="text-xs text-wcs-red">Loading details…</span>}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function PlanEditor({ plan, locations, ageRules, onClose, onSaved }) {
  const isNew = !plan.id
  const [draft, setDraft] = useState({ ...EMPTY_PLAN, ...plan })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showAbcPicker, setShowAbcPicker] = useState(false)
  const [abcAutofillNote, setAbcAutofillNote] = useState(null)

  function update(key, value) { setDraft(d => ({ ...d, [key]: value })) }

  const selectedLocation = locations.find(l => l.wcs_location_id === draft.wcs_location_id)

  function applyAbcPick(picked) {
    setDraft(d => ({
      ...d,
      payment_plan_id: picked.payment_plan_id || d.payment_plan_id,
      plan_validation_hash: picked.plan_validation_hash || d.plan_validation_hash,
      campaign_id: picked.campaign_id || d.campaign_id,
      sales_person_id: picked.sales_person_id || d.sales_person_id,
      plan_label: d.plan_label || picked._suggested_label || '',
      plan_description: d.plan_description || picked._suggested_description || '',
    }))
    setShowAbcPicker(false)
    setAbcAutofillNote(`Filled from ABC. Verify hash + IDs below.`)
    setTimeout(() => setAbcAutofillNote(null), 4000)
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      const payload = {
        ...draft,
        today_amount: parseFloat(draft.today_amount) || 0,
        monthly_amount: parseFloat(draft.monthly_amount) || 0,
        display_order: parseInt(draft.display_order, 10) || 0,
        features: Array.isArray(draft.features) ? draft.features.filter(Boolean) : [],
      }
      if (isNew) {
        await onlineJoin.createPlan(payload)
      } else {
        const { id, wcs_location_id, plan_key, ...patch } = payload
        await onlineJoin.updatePlan(plan.id, patch)
      }
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{isNew ? 'Add Plan' : draft.plan_label}</h3>
            <p className="text-xs text-text-muted">{isNew ? 'Create a new plan' : `Editing ${draft.plan_key} at ${draft.wcs_location_id}`}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}
          {abcAutofillNote && <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2 text-xs">{abcAutofillNote}</div>}

          {/* Location + plan key (only on create) */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Identity</p>
            <div className="grid grid-cols-2 gap-3">
              {isNew ? (
                <label className="block">
                  <span className="block text-xs font-medium text-text-muted mb-1">Location<span className="text-wcs-red ml-0.5">*</span></span>
                  <select value={draft.wcs_location_id} onChange={e => update('wcs_location_id', e.target.value)}
                    className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm">
                    <option value="">Select…</option>
                    {locations.filter(l => l.active).map(l => <option key={l.wcs_location_id} value={l.wcs_location_id}>{l.display_name}</option>)}
                  </select>
                </label>
              ) : (
                <Field label="Location" value={draft.wcs_location_id} onChange={() => {}} hint="Permanent" />
              )}
              {isNew ? (
                <Field label="Plan key" value={draft.plan_key} onChange={v => update('plan_key', v.toLowerCase().replace(/\s+/g, '-'))} placeholder="standard-monthly" required hint="Permanent slug." />
              ) : (
                <Field label="Plan key" value={draft.plan_key} onChange={() => {}} hint="Permanent" />
              )}
            </div>
          </section>

          {/* Marketing */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Marketing</p>
            <div className="space-y-3">
              <Field label="Plan label" value={draft.plan_label} onChange={v => update('plan_label', v)} placeholder="Standard Membership" required />
              <label className="block">
                <span className="block text-xs font-medium text-text-muted mb-1">Plan description</span>
                <textarea value={draft.plan_description} onChange={e => update('plan_description', e.target.value)} rows={2}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm" />
              </label>
              <div>
                <span className="block text-xs font-medium text-text-muted mb-1">Features</span>
                <FeaturesEditor features={draft.features} onChange={v => update('features', v)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Today amount ($)" type="number" value={draft.today_amount} onChange={v => update('today_amount', v)} placeholder="99.00" required />
                <Field label="Monthly amount ($)" type="number" value={draft.monthly_amount} onChange={v => update('monthly_amount', v)} placeholder="49.00" required />
                <Field label="Badge" value={draft.badge} onChange={v => update('badge', v)} placeholder='"Most Popular", "Best Value"…' />
                <Field label="Display order" type="number" value={draft.display_order} onChange={v => update('display_order', v)} placeholder="0" hint="Lower = shown first" />
              </div>
            </div>
          </section>

          {/* ABC integration */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">ABC integration</p>
              <button
                onClick={() => setShowAbcPicker(true)}
                disabled={!selectedLocation?.abc_club_number}
                className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-wcs-red text-wcs-red hover:bg-wcs-red hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={!selectedLocation?.abc_club_number ? 'Select a location first' : `Pull plans from ABC for club ${selectedLocation.abc_club_number}`}
              >
                ⤓ Pull from ABC
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment Plan ID" value={draft.payment_plan_id} onChange={v => update('payment_plan_id', v)} required monospace />
              <Field label="Plan Validation Hash" value={draft.plan_validation_hash} onChange={v => update('plan_validation_hash', v)} required monospace />
              <Field label="Campaign ID" value={draft.campaign_id} onChange={v => update('campaign_id', v)} monospace hint="Optional" />
              <Field label="Sales Person ID" value={draft.sales_person_id} onChange={v => update('sales_person_id', v)} monospace hint="Optional" />
            </div>
          </section>

          {/* Eligibility */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Eligibility</p>
            <label className="block">
              <span className="block text-xs font-medium text-text-muted mb-1">Age rule</span>
              <select value={draft.age_rule_id || ''} onChange={e => update('age_rule_id', e.target.value || null)}
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm">
                <option value="">No age restriction</option>
                {ageRules.filter(r => r.active).map(r => {
                  const range = r.min_age != null && r.max_age != null ? `${r.min_age}–${r.max_age}` : r.min_age != null ? `${r.min_age}+` : r.max_age != null ? `0–${r.max_age}` : 'Any'
                  return <option key={r.id} value={r.id}>{r.name} ({range})</option>
                })}
              </select>
            </label>
          </section>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="plan-active" checked={!!draft.active} onChange={e => update('active', e.target.checked)} className="w-4 h-4" />
            <label htmlFor="plan-active" className="text-sm text-text-primary">Active — show in the public widget</label>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 sticky bottom-0 bg-surface">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-60">
            {saving ? 'Saving…' : (isNew ? 'Create' : 'Save changes')}
          </button>
        </div>
      </div>

      {showAbcPicker && selectedLocation?.abc_club_number && (
        <AbcPlanPicker
          clubNumber={selectedLocation.abc_club_number}
          onPick={applyAbcPick}
          onClose={() => setShowAbcPicker(false)}
        />
      )}
    </div>
  )
}

export default function OnlineJoinPlans() {
  const [plans, setPlans] = useState([])
  const [locations, setLocations] = useState([])
  const [ageRules, setAgeRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterLocation, setFilterLocation] = useState('all')
  const [editing, setEditing] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const [plansRes, locsRes, rulesRes] = await Promise.all([
        onlineJoin.listPlans(),
        onlineJoin.listLocations(),
        onlineJoin.listAgeRules(),
      ])
      setPlans(plansRes.plans || [])
      setLocations(locsRes.locations || [])
      setAgeRules(rulesRes.age_rules || [])
    } catch (e) {
      setError(e.message || 'Failed to load plans')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (filterLocation === 'all') return plans
    return plans.filter(p => p.wcs_location_id === filterLocation)
  }, [plans, filterLocation])

  async function deactivate(plan) {
    if (!confirm(`Deactivate "${plan.plan_label}"? It will be hidden from the public widget but kept for signup-history integrity.`)) return
    try {
      await onlineJoin.deactivatePlan(plan.id)
      load()
    } catch (e) { alert(e.message || 'Deactivate failed') }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Location:</span>
          <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)} className="px-2 py-1 bg-bg border border-border rounded-lg text-xs">
            <option value="all">All ({plans.length})</option>
            {locations.map(l => <option key={l.wcs_location_id} value={l.wcs_location_id}>{l.display_name}</option>)}
          </select>
          {!loading && <span className="text-xs text-text-muted">· {filtered.length} shown</span>}
        </div>
        <button onClick={() => setEditing({})} className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold">+ Add Plan</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Plan</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Location</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">Today</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">Monthly</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Age rule</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Badge</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-text-muted">No plans yet. Add one to get started.</td></tr>
            )}
            {filtered.map(p => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-bg/30">
                <td className="px-4 py-2">
                  <div className="text-sm font-semibold text-text-primary">{p.plan_label}</div>
                  <div className="text-[10px] text-text-muted font-mono">{p.plan_key}</div>
                </td>
                <td className="px-3 py-2 text-xs text-text-muted">{p.wcs_location_id}</td>
                <td className="px-3 py-2 text-right text-xs text-text-primary">${Number(p.today_amount).toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-xs text-text-primary">${Number(p.monthly_amount).toFixed(2)}/mo</td>
                <td className="px-3 py-2 text-xs text-text-muted">{p.age_rule?.name || '—'}</td>
                <td className="px-3 py-2 text-xs text-text-muted">{p.badge || '—'}</td>
                <td className="px-3 py-2 text-center"><span className={`inline-block w-2 h-2 rounded-full ${p.active ? 'bg-green-500' : 'bg-gray-300'}`} /></td>
                <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                  <button onClick={() => setEditing(p)} className="text-xs text-wcs-red hover:underline">Edit</button>
                  {p.active && <button onClick={() => deactivate(p)} className="text-xs text-text-muted hover:text-wcs-red">Deactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <PlanEditor
          plan={editing}
          locations={locations}
          ageRules={ageRules}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
