// Shared bits for Admin -> Save Offers (WCS Save cancel flow).

// ABC club number -> display name. Mirrors auth/src/config/clubMap.js; the
// server rejects any club number not in that map.
export const CLUBS = [
  { number: '30935', name: 'Salem' },
  { number: '31599', name: 'Keizer' },
  { number: '7655', name: 'Eugene' },
  { number: '31598', name: 'Springfield' },
  { number: '31600', name: 'Clackamas' },
  { number: '31601', name: 'Milwaukie' },
  { number: '32073', name: 'Medford' },
]
export const CLUB_NAME = Object.fromEntries(CLUBS.map(c => [c.number, c.name]))

export const OFFER_TYPES = [
  { value: 'dues_discount', label: 'Dues discount' },
  { value: 'freeze', label: 'Freeze' },
  { value: 'perk', label: 'Perk' },
]
export const OFFER_TYPE_LABEL = Object.fromEntries(OFFER_TYPES.map(t => [t.value, t.label]))

export const OUTCOMES = [
  { value: 'in_progress', label: 'In progress', tone: 'gray' },
  { value: 'saved', label: 'Saved', tone: 'green' },
  { value: 'cancelled', label: 'Cancelled', tone: 'red' },
  { value: 'needs_staff', label: 'Needs staff', tone: 'orange' },
  { value: 'abandoned', label: 'Abandoned', tone: 'gray' },
  { value: 'failed', label: 'Failed', tone: 'red' },
]
export const OUTCOME_BY_VALUE = Object.fromEntries(OUTCOMES.map(o => [o.value, o]))

export const HEADLINE_MAX = 120

export function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 ${className}`}>
      {children}
    </div>
  )
}

const TONES = {
  green: 'bg-green-100 text-green-700',
  orange: 'bg-orange-100 text-orange-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  gray: 'bg-gray-100 text-gray-600',
}

export function Badge({ children, tone = 'gray' }) {
  return (
    <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${TONES[tone] || TONES.gray}`}>
      {children}
    </span>
  )
}

export function OutcomeBadge({ outcome }) {
  const o = OUTCOME_BY_VALUE[outcome] || { label: outcome, tone: 'gray' }
  return <Badge tone={o.tone}>{o.label}</Badge>
}

export function TypeBadge({ type }) {
  const tone = type === 'dues_discount' ? 'blue' : type === 'freeze' ? 'purple' : 'orange'
  return <Badge tone={tone}>{OFFER_TYPE_LABEL[type] || type}</Badge>
}

export function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-wcs-red' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export const inputClass = (bad) =>
  `w-full rounded-lg border bg-surface px-3 py-2 text-sm text-text-primary ${bad ? 'border-wcs-red' : 'border-border'}`

export const btnPrimary = 'px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold disabled:opacity-50'
export const btnSecondary = 'px-3 py-2 rounded-lg border border-border text-sm text-text-primary hover:bg-bg disabled:opacity-50'

export function money(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  return v % 1 === 0 ? `$${v}` : `$${v.toFixed(2)}`
}

// Plain-English one-liner for an offer's config, used in lists and previews.
export function describeConfig(type, config = {}) {
  if (type === 'dues_discount') {
    const n = Number(config.invoices) || 0
    const months = `${n} month${n === 1 ? '' : 's'}`
    if (config.percent_off != null && config.percent_off !== '') return `${config.percent_off}% off dues for ${months}`
    if (config.amount_off != null && config.amount_off !== '') return `${money(config.amount_off)} off dues for ${months}`
    return 'Dues discount'
  }
  if (type === 'freeze') {
    const n = Number(config.months) || 0
    const fee = Number(config.fee) || 0
    return `Freeze for ${n} month${n === 1 ? '' : 's'}${fee > 0 ? `, ${money(fee)}/month` : ', no fee'}`
  }
  if (type === 'perk') return 'Staff hands this out'
  return ''
}

export function formatDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
