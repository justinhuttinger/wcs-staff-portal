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

function Field({ label, value, onChange, type = 'text', placeholder, hint, required, readOnly, mono }) {
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
        readOnly={readOnly}
        className={`w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red ${readOnly ? 'opacity-60 cursor-not-allowed' : ''} ${mono ? 'font-mono' : ''}`}
      />
      {hint && <span className="block text-[10px] text-text-muted mt-0.5">{hint}</span>}
    </label>
  )
}

function pickField(obj, candidates) {
  for (const k of candidates) {
    if (obj && obj[k] != null && obj[k] !== '') return obj[k]
  }
  return ''
}

function PullFromAbcModal({ clubNumber, locationLabel, onPick, onClose }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [plans, setPlans] = useState([])
  const [filter, setFilter] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null)
      try {
        const r = await onlineJoin.abcPlans(clubNumber)
        // ABC's response shape varies — common shapes:
        //   { plans: [{...}] } | { result: [{...}] } | { paymentPlans: [...] } | [...]
        const list =
          (Array.isArray(r) && r) ||
          r.plans || r.paymentPlans || r.result?.plans || r.result || r.data || []
        setPlans(Array.isArray(list) ? list : [])
      } catch (e) {
        setError(e.message || 'Failed to load ABC plans')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [clubNumber])

  const filtered = useMemo(() => {
    if (!filter.trim()) return plans
    const q = filter.toLowerCase()
    return plans.filter(p => JSON.stringify(p).toLowerCase().includes(q))
  }, [plans, filter])

  async function choose(p) {
    const id = pickField(p, ['paymentPlanId', 'planId', 'id', 'plan_id'])
    const name = pickField(p, ['name', 'planName', 'description', 'planDescription'])
    let detail = p
    if (id) {
      try {
        setDetailLoading(true)
        const r = await onlineJoin.abcPlanDetails(clubNumber, id)
        // Same defensive unwrap.
        detail = r.plan || r.paymentPlan || r.result || r.data || r || p
      } catch {
        // fall through with the list-row data we already have
      } finally {
        setDetailLoading(false)
      }
    }

    const mapped = {
      payment_plan_id: pickField(detail, ['paymentPlanId', 'planId', 'id', 'plan_id']) || id || '',
      plan_validation_hash: pickField(detail, ['planValidationHash', 'validationHash', 'plan_validation_hash', 'hash']) || '',
      plan_label: pickField(detail, ['name', 'planName', 'description', 'planDescription']) || name || '',
      campaign_id: pickField(detail, ['campaignId', 'campaign_id']) || '',
      sales_person_id: pickField(detail, ['salesPersonId', 'sales_person_id']) || '',
      today_amount: pickField(detail, ['firstPaymentAmount', 'todayAmount', 'today_amount', 'downPayment']) || '',
      monthly_amount: pickField(detail, ['monthlyDueAmount', 'monthlyAmount', 'monthly_amount', 'paymentAmount']) || '',
      _raw: detail,
    }
    onPick(mapped)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-lg font-bold text-text-primary">Pull from ABC</h3>
            <p className="text-xs text-text-muted">{locationLabel} (club #{clubNumber})</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-3">
          <input
            type="text"
            placeholder="Filter plans…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
          />

          {loading && <p className="text-sm text-text-muted text-center py-8">Loading plans from ABC…</p>}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              {typeof error === 'string' ? error : JSON.stringify(error)}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <p className="text-sm text-text-muted text-center py-8">No plans returned by ABC.</p>
          )}
          {!loading && filtered.length > 0 && (
            <div className="space-y-1.5">
              {filtered.map((p, i) => {
                const id = pickField(p, ['paymentPlanId', 'planId', 'id', 'plan_id'])
                const name = pickField(p, ['name', 'planName', 'description', 'planDescription'])
                const today = pickField(p, ['firstPaymentAmount', 'todayAmount', 'downPayment'])
                const monthly = pickField(p, ['monthlyDueAmount', 'monthlyAmount', 'paymentAmount'])
                return (
                  <button
                    key={id || i}
                    onClick={() => choose(p)}
                    disabled={detailLoading}
                    className="w-full text-left px-3 py-2 bg-bg hover:bg-bg/70 border border-border hover:border-wcs-red rounded-lg transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text-primary truncate">{name || `Plan ${id}`}</div>
                        <div className="text-[10px] font-mono text-text-muted">{id}</div>
                      </div>
                      <div className="text-right text-xs text-text-muted shrink-0">
                        {today !== '' && <div>${Number(today).toFixed(2)} today</div>}
                        {monthly !== '' && <div>${Number(monthly).toFixed(2)} /mo</div>}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {detailLoading && <p className="text-xs text-text-muted text-center">Fetching plan details…</p>}
        </div>
      </div>
    </div>
  )
}

function FeaturesEditor({ value, onChange }) {
  const features = Array.isArray(value) ? value : []
  function update(i, v) {
    const next = features.slice()
    next[i] = v
    onChange(next)
  }
  function add() {
    onChange([...features, ''])
  }
  function remove(i) {
    onChange(features.filter((_, idx) => idx !== i))
  }
  return (
    <div className="space-y-2">
      {features.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={f}
            onChange={e => update(i, e.target.value)}
            placeholder="e.g. Unlimited gym access"
            className="flex-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
          />
          <button onClick={() => remove(i)} className="text-xs text-text-muted hover:text-wcs-red px-2">Remove</button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-wcs-red hover:underline">+ Add feature</button>
    </div>
  )
}

function PlanEditor({ plan, locations, ageRules, onClose, onSaved }) {
  const isNew = !plan.id
  const [draft, setDraft] = useState(() => ({ ...EMPTY_PLAN, ...plan, features: Array.isArray(plan.features) ? plan.features : [] }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showAbcPicker, setShowAbcPicker] = useState(false)

  function update(key, value) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  const selectedLocation = locations.find(l => l.wcs_location_id === draft.wcs_location_id)

  async function save() {
    setSaving(true); setError(null)
    try {
      const body = {
        wcs_location_id: draft.wcs_location_id,
        plan_key: draft.plan_key,
        plan_label: draft.plan_label,
        plan_description: draft.plan_description || null,
        features: draft.features,
        badge: draft.badge || null,
        today_amount: parseFloat(draft.today_amount),
        monthly_amount: parseFloat(draft.monthly_amount),
        display_order: parseInt(draft.display_order) || 0,
        payment_plan_id: draft.payment_plan_id,
        plan_validation_hash: draft.plan_validation_hash,
        campaign_id: draft.campaign_id || null,
        sales_person_id: draft.sales_person_id || null,
        age_rule_id: draft.age_rule_id || null,
        active: !!draft.active,
      }
      if (isNew) {
        await onlineJoin.createPlan(body)
      } else {
        // PATCH doesn't accept plan_key changes on existing rows (unique constraint)
        const { plan_key, wcs_location_id, ...patch } = body
        await onlineJoin.updatePlan(plan.id, patch)
      }
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function applyAbcPick(pick) {
    setShowAbcPicker(false)
    setDraft(d => ({
      ...d,
      payment_plan_id: pick.payment_plan_id || d.payment_plan_id,
      plan_validation_hash: pick.plan_validation_hash || d.plan_validation_hash,
      plan_label: d.plan_label || pick.plan_label,
      campaign_id: pick.campaign_id || d.campaign_id,
      sales_person_id: pick.sales_person_id || d.sales_person_id,
      today_amount: d.today_amount || pick.today_amount,
      monthly_amount: d.monthly_amount || pick.monthly_amount,
    }))
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{isNew ? 'Add Plan' : (draft.plan_label || draft.plan_key)}</h3>
            <p className="text-xs text-text-muted">{isNew ? 'Create a new online-join plan' : `Editing ${draft.plan_key}`}</p>
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
              {isNew
                ? <Field label="Plan key (slug)" value={draft.plan_key} onChange={v => update('plan_key', v.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="standard-monthly" required hint="Permanent slug; unique per location." />
                : <Field label="Plan key" value={draft.plan_key} onChange={() => {}} readOnly hint="Permanent — cannot change." />
              }
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">ABC integration</p>
              <button
                onClick={() => setShowAbcPicker(true)}
                disabled={!selectedLocation?.abc_club_number}
                className="px-2.5 py-1 rounded-md bg-wcs-red text-white text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                title={selectedLocation?.abc_club_number ? '' : 'Pick a location first'}
              >
                Pull from ABC ↓
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment Plan ID" value={draft.payment_plan_id} onChange={v => update('payment_plan_id', v)} required mono hint="ABC's paymentPlanId." />
              <Field label="Plan Validation Hash" value={draft.plan_validation_hash} onChange={v => update('plan_validation_hash', v)} required mono hint="ABC's planValidationHash." />
              <Field label="Campaign ID (optional)" value={draft.campaign_id} onChange={v => update('campaign_id', v)} mono />
              <Field label="Salesperson ID (optional)" value={draft.sales_person_id} onChange={v => update('sales_person_id', v)} mono />
            </div>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Marketing</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plan label" value={draft.plan_label} onChange={v => update('plan_label', v)} required placeholder="Standard Membership" />
              <Field label="Badge (optional)" value={draft.badge} onChange={v => update('badge', v)} placeholder="Most Popular" />
              <Field label="Today amount ($)" type="number" value={draft.today_amount} onChange={v => update('today_amount', v)} required placeholder="99.00" />
              <Field label="Monthly amount ($)" type="number" value={draft.monthly_amount} onChange={v => update('monthly_amount', v)} required placeholder="49.00" />
              <Field label="Display order" type="number" value={draft.display_order} onChange={v => update('display_order', v)} />
            </div>
            <div className="mt-3">
              <span className="block text-xs font-medium text-text-muted mb-1">Description</span>
              <textarea
                value={draft.plan_description || ''}
                onChange={e => update('plan_description', e.target.value)}
                rows={2}
                placeholder="Short marketing copy under the plan label."
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
              />
            </div>
            <div className="mt-3">
              <span className="block text-xs font-medium text-text-muted mb-1">Features</span>
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

          <section className="flex items-center gap-2">
            <input
              type="checkbox"
              id="plan-active"
              checked={!!draft.active}
              onChange={e => update('active', e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="plan-active" className="text-sm text-text-primary">Active — show in the public widget</label>
          </section>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 sticky bottom-0 bg-surface">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-60">
            {saving ? 'Saving…' : (isNew ? 'Create plan' : 'Save changes')}
          </button>
        </div>
      </div>
    </div>

    {showAbcPicker && selectedLocation && (
      <PullFromAbcModal
        clubNumber={selectedLocation.abc_club_number}
        locationLabel={selectedLocation.display_name}
        onPick={applyAbcPick}
        onClose={() => setShowAbcPicker(false)}
      />
    )}
    </>
  )
}

export default function OnlineJoinPlans() {
  const [plans, setPlans] = useState([])
  const [locations, setLocations] = useState([])
  const [ageRules, setAgeRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [locationFilter, setLocationFilter] = useState('')

  async function load() {
    setLoading(true); setError(null)
    try {
      const [plansR, locsR, rulesR] = await Promise.all([
        onlineJoin.listPlans(locationFilter || undefined),
        onlineJoin.listLocations(),
        onlineJoin.listAgeRules(),
      ])
      setPlans(plansR.plans || [])
      setLocations(locsR.locations || [])
      setAgeRules(rulesR.age_rules || [])
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [locationFilter])

  async function deactivate(p) {
    if (!confirm(`Deactivate "${p.plan_label}"? It will stay in the database but be hidden from the public widget.`)) return
    try {
      await onlineJoin.deactivatePlan(p.id)
      load()
    } catch (e) {
      alert(e.message || 'Deactivate failed')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">Filter by location:</label>
          <select
            value={locationFilter}
            onChange={e => setLocationFilter(e.target.value)}
            className="px-2.5 py-1 bg-bg border border-border rounded-lg text-xs focus:outline-none focus:border-wcs-red"
          >
            <option value="">All locations</option>
            {locations.map(l => (
              <option key={l.wcs_location_id} value={l.wcs_location_id}>{l.display_name}</option>
            ))}
          </select>
          <p className="text-xs text-text-muted ml-2">{loading ? 'Loading…' : `${plans.length} plan${plans.length === 1 ? '' : 's'}`}</p>
        </div>
        <button
          onClick={() => setEditing({ _isNew: true, wcs_location_id: locationFilter })}
          disabled={locations.length === 0}
          className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-50"
        >
          + Add Plan
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Plan</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Location</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">Today / Monthly</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Age rule</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">Order</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {plans.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-text-muted">No plans yet. Click "Add Plan" to create one.</td></tr>
            )}
            {plans.map(p => {
              const loc = locations.find(l => l.wcs_location_id === p.wcs_location_id)
              return (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-bg/30">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="text-sm font-semibold text-text-primary">{p.plan_label}</div>
                        <div className="text-[10px] text-text-muted font-mono">{p.plan_key}</div>
                      </div>
                      {p.badge && <span className="text-[10px] px-1.5 py-0.5 bg-wcs-red/10 text-wcs-red rounded-full font-medium">{p.badge}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">{loc?.display_name || p.wcs_location_id}</td>
                  <td className="px-3 py-2 text-right text-xs font-mono text-text-muted whitespace-nowrap">
                    ${Number(p.today_amount).toFixed(2)} / ${Number(p.monthly_amount).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">{p.age_rule?.name || '—'}</td>
                  <td className="px-3 py-2 text-center text-xs text-text-muted">{p.display_order ?? 0}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${p.active ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                  <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                    <button onClick={() => setEditing(p)} className="text-xs text-wcs-red hover:underline">Edit</button>
                    {p.active && <button onClick={() => deactivate(p)} className="text-xs text-text-muted hover:text-wcs-red">Deactivate</button>}
                  </td>
                </tr>
              )
            })}
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
