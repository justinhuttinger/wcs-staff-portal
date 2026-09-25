import { useMemo, useState } from 'react'
import { saveAdmin } from '../../../lib/api'
import {
  Card, CLUBS, OFFER_TYPES, HEADLINE_MAX, Toggle, inputClass, btnPrimary, btnSecondary, describeConfig,
} from './shared'

function initialState(offer) {
  const o = offer || {}
  const c = o.config || {}
  return {
    name: o.name && o.name !== o.headline ? o.name : '',
    offer_type: o.offer_type || 'dues_discount',
    headline: o.headline || '',
    description: o.description || '',
    fine_print: o.fine_print || '',
    discount_mode: c.amount_off != null ? 'amount' : 'percent',
    percent_off: c.percent_off != null ? String(c.percent_off) : '50',
    amount_off: c.amount_off != null ? String(c.amount_off) : '',
    invoices: c.invoices != null ? String(c.invoices) : '2',
    months: c.months != null ? String(c.months) : '1',
    fee: c.fee != null ? String(c.fee) : '0',
    staff_instructions: c.staff_instructions || '',
    all_reasons: !(o.reason_ids && o.reason_ids.length),
    reason_ids: o.reason_ids || [],
    all_clubs: !(o.club_numbers && o.club_numbers.length),
    club_numbers: o.club_numbers || [],
    priority: o.priority != null ? String(o.priority) : '100',
    active: o.active ?? false,
    starts_on: o.starts_on || '',
    ends_on: o.ends_on || '',
  }
}

function buildConfig(s) {
  if (s.offer_type === 'dues_discount') {
    return s.discount_mode === 'percent'
      ? { percent_off: Number(s.percent_off), invoices: Number(s.invoices) }
      : { amount_off: Number(s.amount_off), invoices: Number(s.invoices) }
  }
  if (s.offer_type === 'freeze') return { months: Number(s.months), fee: Number(s.fee || 0) }
  return { staff_instructions: s.staff_instructions.trim() }
}

// Mirrors services/saveOffersSchema.js so obvious mistakes show before a round trip.
function clientProblems(s) {
  const p = {}
  const isInt = (v, min, max) => /^-?\d+$/.test(String(v).trim()) && Number(v) >= min && Number(v) <= max
  if (!s.headline.trim()) p.headline = 'Headline is required'
  else if (s.headline.trim().length > HEADLINE_MAX) p.headline = `Keep it to ${HEADLINE_MAX} characters`
  if (s.offer_type === 'dues_discount') {
    if (s.discount_mode === 'percent' && !isInt(s.percent_off, 1, 100)) p.config = 'Percent off must be a whole number from 1 to 100'
    if (s.discount_mode === 'amount' && !(Number(s.amount_off) > 0)) p.config = 'Dollar amount off must be more than 0'
    if (!isInt(s.invoices, 1, 12)) p.config = 'Number of months must be from 1 to 12'
  }
  if (s.offer_type === 'freeze') {
    if (!isInt(s.months, 1, 12)) p.config = 'Freeze months must be from 1 to 12'
    if (s.fee !== '' && !(Number(s.fee) >= 0)) p.config = 'Monthly fee must be 0 or more'
  }
  if (s.offer_type === 'perk' && !s.staff_instructions.trim()) p.config = 'Tell staff what to hand out'
  if (!s.all_reasons && !s.reason_ids.length) p.reason_ids = 'Pick at least one reason, or choose all reasons'
  if (!s.all_clubs && !s.club_numbers.length) p.club_numbers = 'Pick at least one club, or choose all clubs'
  if (s.priority !== '' && !isInt(s.priority, 0, 100000)) p.priority = 'Priority must be a whole number'
  if (s.starts_on && s.ends_on && s.ends_on < s.starts_on) p.ends_on = 'End date cannot be before the start date'
  return p
}

function Field({ label, error, help, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
      {children}
      {error ? <p className="text-xs text-wcs-red mt-1">{error}</p> : help ? <p className="text-xs text-text-muted mt-1">{help}</p> : null}
    </div>
  )
}

