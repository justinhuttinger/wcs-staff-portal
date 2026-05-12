import { useState, useEffect, useMemo } from 'react'
import { onlineJoin } from '../../lib/api'

const EMPTY_RULE = {
  name: '',
  min_age: '',
  max_age: '',
  ineligible_message: '',
  active: true,
}

function PreviewAge({ minAge, maxAge, message }) {
  // Pick a representative age that would fail this rule for the preview.
  const min = minAge !== '' && minAge != null ? Number(minAge) : null
  const max = maxAge !== '' && maxAge != null ? Number(maxAge) : null
  let exampleAge = 17
  if (min != null && exampleAge >= min && (max == null || exampleAge <= max)) {
    exampleAge = min > 0 ? min - 1 : 5
  } else if (max != null && exampleAge <= max && (min == null || exampleAge >= min)) {
    exampleAge = max + 1
  }
  return (
    <div className="bg-bg border border-dashed border-border rounded-lg p-3 text-xs">
      <div className="text-text-muted mb-1">A {exampleAge}-year-old who picks a plan with this rule would see:</div>
      <div className="bg-surface border-l-2 border-wcs-red px-3 py-2 italic text-text-primary">
        {message || <span className="text-text-muted opacity-60">(empty — type a message above)</span>}
      </div>
    </div>
  )
}

function RuleEditor({ rule, onClose, onSaved, plansUsing }) {
  const isNew = !rule.id
  const [draft, setDraft] = useState({ ...EMPTY_RULE, ...rule })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function update(key, value) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      const min = draft.min_age === '' || draft.min_age == null ? null : parseInt(draft.min_age)
      const max = draft.max_age === '' || draft.max_age == null ? null : parseInt(draft.max_age)
      if (min != null && max != null && min > max) {
        setError('Min age cannot be greater than max age.')
        setSaving(false)
        return
      }
      const body = {
        name: draft.name.trim(),
        min_age: min,
        max_age: max,
        ineligible_message: draft.ineligible_message,
        active: !!draft.active,
      }
      if (isNew) await onlineJoin.createAgeRule(body)
      else await onlineJoin.updateAgeRule(rule.id, body)
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{isNew ? 'Add Age Rule' : draft.name}</h3>
            <p className="text-xs text-text-muted">{isNew ? 'Create a new age range' : 'Editing age rule'}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

          <label className="block">
            <span className="block text-xs font-medium text-text-muted mb-1">Name <span className="text-wcs-red">*</span></span>
            <input
              type="text"
              value={draft.name}
              onChange={e => update('name', e.target.value)}
              placeholder="Adult, Youth, Senior, etc."
              className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-text-muted mb-1">Min age</span>
              <input
                type="number"
                min="0" max="120"
                value={draft.min_age ?? ''}
                onChange={e => update('min_age', e.target.value)}
                placeholder="Leave blank for no minimum"
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-text-muted mb-1">Max age</span>
              <input
                type="number"
                min="0" max="120"
                value={draft.max_age ?? ''}
                onChange={e => update('max_age', e.target.value)}
                placeholder="Leave blank for no maximum"
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
              />
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-text-muted mb-1">Ineligible message <span className="text-wcs-red">*</span></span>
            <textarea
              value={draft.ineligible_message}
              onChange={e => update('ineligible_message', e.target.value)}
              rows={3}
              placeholder="Shown to users who fall outside this rule's age range."
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
            />
            <span className="block text-[10px] text-text-muted mt-0.5">Be empathetic — this is the user's first taste of what's stopping them.</span>
          </label>

          <PreviewAge minAge={draft.min_age} maxAge={draft.max_age} message={draft.ineligible_message} />

          {!isNew && plansUsing && plansUsing.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs">
              <div className="font-semibold text-blue-900 mb-1">Used by {plansUsing.length} plan{plansUsing.length === 1 ? '' : 's'}</div>
              <ul className="text-blue-900/80 list-disc list-inside space-y-0.5">
                {plansUsing.map(p => <li key={p.id}>{p.plan_label} ({p.wcs_location_id}){p.active ? '' : ' — inactive'}</li>)}
              </ul>
            </div>
          )}

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!draft.active} onChange={e => update('active', e.target.checked)} className="w-4 h-4" />
            <span className="text-sm text-text-primary">Active</span>
          </label>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 sticky bottom-0 bg-surface">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-60">
            {saving ? 'Saving…' : (isNew ? 'Create' : 'Save changes')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function OnlineJoinAgeRules() {
  const [rules, setRules] = useState([])
  const [planCounts, setPlanCounts] = useState({}) // rule_id -> array of plans
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [usingFor, setUsingFor] = useState([])

  async function load() {
    setLoading(true); setError(null)
    try {
      const [rulesR, plansR] = await Promise.all([
        onlineJoin.listAgeRules(),
        onlineJoin.listPlans(),
      ])
      setRules(rulesR.age_rules || [])
      const map = {}
      ;(plansR.plans || []).forEach(p => {
        if (p.age_rule_id) {
          if (!map[p.age_rule_id]) map[p.age_rule_id] = []
          map[p.age_rule_id].push(p)
        }
      })
      setPlanCounts(map)
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function tryDelete(rule) {
    const refs = (planCounts[rule.id] || []).filter(p => p.active)
    if (refs.length > 0) {
      alert(`Cannot delete — ${refs.length} active plan${refs.length === 1 ? '' : 's'} reference this rule. Reassign or deactivate them first.`)
      return
    }
    if (!confirm(`Delete "${rule.name}"? This cannot be undone.`)) return
    try {
      await onlineJoin.deleteAgeRule(rule.id)
      load()
    } catch (e) {
      alert(e.message || 'Delete failed')
    }
  }

  function startEdit(rule) {
    setUsingFor(planCounts[rule.id] || [])
    setEditing(rule)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{loading ? 'Loading…' : `${rules.length} age rule${rules.length === 1 ? '' : 's'}`}</p>
        <button onClick={() => { setUsingFor([]); setEditing({ _isNew: true }) }} className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold">+ Add Rule</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Name</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Range</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Plans using</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Ineligible message</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-text-muted">No age rules yet.</td></tr>
            )}
            {rules.map(r => {
              const usage = planCounts[r.id] || []
              const range =
                r.min_age != null && r.max_age != null ? `${r.min_age}–${r.max_age}`
                : r.min_age != null ? `${r.min_age}+`
                : r.max_age != null ? `≤ ${r.max_age}`
                : 'No restriction'
              return (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg/30">
                  <td className="px-4 py-2 text-sm font-semibold text-text-primary">{r.name}</td>
                  <td className="px-3 py-2 text-xs text-text-muted font-mono">{range}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{usage.length}</td>
                  <td className="px-3 py-2 text-xs text-text-muted truncate max-w-[280px]" title={r.ineligible_message}>
                    {r.ineligible_message || '—'}
                  </td>
                  <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                    <button onClick={() => startEdit(r)} className="text-xs text-wcs-red hover:underline">Edit</button>
                    <button onClick={() => tryDelete(r)} className="text-xs text-text-muted hover:text-wcs-red">Delete</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <RuleEditor
          rule={editing}
          plansUsing={usingFor}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
