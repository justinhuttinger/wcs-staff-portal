import { useState, useEffect } from 'react'
import PlanEditor from './OnlineJoinPlanEditor'
import { onlineJoin } from '../../lib/api'

export function Field({ label, value, onChange, type = 'text', placeholder, hint, required, readOnly, mono }) {
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

export function FeaturesEditor({ value, onChange }) {
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

export { PlanEditor }

export default function OnlineJoinPlans() {
  const [plans, setPlans] = useState([])
  const [locations, setLocations] = useState([])
  const [ageRules, setAgeRules] = useState([])
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [locationFilter, setLocationFilter] = useState('')

  async function load() {
    setLoading(true); setError(null)
    try {
      const [plansR, locsR, rulesR, typesR] = await Promise.all([
        onlineJoin.listPlans(locationFilter || undefined),
        onlineJoin.listLocations(),
        onlineJoin.listAgeRules(),
        onlineJoin.listTypes(),
      ])
      setPlans(plansR.plans || [])
      setLocations(locsR.locations || [])
      setAgeRules(rulesR.age_rules || [])
      setTypes(typesR.types || [])
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  const typeLabel = id => types.find(t => t.id === id)?.type_label

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
          <span className="text-xs text-text-muted ml-1">{loading ? 'Loading…' : `${plans.length} plan${plans.length === 1 ? '' : 's'}`}</span>
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
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Membership type</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-text-muted">Today / Monthly</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Age rule</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">Order</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {plans.length === 0 && !loading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-text-muted">No plans yet. Click "Add Plan" to create one.</td></tr>
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
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {p.membership_type_id
                      ? <span className="text-text-primary">{typeLabel(p.membership_type_id) || 'Unknown type'}{p.term ? <span className="text-text-muted"> · {p.term === '1yr' ? '1-Year' : p.term === 'm2m' ? 'M2M' : p.term}</span> : ''}</span>
                      : <span className="text-text-muted">— unassigned —</span>}
                  </td>
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
          types={types}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