function ChipPicker({ allLabel, all, onAll, options, selected, onChange }) {
  function flip(value) {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value])
  }
  return (
    <div className="space-y-2">
      <label className="inline-flex items-center gap-2 text-sm text-text-primary">
        <input type="checkbox" checked={all} onChange={e => onAll(e.target.checked)} />
        {allLabel}
      </label>
      {!all && (
        <div className="flex flex-wrap gap-2">
          {options.map(o => {
            const on = selected.includes(o.value)
            return (
              <button
                type="button"
                key={o.value}
                onClick={() => flip(o.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  on ? 'bg-wcs-red text-white border-wcs-red' : 'border-border text-text-primary hover:bg-bg'
                }`}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Roughly how the offer card looks on the member page. Kept on a light card
// on purpose: that is what members see, whatever portal theme staff use.
function MemberPreview({ s }) {
  const benefit = describeConfig(s.offer_type, buildConfig(s))
  return (
    <div className="rounded-2xl bg-white text-gray-900 border border-gray-200 shadow-sm p-5">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-red-600">Before you go</p>
      <h4 className="text-lg font-bold mt-1 break-words">{s.headline.trim() || 'Your headline here'}</h4>
      {s.description.trim() && <p className="text-sm text-gray-700 mt-2 whitespace-pre-line">{s.description.trim()}</p>}
      {s.offer_type !== 'perk' && benefit && (
        <p className="mt-3 inline-block rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-semibold">{benefit}</p>
      )}
      <button type="button" className="mt-4 w-full rounded-xl bg-red-600 text-white py-2.5 text-sm font-semibold cursor-default">
        Keep my membership
      </button>
      <p className="mt-2 text-center text-xs text-gray-500 underline">No thanks, continue to cancel</p>
      {s.fine_print.trim() && <p className="mt-3 text-[11px] leading-snug text-gray-500 whitespace-pre-line">{s.fine_print.trim()}</p>}
    </div>
  )
}

export default function OfferForm({ offer, reasons, onCancel, onSaved }) {
  const [s, setS] = useState(() => initialState(offer))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const reasonOptions = useMemo(
    () => reasons.map(r => ({ value: r.id, label: r.active ? r.label : `${r.label} (hidden)` })),
    [reasons],
  )
  const clubOptions = CLUBS.map(c => ({ value: c.number, label: c.name }))

  function set(key, value) {
    setS(prev => ({ ...prev, [key]: value }))
    const errKey = ['percent_off', 'amount_off', 'invoices', 'months', 'fee', 'staff_instructions', 'discount_mode', 'offer_type'].includes(key) ? 'config' : key
    if (errors[errKey]) setErrors(prev => ({ ...prev, [errKey]: undefined }))
  }

  async function save() {
    const problems = clientProblems(s)
    if (Object.keys(problems).length) {
      setErrors(problems)
      setMsg('Check the highlighted fields')
      return
    }
    const body = {
      name: s.name.trim() || s.headline.trim(),
      offer_type: s.offer_type,
      headline: s.headline.trim(),
      description: s.description.trim() || null,
      fine_print: s.fine_print.trim() || null,
      config: buildConfig(s),
      reason_ids: s.all_reasons ? [] : s.reason_ids,
      club_numbers: s.all_clubs || s.club_numbers.length === CLUBS.length ? [] : s.club_numbers,
      priority: s.priority === '' ? 100 : Number(s.priority),
      active: s.active,
      starts_on: s.starts_on || null,
      ends_on: s.ends_on || null,
    }
    setSaving(true)
    setMsg('')
    setErrors({})
    try {
      if (offer) await saveAdmin.updateOffer(offer.id, body)
      else await saveAdmin.createOffer(body)
      onSaved()
    } catch (e) {
      if (e.fields) setErrors(e.fields)
      setMsg(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-text-primary">{offer ? 'Edit offer' : 'New offer'}</h3>
          <label className="inline-flex items-center gap-2 text-sm text-text-primary">
            <Toggle checked={s.active} onChange={v => set('active', v)} label="Active" />
            {s.active ? 'Active' : 'Off'}
          </label>
        </div>

        <Field label="Offer type" error={errors.offer_type}>
          <div className="flex flex-wrap gap-2">
            {OFFER_TYPES.map(t => (
              <button
                type="button"
                key={t.value}
                onClick={() => set('offer_type', t.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                  s.offer_type === t.value ? 'bg-wcs-red text-white border-wcs-red' : 'border-border text-text-primary hover:bg-bg'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>

        {/* Type-specific settings */}
        <div className="rounded-lg border border-border p-4 space-y-3">
          {s.offer_type === 'dues_discount' && (
            <>
              <div className="flex gap-2">
                {[{ v: 'percent', l: 'Percent off' }, { v: 'amount', l: 'Dollar amount off' }].map(m => (
                  <button
                    type="button"
                    key={m.v}
                    onClick={() => set('discount_mode', m.v)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border ${
                      s.discount_mode === m.v ? 'bg-wcs-red text-white border-wcs-red' : 'border-border text-text-primary hover:bg-bg'
                    }`}
                  >
                    {m.l}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {s.discount_mode === 'percent' ? (
                  <Field label="Percent off each month (1 to 100)">
                    <input type="number" min="1" max="100" step="1" value={s.percent_off}
                      onChange={e => set('percent_off', e.target.value)} className={inputClass(errors.config)} />
                  </Field>
                ) : (
                  <Field label="Dollars off each month">
                    <input type="number" min="0.01" step="0.01" value={s.amount_off}
                      onChange={e => set('amount_off', e.target.value)} className={inputClass(errors.config)} />
                  </Field>
                )}
                <Field label="Number of months (1 to 12)">
                  <input type="number" min="1" max="12" step="1" value={s.invoices}
                    onChange={e => set('invoices', e.target.value)} className={inputClass(errors.config)} />
                </Field>
              </div>
              <p className="text-xs text-text-muted">Applied to the member's next monthly dues invoices in ABC.</p>
            </>
          )}
          {s.offer_type === 'freeze' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Freeze months (1 to 12)">
                  <input type="number" min="1" max="12" step="1" value={s.months}
                    onChange={e => set('months', e.target.value)} className={inputClass(errors.config)} />
                </Field>
                <Field label="Monthly freeze fee ($, 0 for free)">
                  <input type="number" min="0" step="0.01" value={s.fee}
                    onChange={e => set('fee', e.target.value)} className={inputClass(errors.config)} />
                </Field>
              </div>
              <p className="text-xs text-text-muted">Starts on the member's next dues date.</p>
            </>
          )}
          {s.offer_type === 'perk' && (
            <Field label="Staff instructions" help="Not shown to the member. The request lands in Activity for staff to hand this out.">
              <textarea rows={3} value={s.staff_instructions} onChange={e => set('staff_instructions', e.target.value)}
                placeholder="e.g. Give one free 30 minute PT session and book it with the member"
                className={inputClass(errors.config)} />
            </Field>
          )}
          {errors.config && <p className="text-xs text-wcs-red">{errors.config}</p>}
        </div>

        <Field label={`Headline (${s.headline.trim().length}/${HEADLINE_MAX})`} error={errors.headline}>
          <input value={s.headline} maxLength={HEADLINE_MAX + 20} onChange={e => set('headline', e.target.value)}
            placeholder="Stay for half price for 2 months" className={inputClass(errors.headline)} />
        </Field>
        <Field label="Description (optional)" error={errors.description}>
          <textarea rows={3} value={s.description} onChange={e => set('description', e.target.value)}
            className={inputClass(errors.description)} />
        </Field>
        <Field label="Fine print (optional)" error={errors.fine_print}>
          <textarea rows={2} value={s.fine_print} onChange={e => set('fine_print', e.target.value)}
            className={inputClass(errors.fine_print)} />
        </Field>
        <Field label="Internal name (optional)" error={errors.name} help="Only staff see this. Defaults to the headline.">
          <input value={s.name} onChange={e => set('name', e.target.value)} className={inputClass(errors.name)} />
        </Field>

        <Field label="Show for these cancel reasons" error={errors.reason_ids}>
          <ChipPicker
            allLabel="All reasons"
            all={s.all_reasons}
            onAll={v => set('all_reasons', v)}
            options={reasonOptions}
            selected={s.reason_ids}
            onChange={v => set('reason_ids', v)}
          />
        </Field>
        <Field label="Show at these clubs" error={errors.club_numbers}>
          <ChipPicker
            allLabel="All clubs"
            all={s.all_clubs}
            onAll={v => set('all_clubs', v)}
            options={clubOptions}
            selected={s.club_numbers}
            onChange={v => set('club_numbers', v)}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Priority" error={errors.priority} help="Lower shows first">
            <input type="number" step="1" value={s.priority} onChange={e => set('priority', e.target.value)}
              className={inputClass(errors.priority)} />
          </Field>
          <Field label="Starts (optional)" error={errors.starts_on}>
            <input type="date" value={s.starts_on} onChange={e => set('starts_on', e.target.value)}
              className={inputClass(errors.starts_on)} />
          </Field>
          <Field label="Ends (optional)" error={errors.ends_on}>
            <input type="date" value={s.ends_on} onChange={e => set('ends_on', e.target.value)}
              className={inputClass(errors.ends_on)} />
          </Field>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save offer'}</button>
          <button onClick={onCancel} disabled={saving} className={btnSecondary}>Cancel</button>
          {msg && <span className="text-sm text-wcs-red">{msg}</span>}
        </div>
      </Card>

      <div className="space-y-2 lg:sticky lg:top-4 self-start">
        <Card>
          <p className="text-xs uppercase font-semibold text-text-muted mb-3">Member preview</p>
          <MemberPreview s={s} />
          {s.offer_type === 'perk' && (
            <p className="text-xs text-text-muted mt-3">Staff instructions are not shown to the member.</p>
          )}
        </Card>
      </div>
    </div>
  )
}
