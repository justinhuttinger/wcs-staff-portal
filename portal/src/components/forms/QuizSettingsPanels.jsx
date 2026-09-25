import { GTM_RE, PIXEL_RE } from './quizDefaults'

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60'

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-text-primary">{title}</h3>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-muted mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-text-muted mt-1">{hint}</p>}
    </div>
  )
}

export function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-text-primary">{label}</p>
        {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${checked ? 'bg-wcs-red' : 'bg-border'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}

export function QuizContactPanel({ value, onChange, disabled }) {
  const set = patch => onChange({ ...value, ...patch })
  return (
    <Card title="Contact step" subtitle="The last screen of the quiz. GHL tracking reads this form, so email is always collected.">
      <Field label="Heading">
        <input value={value.heading} onChange={e => set({ heading: e.target.value })} maxLength={200} disabled={disabled} className={inputClass} />
      </Field>
      <Field label="Subtext (optional)">
        <textarea value={value.subtext} onChange={e => set({ subtext: e.target.value })} rows={2} maxLength={500} disabled={disabled} className={inputClass} />
      </Field>
      <Toggle label="Require first name" checked={value.require_first_name} onChange={v => set({ require_first_name: v })} disabled={disabled} />
      <Toggle label="Require last name" checked={value.require_last_name} onChange={v => set({ require_last_name: v })} disabled={disabled} />
      <Toggle label="Require phone" checked={value.require_phone} onChange={v => set({ require_phone: v })} disabled={disabled} />
      <Toggle label="Require email" hint="Always on. GHL matches contacts by email." checked onChange={() => {}} disabled />
    </Card>
  )
}

export function QuizThankYouPanel({ value, onChange, disabled }) {
  const set = patch => onChange({ ...value, ...patch })
  const badRedirect = value.redirect_url && !/^https:\/\//i.test(value.redirect_url)
  return (
    <Card title="After submit" subtitle="What someone sees once they finish the quiz.">
      <Field label="Heading">
        <input value={value.heading} onChange={e => set({ heading: e.target.value })} maxLength={200} disabled={disabled} className={inputClass} />
      </Field>
      <Field label="Message (optional)">
        <textarea value={value.message} onChange={e => set({ message: e.target.value })} rows={3} maxLength={1000} disabled={disabled} className={inputClass} />
      </Field>
      <Field label="Redirect URL (optional)" hint={badRedirect ? 'Use a full https:// link.' : 'If set, people are sent here instead of seeing the message.'}>
        <input value={value.redirect_url} onChange={e => set({ redirect_url: e.target.value })} placeholder="https://westcoaststrength.com/thank-you" disabled={disabled} className={inputClass} />
      </Field>
    </Card>
  )
}

export function QuizTrackingPanel({ value, onChange, disabled }) {
  const set = patch => onChange({ ...value, ...patch })
  const pixelBad = value.meta_pixel_id && !PIXEL_RE.test(value.meta_pixel_id.trim())
  const gtmBad = value.gtm_id && !GTM_RE.test(value.gtm_id.trim().toUpperCase())
  return (
    <Card title="Tracking" subtitle="Loaded on every club's link for this quiz. GHL External Tracking is set per club on the Clubs tab.">
      <Field label="Meta Pixel ID (optional)" hint={pixelBad ? 'Digits only.' : 'Fires PageView on load and Lead on submit.'}>
        <input value={value.meta_pixel_id} onChange={e => set({ meta_pixel_id: e.target.value })} placeholder="820682157231470" disabled={disabled} className={inputClass} />
      </Field>
      <Field label="GTM container ID (optional)" hint={gtmBad ? 'Should look like GTM-XXXXXXX.' : 'Pushes quiz_start, quiz_step and quiz_submit to the dataLayer.'}>
        <input value={value.gtm_id} onChange={e => set({ gtm_id: e.target.value })} placeholder="GTM-XXXXXXX" disabled={disabled} className={inputClass} />
      </Field>
    </Card>
  )
}
