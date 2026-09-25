import { useEffect, useState } from 'react'
import { saveAdmin } from '../../../lib/api'
import { Card, Toggle, inputClass, btnPrimary } from './shared'

// Cancel rules per plan kind (save_cancel_rules, migration 213). The wcs-save
// Worker reads these to work out what a member owes to cancel. The three rows
// are fixed by the migration; only the numbers and the staff toggle change here.
const PLAN_INFO = {
  month_to_month: 'ABC term Open (billed monthly or bi-weekly)',
  contract: 'ABC term Installment',
  prepaid: 'ABC term Cash or Cash Open',
}

function dollars(n) {
  const v = Number(n)
  return Number.isFinite(v) ? `$${v.toFixed(2)}` : '$0.00'
}

function toForm(rule) {
  return {
    notice_days: String(rule?.notice_days ?? 0),
    early_cancel_fee: Number(rule?.early_cancel_fee ?? 0).toFixed(2),
    send_to_staff: !!rule?.send_to_staff,
  }
}

// Plain-English summary of what the member owes, built from the live form.
function describeRule(planKind, f) {
  if (f.send_to_staff) {
    return 'Members on this plan cannot cancel online. Their request goes to staff to finish.'
  }
  const parts = []
  const days = Number(f.notice_days)
  if (Number.isInteger(days) && days > 0) {
    parts.push(`If the next payment is ${days} day${days === 1 ? '' : 's'} away or less, the member pays it to cancel.`)
  } else {
    parts.push('The member does not owe the next payment to cancel.')
  }
  if (planKind === 'contract') {
    const fee = Number(f.early_cancel_fee)
    parts.push(fee > 0
      ? `Cancelling before the contract end date adds a ${dollars(fee)} fee.`
      : 'There is no fee for cancelling before the contract end date.')
  }
  return parts.join(' ')
}

function RuleCard({ rule, onSaved }) {
  const [f, setF] = useState(() => toForm(rule))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const isContract = rule.plan_kind === 'contract'
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(rule))

  function set(key, value) {
    setF(prev => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }))
    setMsg('')
  }

  async function save() {
    const problems = {}
    const days = Number(f.notice_days)
    if (f.notice_days.trim() === '' || !Number.isInteger(days) || days < 0 || days > 90) {
      problems.notice_days = 'Enter a whole number of days from 0 to 90'
    }
    const fee = Number(f.early_cancel_fee)
    if (isContract && (f.early_cancel_fee.trim() === '' || !Number.isFinite(fee) || fee < 0)) {
      problems.early_cancel_fee = 'Enter a fee of 0 or more'
    }
    if (Object.keys(problems).length) {
      setErrors(problems)
      setMsg('Check the highlighted fields')
      return
    }
    const body = { notice_days: days, send_to_staff: f.send_to_staff }
    // The fee only applies to contracts, so other plans never send it.
    if (isContract) body.early_cancel_fee = fee
    setSaving(true)
    setMsg('')
    try {
      const r = await saveAdmin.updateRule(rule.plan_kind, body)
      onSaved(r.rule)
      setF(toForm(r.rule))
      setMsg('Saved')
      setTimeout(() => setMsg(''), 1500)
    } catch (e) {
      if (e.fields) setErrors(e.fields)
      setMsg(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold text-text-primary">{rule.label}</h3>
        <p className="text-xs text-text-muted mt-1">{PLAN_INFO[rule.plan_kind] || rule.plan_kind}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Notice period (days)</label>
          <input type="number" min="0" max="90" step="1" inputMode="numeric" value={f.notice_days}
            onChange={e => set('notice_days', e.target.value)} className={inputClass(errors.notice_days)} />
          {errors.notice_days
            ? <p className="text-xs text-wcs-red mt-1">{errors.notice_days}</p>
            : <p className="text-xs text-text-muted mt-1">0 means the member never owes the next payment.</p>}
        </div>
        {isContract && (
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Early cancellation fee ($)</label>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={f.early_cancel_fee}
              onChange={e => set('early_cancel_fee', e.target.value)} className={inputClass(errors.early_cancel_fee)} />
            {errors.early_cancel_fee
              ? <p className="text-xs text-wcs-red mt-1">{errors.early_cancel_fee}</p>
              : <p className="text-xs text-text-muted mt-1">Charged when cancelling before the contract end date.</p>}
          </div>
        )}
      </div>

      <div className="flex items-start gap-3">
        <Toggle checked={f.send_to_staff} onChange={v => set('send_to_staff', v)}
          label="Send to staff instead of cancelling online" />
        <div>
          <p className="text-sm font-medium text-text-primary">Send to staff instead of cancelling online</p>
          <p className="text-xs text-text-muted">The member submits a request and staff finishes the cancel in ABC.</p>
          {errors.send_to_staff && <p className="text-xs text-wcs-red mt-1">{errors.send_to_staff}</p>}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-bg/60 px-3 py-2">
        <p className="text-xs uppercase font-semibold text-text-muted">What the member sees</p>
        <p className="text-sm text-text-primary mt-1">{describeRule(rule.plan_kind, f)}</p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || !dirty} className={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button>
        {msg && <span className={`text-sm ${msg === 'Saved' ? 'text-text-muted' : 'text-wcs-red'}`}>{msg}</span>}
        {!msg && dirty && <span className="text-sm text-text-muted">Unsaved changes</span>}
        {rule.updated_at && !dirty && !msg && (
          <span className="text-xs text-text-muted">Last saved {new Date(rule.updated_at).toLocaleString()}</span>
        )}
      </div>
    </Card>
  )
}

export default function RulesTab() {
  const [rules, setRules] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    saveAdmin.listRules()
      .then(r => {
        const list = r.rules || []
        if (!list.length) setError('No cancel rules found. Apply migration 213.')
        setRules(list)
      })
      .catch(e => setError(e.message || 'Failed to load cancel rules'))
  }, [])

  function replaceRule(updated) {
    setRules(prev => prev.map(r => (r.plan_kind === updated.plan_kind ? updated : r)))
  }

  if (error) return <Card><p className="text-sm text-wcs-red">{error}</p></Card>
  if (!rules) return <Card><p className="text-sm text-text-muted">Loading cancel rules…</p></Card>

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-text-muted">
          What a member owes to cancel, by plan type. The plan type comes from the ABC agreement term.
          Changes are live for members as soon as you save.
        </p>
      </Card>
      {rules.map(rule => <RuleCard key={rule.plan_kind} rule={rule} onSaved={replaceRule} />)}
    </div>
  )
}
