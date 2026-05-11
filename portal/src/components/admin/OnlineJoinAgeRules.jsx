import { useState, useEffect, useMemo } from 'react'
import { onlineJoin } from '../../lib/api'

const EMPTY_RULE = {
  name: '',
  min_age: null,
  max_age: null,
  ineligible_message: '',
  active: true,
}

function previewAge(rule, age) {
  if (rule.min_age != null && age < rule.min_age) return rule.ineligible_message
  if (rule.max_age != null && age > rule.max_age) return rule.ineligible_message
  return null
}

function AgeRuleEditor({ rule, onClose, onSaved }) {
  const isNew = !rule.id
  const [draft, setDraft] = useState({ ...EMPTY_RULE, ...rule })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [plansUsing, setPlansUsing] = useState([])
  const [deleting, setDeleting] = useState(false)
  const [previewAgeValue, setPreviewAgeValue] = useState(15)

  useEffect(() => {
    if (rule.id) {
      onlineJoin.getAgeRule(rule.id)
        .then(r => setPlansUsing(r.plans_using || []))
        .catch(() => {})
    }
  }, [rule.id])

  function update(key, value) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  function parseInteger(v) {
    if (v === '' || v == null) return null
    const n = parseInt(v, 10)
    return Number.isNaN(n) ? null : n
  }

  const validationError = (() => {
    if (!draft.name?.trim()) return 'Name is required'
    if (!draft.ineligible_message?.trim()) return 'Ineligible message is required'
    if (draft.min_age != null && draft.max_age != null && draft.min_age > draft.max_age) return 'Min age must be ≤ max age'
    return null
  })()

  async function save() {
    if (validationError) { setError(validationError); return }
    setSaving(true); setError(null)
    try {
      if (isNew) {
        await onlineJoin.createAgeRule(draft)
      } else {
        await onlineJoin.updateAgeRule(rule.id, draft)
      }
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function destroy() {
    if (plansUsing.filter(p => p.active).length > 0) return
    if (!confirm(`Delete age rule "${draft.name}"? This cannot be undone.`)) return
    setDeleting(true); setError(null)
    try {
      await onlineJoin.deleteAgeRule(rule.id)
      onSaved()
    } catch (e) {
      setError(e.message || 'Delete failed')
      if (e?.plans_using) setPlansUsing(e.plans_using)
    } finally {
      setDeleting(false)
    }
  }

  const previewMessage = previewAge(draft, previewAgeValue)
  const activeReferencing = plansUsing.filter(p => p.active).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{isNew ? 'Add Age Rule' : draft.name}</h3>
            {!isNew && <p className="text-xs text-text-muted">Used by {plansUsing.length} plan{plansUsing.length === 1 ? '' : 's'} ({activeReferencing} active)</p>}
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

          <label className="block">
            <span className="block text-xs font-medium text-text-muted mb-1">Name<span className="text-wcs-red ml-0.5">*</span></span>
            <input type="text" value={draft.name} onChange={e => update('name', e.target.value)}
              placeholder="Adult, Youth, Senior…"
              className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-text-muted mb-1">Min age (inclusive)</span>
              <input type="number" value={draft.min_age == null ? '' : draft.min_age}
                onChange={e => update('min_age', parseInteger(e.target.value))}
                placeholder="—"
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red" />
              <span className="block text-[10px] text-text-muted mt-0.5">Blank = no minimum</span>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-text-muted mb-1">Max age (inclusive)</span>
              <input type="number" value={draft.max_age == null ? '' : draft.max_age}
                onChange={e => update('max_age', parseInteger(e.target.value))}
                placeholder="—"
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red" />
              <span className="block text-[10px] text-text-muted mt-0.5">Blank = no maximum</span>
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-text-muted mb-1">Ineligible message<span className="text-wcs-red ml-0.5">*</span></span>
            <textarea value={draft.ineligible_message} onChange={e => update('ineligible_message', e.target.value)}
              rows={3}
              placeholder="Shown to a user whose DOB falls outside this rule's range."
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red" />
          </label>

          {/* Live preview */}
          <div className="bg-bg/60 border border-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Preview</span>
              <input type="number" value={previewAgeValue}
                onChange={e => setPreviewAgeValue(parseInt(e.target.value, 10) || 0)}
                className="w-16 px-2 py-0.5 bg-surface border border-border rounded text-xs" />
              <span className="text-xs text-text-muted">years old</span>
            </div>
            {previewMessage ? (
              <p className="text-sm text-red-700 italic">"{previewMessage}"</p>
            ) : (
              <p className="text-sm text-green-700">✓ Eligible — would proceed to payment</p>
            )}
          </div>

          {plansUsing.length > 0 && (
            <div className="bg-bg/60 border border-border rounded-lg p-3">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Plans using this rule</p>
              <ul className="text-xs space-y-0.5">
                {plansUsing.map(p => (
                  <li key={p.id} className={p.active ? 'text-text-primary' : 'text-text-muted line-through'}>
                    {p.plan_label} <span className="font-mono text-text-muted">({p.wcs_location_id})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input type="checkbox" id="rule-active" checked={!!draft.active} onChange={e => update('active', e.target.checked)} className="w-4 h-4" />
            <label htmlFor="rule-active" className="text-sm text-text-primary">Active</label>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between sticky bottom-0 bg-surface">
          {!isNew && (
            <button
              onClick={destroy}
              disabled={deleting || activeReferencing > 0}
              title={activeReferencing > 0 ? 'Deactivate or reassign the plans using this rule first' : ''}
              className="px-3 py-1.5 rounded-lg text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">Cancel</button>
            <button onClick={save} disabled={saving || !!validationError} className="px-4 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-60">
              {saving ? 'Saving…' : (isNew ? 'Create' : 'Save changes')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function OnlineJoinAgeRules() {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [plansByRule, setPlansByRule] = useState({}) // optional: lightweight count for table

  async function load() {
    setLoading(true); setError(null)
    try {
      const [rulesRes, plansRes] = await Promise.all([
        onlineJoin.listAgeRules(),
        onlineJoin.listPlans().catch(() => ({ plans: [] })),
      ])
      setRules(rulesRes.age_rules || [])
      const byRule = {}
      for (const p of (plansRes.plans || [])) {
        if (!p.age_rule_id) continue
        if (!byRule[p.age_rule_id]) byRule[p.age_rule_id] = 0
        byRule[p.age_rule_id]++
      }
      setPlansByRule(byRule)
    } catch (e) {
      setError(e.message || 'Failed to load age rules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function formatRange(r) {
    if (r.min_age != null && r.max_age != null) return `${r.min_age}–${r.max_age}`
    if (r.min_age != null) return `${r.min_age}+`
    if (r.max_age != null) return `0–${r.max_age}`
    return 'Any'
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{loading ? 'Loading…' : `${rules.length} rule${rules.length === 1 ? '' : 's'}`}</p>
        <button onClick={() => setEditing({})} className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold">+ Add Age Rule</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Name</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Age</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Message preview</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">Plans</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && !loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-text-muted">No age rules yet.</td></tr>
            )}
            {rules.map(r => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg/30">
                <td className="px-4 py-2 text-sm font-semibold text-text-primary">{r.name}</td>
                <td className="px-3 py-2 text-sm text-text-muted whitespace-nowrap">{formatRange(r)}</td>
                <td className="px-3 py-2 text-xs text-text-muted truncate max-w-[400px]" title={r.ineligible_message}>{r.ineligible_message}</td>
                <td className="px-3 py-2 text-center text-xs text-text-muted">{plansByRule[r.id] || 0}</td>
                <td className="px-3 py-2 text-center"><span className={`inline-block w-2 h-2 rounded-full ${r.active ? 'bg-green-500' : 'bg-gray-300'}`} /></td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setEditing(r)} className="text-xs text-wcs-red hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <AgeRuleEditor
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
