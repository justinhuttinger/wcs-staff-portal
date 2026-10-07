import { useEffect, useMemo, useState } from 'react'
import { onlineJoin } from '../../lib/api'
import AbcPlanPicker, { loadAbcPlanList, loadAbcPlanSummary } from './OnlineJoinAbcPicker'
import { abcIssues, fmtMoney, suggestPlanKey, termLabel, twinName } from '../../lib/abcPlan'

// Plan editor, ABC-first: link the Card + Bank plans from ABC and the prices,
// term and validation hash fill themselves in. Everything a person rarely
// touches (keys, hashes, campaign ids) lives under "Advanced".

const inputCls = 'w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red disabled:opacity-60'

function dtToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function dtToIso(v) {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
const numOrNull = v => (v === '' || v == null || !Number.isFinite(Number(v))) ? null : Number(v)
const same = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.005

function planLabelFor(typeLabel, term, maxMembers) {
  const t = term === '1yr' ? '1 Year' : term === 'm2m' ? 'Month to Month' : ''
  const size = Number(maxMembers) > 1 ? ` (${maxMembers})` : ''
  return [typeLabel ? `${typeLabel}${size}` : '', t].filter(Boolean).join(' - ')
}

export default function PlanEditor({ plan, locations, ageRules = [], types = [], onClose, onSaved, defaultTerm, membershipTypeId }) {
  const isNew = !plan.id
  const [draft, setDraft] = useState(() => ({
    wcs_location_id: plan.wcs_location_id || '',
    membership_type_id: plan.membership_type_id ?? membershipTypeId ?? null,
    term: plan.term ?? defaultTerm ?? '',
    max_members: plan.max_members || 1,
    plan_key: plan.plan_key || '',
    plan_label: plan.plan_label || '',
    plan_description: plan.plan_description || '',
    badge: plan.badge || '',
    payment_plan_id: plan.payment_plan_id || '',
    payment_plan_id_ach: plan.payment_plan_id_ach || '',
    plan_validation_hash: plan.plan_validation_hash || '',
    campaign_id: plan.campaign_id || '',
    sales_person_id: plan.sales_person_id || '',
    today_amount: plan.today_amount ?? '',
    monthly_amount: plan.monthly_amount ?? '',
    today_amount_ach: plan.today_amount_ach ?? '',
    monthly_amount_ach: plan.monthly_amount_ach ?? '',
    enrollment_fee: plan.enrollment_fee ?? '',
    display_order: plan.display_order ?? 0,
    age_rule_id: plan.age_rule_id || null,
    promo_code: plan.promo_code || '',
    promo_starts_at: dtToLocalInput(plan.promo_starts_at),
    promo_ends_at: dtToLocalInput(plan.promo_ends_at),
    active: plan.active ?? true,
  }))
  // Edits a person made by hand stick; ABC fills only what they haven't touched.
  const [touched, setTouched] = useState(() => new Set(isNew ? [] : ['plan_key', 'plan_label']))
  const [abc, setAbc] = useState({ cc: null, ach: null })
  const [abcLoading, setAbcLoading] = useState({ cc: false, ach: false })
  const [abcError, setAbcError] = useState(null)
  const [picker, setPicker] = useState(null) // 'cc' | 'ach' | null
  const [twinNote, setTwinNote] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const location = locations.find(l => l.wcs_location_id === draft.wcs_location_id)
  const club = location?.abc_club_number
  const prorated = !!location?.prorated_billing
  const typeLocked = !!membershipTypeId
  const typeOptions = types.filter(t => t.wcs_location_id === draft.wcs_location_id)
  const parentType = types.find(t => t.id === draft.membership_type_id)
  const household = !!parentType?.allow_secondary_members || Number(draft.max_members) > 1

  function set(key, value, { byHand = true } = {}) {
    setDraft(d => ({ ...d, [key]: value }))
    if (byHand) setTouched(t => new Set(t).add(key))
  }

  // Keep the auto label/key in step with type + term + size until edited by hand.
  useEffect(() => {
    setDraft(d => {
      const next = { ...d }
      if (!touched.has('plan_label')) next.plan_label = planLabelFor(parentType?.type_label, d.term, d.max_members)
      if (!touched.has('plan_key')) next.plan_key = suggestPlanKey(parentType?.type_key, d.term, d.max_members)
      return next
    })
  }, [parentType?.type_label, parentType?.type_key, draft.term, draft.max_members, touched])

  async function loadSide(side, planId, { fill } = { fill: false }) {
    if (!club || !planId) return null
    setAbcLoading(s => ({ ...s, [side]: true }))
    try {
      const s = await loadAbcPlanSummary(club, planId)
      setAbc(a => ({ ...a, [side]: s }))
      if (fill && s) applyAbc(side, s)
      return s
    } catch (e) {
      setAbcError(`Couldn't read the ${side === 'cc' ? 'card' : 'bank'} plan from ABC: ${e.message}`)
      return null
    } finally {
      setAbcLoading(s => ({ ...s, [side]: false }))
    }
  }

  // Existing plan: read both linked ABC plans so differences show up right away.
  useEffect(() => {
    if (!club) return
    if (draft.payment_plan_id) loadSide('cc', draft.payment_plan_id)
    if (draft.payment_plan_id_ach) loadSide('ach', draft.payment_plan_id_ach)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club])

  function applyAbc(side, s) {
    setDraft(d => {
      const next = { ...d }
      if (side === 'cc') {
        next.payment_plan_id = s.planId
        if (s.validation) next.plan_validation_hash = s.validation
        if (s.today != null) next.today_amount = s.today
        if (s.monthly) next.monthly_amount = s.monthly
        next.enrollment_fee = s.enrollment ?? next.enrollment_fee
        if (s.term && !next.term) next.term = s.term
      } else {
        next.payment_plan_id_ach = s.planId
        if (s.today != null) next.today_amount_ach = s.today
        if (s.monthly) next.monthly_amount_ach = s.monthly
        if (s.term && !next.term) next.term = s.term
      }
      return next
    })
  }

  async function onPicked(side, s) {
    setPicker(null)
    setAbc(a => ({ ...a, [side]: s }))
    applyAbc(side, s)
    setTwinNote(null)
    // Picked one side and the other is empty: find its twin by name and link it.
    const other = side === 'cc' ? 'ach' : 'cc'
    const otherEmpty = side === 'cc' ? !draft.payment_plan_id_ach : !draft.payment_plan_id
    const twin = twinName(s.name)
    if (otherEmpty && twin && club) {
      try {
        const list = await loadAbcPlanList(club)
        const hit = list.find(p => p.name.toUpperCase() === twin.toUpperCase())
        if (hit) {
          const t = await loadSide(other, hit.planId, { fill: true })
          if (t) setTwinNote(`Also linked ${t.name} as the ${other === 'cc' ? 'card' : 'bank'} plan.`)
        }
      } catch { /* the person can still pick the other side by hand */ }
    }
  }

  function useAllAbc() {
    if (abc.cc) applyAbc('cc', abc.cc)
    if (abc.ach) applyAbc('ach', abc.ach)
  }

  const checks = useMemo(() => abcIssues(draft, abc, prorated), [abc, draft, prorated])

  async function save() {
    setSaving(true); setError(null)
    try {
      if (!draft.wcs_location_id) throw new Error('Pick a club.')
      if (!draft.payment_plan_id) throw new Error('Link the card plan from ABC.')
      if (draft.today_amount === '' || draft.monthly_amount === '') throw new Error('Due today and monthly are required.')
      const body = {
        wcs_location_id: draft.wcs_location_id,
        plan_key: draft.plan_key,
        plan_label: draft.plan_label,
        plan_description: draft.plan_description || null,
        badge: draft.badge || null,
        today_amount: Number(draft.today_amount),
        monthly_amount: Number(draft.monthly_amount),
        enrollment_fee: numOrNull(draft.enrollment_fee),
        display_order: parseInt(draft.display_order) || 0,
        payment_plan_id: draft.payment_plan_id,
        plan_validation_hash: draft.plan_validation_hash || null,
        campaign_id: draft.campaign_id || null,
        sales_person_id: draft.sales_person_id || null,
        payment_plan_id_ach: draft.payment_plan_id_ach || null,
        today_amount_ach: numOrNull(draft.today_amount_ach),
        monthly_amount_ach: numOrNull(draft.monthly_amount_ach),
        age_rule_id: draft.age_rule_id || null,
        membership_type_id: draft.membership_type_id || null,
        term: draft.term || null,
        max_members: parseInt(draft.max_members) || 1,
        promo_code: draft.promo_code || null,
        promo_starts_at: dtToIso(draft.promo_starts_at),
        promo_ends_at: dtToIso(draft.promo_ends_at),
        active: !!draft.active,
      }
      if (isNew) await onlineJoin.createPlan(body)
      else {
        const { wcs_location_id, ...patch } = body
        await onlineJoin.updatePlan(plan.id, patch)
      }
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const title = isNew
    ? `New ${draft.term ? termLabel(draft.term) + ' ' : ''}plan`
    : (draft.plan_label || draft.plan_key)

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-text-primary truncate">{title}</h3>
              <p className="text-xs text-text-muted">
                {[location?.display_name, parentType?.type_label, draft.term && termLabel(draft.term)].filter(Boolean).join(' · ') || 'Online Join plan'}
              </p>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="overflow-y-auto p-5 space-y-6">
            {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

            {/* Where (only when not opened from a type) */}
            {(!typeLocked || isNew) && (
              <Section n="1" title="Where it shows">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="block">
                    <Label>Club</Label>
                    <select value={draft.wcs_location_id} onChange={e => set('wcs_location_id', e.target.value)} disabled={!isNew || typeLocked} className={inputCls}>
                      <option value="">Select…</option>
                      {locations.map(l => <option key={l.wcs_location_id} value={l.wcs_location_id}>{l.display_name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <Label>Membership type</Label>
                    <select value={draft.membership_type_id || ''} onChange={e => set('membership_type_id', e.target.value || null)} disabled={typeLocked || !draft.wcs_location_id} className={inputCls}>
                      <option value="">None</option>
                      {typeOptions.map(t => <option key={t.id} value={t.id}>{t.type_label}</option>)}
                    </select>
                  </label>
                  <div>
                    <Label>Term</Label>
                    <Segmented value={draft.term} onChange={v => set('term', v)} options={[['1yr', '1-Year'], ['m2m', 'Month-to-Month']]} />
                  </div>
                </div>
              </Section>
            )}

            <Section n={(!typeLocked || isNew) ? '2' : '1'} title="Link the ABC plans" sub="Pick the card plan and the bank plan picks itself when the names match. Prices fill in from ABC.">
              {!club && <p className="text-xs text-text-muted">Pick a club first.</p>}
              {club && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <AbcSlot
                    label="Card plan"
                    planId={draft.payment_plan_id}
                    summary={abc.cc}
                    loading={abcLoading.cc}
                    required
                    onChoose={() => setPicker('cc')}
                  />
                  <AbcSlot
                    label="Bank (ACH) plan"
                    planId={draft.payment_plan_id_ach}
                    summary={abc.ach}
                    loading={abcLoading.ach}
                    onChoose={() => setPicker('ach')}
                    onClear={draft.payment_plan_id_ach ? () => { set('payment_plan_id_ach', ''); set('today_amount_ach', ''); set('monthly_amount_ach', ''); setAbc(a => ({ ...a, ach: null })) } : null}
                  />
                </div>
              )}
              {twinNote && <p className="mt-2 text-xs text-green-600">{twinNote}</p>}
              {abcError && <p className="mt-2 text-xs text-red-600">{abcError}</p>}
            </Section>

            <Section n={(!typeLocked || isNew) ? '3' : '2'} title="What the member pays" sub={prorated ? 'Prorated club: ABC works out the real due-today at signup. The number here only decides whether bank members also get asked for a card, so keep it above $0.' : 'These show on the join page and should match ABC.'}>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-bg/60 text-xs text-text-muted">
                    <tr>
                      <th className="text-left font-medium px-3 py-2"></th>
                      <th className="text-left font-medium px-3 py-2">Card</th>
                      <th className="text-left font-medium px-3 py-2">Bank (ACH)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <MoneyRow
                      label="Due today"
                      cc={draft.today_amount} onCc={v => set('today_amount', v)} abcCc={prorated ? null : abc.cc?.today}
                      ach={draft.today_amount_ach} onAch={v => set('today_amount_ach', v)} abcAch={prorated ? null : abc.ach?.today}
                      achDisabled={!draft.payment_plan_id_ach}
                    />
                    <MoneyRow
                      label="Monthly"
                      cc={draft.monthly_amount} onCc={v => set('monthly_amount', v)} abcCc={abc.cc?.monthly}
                      ach={draft.monthly_amount_ach} onAch={v => set('monthly_amount_ach', v)} abcAch={abc.ach?.monthly}
                      achDisabled={!draft.payment_plan_id_ach}
                    />
                    <tr className="border-t border-border">
                      <td className="px-3 py-2 text-xs text-text-muted">Enrollment fee</td>
                      <td className="px-3 py-2" colSpan={2}>
                        <MoneyInput value={draft.enrollment_fee} onChange={v => set('enrollment_fee', v)} abc={abc.cc?.enrollment} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {abc.cc?.firstDue && <p className="mt-2 text-[11px] text-text-muted">ABC's first monthly bill for someone joining today: {abc.cc.firstDue}.</p>}
              {checks.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <ul className="text-xs text-amber-800 space-y-1 list-disc pl-4">
                      {checks.map(c => <li key={c}>{c}</li>)}
                    </ul>
                    {(abc.cc || abc.ach) && (
                      <button onClick={useAllAbc} className="shrink-0 px-2.5 py-1 rounded-md bg-amber-600 text-white text-[11px] font-semibold">Use ABC numbers</button>
                    )}
                  </div>
                </div>
              )}
              {checks.length === 0 && (abc.cc || abc.ach) && (
                <p className="mt-2 text-xs text-green-600">Matches ABC.</p>
              )}
            </Section>

            {household && (
              <Section title="Household size">
                <label className="block max-w-[220px]">
                  <Label>Covers this many people</Label>
                  <input type="number" min="1" value={draft.max_members} onChange={e => set('max_members', e.target.value)} className={inputCls} />
                </label>
                <p className="mt-1 text-[11px] text-text-muted">The join page picks this plan when the household is this size. Base family plan = 3.</p>
              </Section>
            )}

            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" checked={!!draft.active} onChange={e => set('active', e.target.checked)} className="w-4 h-4" />
              Live on the join page
            </label>

            <div className="border-t border-border pt-4">
              <button onClick={() => setShowAdvanced(s => !s)} className="text-xs font-semibold text-text-muted hover:text-text-primary">
                {showAdvanced ? '▾' : '▸'} Advanced
              </button>
              {showAdvanced && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <TextField label="Plan name (admin + receipts)" value={draft.plan_label} onChange={v => set('plan_label', v)} />
                    <TextField label="Plan key" mono value={draft.plan_key} onChange={v => set('plan_key', v.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
                    <TextField label="ABC card plan ID" mono value={draft.payment_plan_id} onChange={v => set('payment_plan_id', v)} />
                    <TextField label="ABC bank plan ID" mono value={draft.payment_plan_id_ach} onChange={v => set('payment_plan_id_ach', v)} />
                    <TextField label="Validation hash (fallback)" mono value={draft.plan_validation_hash} onChange={v => set('plan_validation_hash', v)} />
                    <TextField label="Display order" type="number" value={draft.display_order} onChange={v => set('display_order', v)} />
                    <TextField label="Campaign ID" mono value={draft.campaign_id} onChange={v => set('campaign_id', v)} />
                    <TextField label="Salesperson ID" mono value={draft.sales_person_id} onChange={v => set('sales_person_id', v)} />
                    <label className="block">
                      <Label>Age rule</Label>
                      <select value={draft.age_rule_id || ''} onChange={e => set('age_rule_id', e.target.value || null)} className={inputCls}>
                        <option value="">No age restriction</option>
                        {ageRules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </label>
                    <TextField label="Badge" value={draft.badge} onChange={v => set('badge', v)} />
                  </div>
                  <div>
                    <Label>Plan-only promo code</Label>
                    <p className="text-[11px] text-text-muted mb-1.5">Rarely needed: promos normally live on the membership type. A code here hides just this plan behind ?promo=.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <input value={draft.promo_code} onChange={e => set('promo_code', e.target.value)} placeholder="code" className={`${inputCls} font-mono`} />
                      <input type="datetime-local" value={draft.promo_starts_at} onChange={e => set('promo_starts_at', e.target.value)} className={inputCls} />
                      <input type="datetime-local" value={draft.promo_ends_at} onChange={e => set('promo_ends_at', e.target.value)} className={inputCls} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">Cancel</button>
            <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-60">
              {saving ? 'Saving…' : (isNew ? 'Create plan' : 'Save plan')}
            </button>
          </div>
        </div>
      </div>

      {picker && club && (
        <AbcPlanPicker
          clubNumber={club}
          clubName={location?.display_name}
          want={{ method: picker, term: draft.term || null, hint: abc[picker === 'cc' ? 'ach' : 'cc']?.name ? twinName(abc[picker === 'cc' ? 'ach' : 'cc'].name) || '' : '' }}
          onPick={s => onPicked(picker, s)}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  )
}

function Section({ n, title, sub, children }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2.5">
        {n && <span className="w-5 h-5 shrink-0 rounded-full bg-wcs-red text-white text-[11px] font-bold flex items-center justify-center">{n}</span>}
        <div>
          <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
          {sub && <p className="text-[11px] text-text-muted mt-0.5">{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Label({ children }) {
  return <span className="block text-xs font-medium text-text-muted mb-1">{children}</span>
}

function TextField({ label, value, onChange, mono, type = 'text' }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} className={`${inputCls} ${mono ? 'font-mono text-xs' : ''}`} />
    </label>
  )
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex w-full rounded-lg border border-border bg-bg p-0.5">
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`flex-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${value === k ? 'bg-wcs-red text-white' : 'text-text-muted hover:text-text-primary'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

function AbcSlot({ label, planId, summary, loading, required, onChoose, onClear }) {
  if (!planId) {
    return (
      <button onClick={onChoose} className="text-left rounded-lg border border-dashed border-border hover:border-wcs-red px-3 py-3 transition-colors">
        <div className="text-xs font-semibold text-text-primary">{label}{required && <span className="text-wcs-red"> *</span>}</div>
        <div className="text-xs text-wcs-red mt-1">Choose from ABC →</div>
      </button>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text-muted">{label}</span>
        <span className="flex gap-2">
          <button onClick={onChoose} className="text-[11px] text-wcs-red hover:underline">Change</button>
          {onClear && <button onClick={onClear} className="text-[11px] text-text-muted hover:text-wcs-red">Remove</button>}
        </span>
      </div>
      <div className="mt-1 text-sm font-semibold text-text-primary font-mono truncate">
        {loading ? 'Reading ABC…' : (summary?.name || 'Linked plan')}
      </div>
      {summary && (
        <div className="mt-1 text-[11px] text-text-muted">
          {fmtMoney(summary.today)} today · {fmtMoney(summary.dues)}/mo dues{summary.fees ? ` + ${fmtMoney(summary.fees)} fee` : ''}
        </div>
      )}
      <div className="text-[10px] text-text-muted font-mono truncate mt-0.5">{planId}</div>
    </div>
  )
}

function MoneyInput({ value, onChange, abc, disabled, placeholder }) {
  const off = abc != null && value !== '' && value != null && !same(value, abc)
  return (
    <div>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-text-muted">$</span>
        <input type="number" step="0.01" value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} placeholder={placeholder}
          className={`${inputCls} pl-6 ${off ? '!border-amber-400' : ''}`} />
      </div>
      {abc != null && (
        <div className={`text-[10px] mt-0.5 ${off ? 'text-amber-600' : 'text-text-muted'}`}>ABC: {fmtMoney(abc)}</div>
      )}
    </div>
  )
}

function MoneyRow({ label, cc, onCc, abcCc, ach, onAch, abcAch, achDisabled }) {
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{label}</td>
      <td className="px-3 py-2"><MoneyInput value={cc} onChange={onCc} abc={abcCc} /></td>
      <td className="px-3 py-2"><MoneyInput value={ach} onChange={onAch} abc={abcAch} disabled={achDisabled} placeholder={achDisabled ? 'No bank plan' : 'Same as card'} /></td>
    </tr>
  )
}
