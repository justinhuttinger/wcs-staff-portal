import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'

// ---------------------------------------------------------------------------
// Topline — Analytics (admin only)
//
// Eight cards, each a headline plus the periods it is judged against. No
// charts: these are single numbers, and a number is the honest form for a
// number — a sparkline here would decorate rather than inform.
//
// Percent rows are the only coloured text on the page. Colour is applied by
// whether the movement is GOOD, not by whether it is positive: attrition and
// lost members rising is bad, so those invert. Colour never carries the
// meaning alone — the sign is always printed too.
// ---------------------------------------------------------------------------

// Cards where a rise is a bad outcome, so the good/bad colouring inverts.
const LOWER_IS_BETTER = new Set(['attritionYtd'])
// Rows within any card whose label means "losses", same reasoning.
const LOSS_ROW = /lost members/i

function fmt(value, format) {
  if (value === null || value === undefined) return 'N/A'
  const n = Number(value)
  switch (format) {
    case 'money':
      return `$${Math.round(n).toLocaleString()}`
    case 'money2':
      return `$${n.toFixed(2)}`
    case 'pct':
      return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
    default:
      return Math.round(n).toLocaleString()
  }
}

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}/${y}`
}

function toneFor(value, lowerIsBetter) {
  if (value === null || value === undefined || value === 0) return 'text-text-muted'
  const good = lowerIsBetter ? value < 0 : value > 0
  return good ? 'text-emerald-600' : 'text-wcs-red'
}

function Card({ card, asOf }) {
  const headlineSign = card.signed && card.value > 0 ? '+' : ''

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden flex flex-col">
      <div className="bg-bg border-b border-border px-4 py-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-text-primary">{card.label}</p>
        {card.suspect && (
          <span
            title={card.suspect}
            className="text-[10px] font-bold uppercase tracking-wide text-amber-600 border border-amber-600/40 rounded px-1.5 py-0.5"
          >
            Suspect
          </span>
        )}
      </div>

      <div className="px-4 py-4 text-center">
        <p className="text-2xl font-bold text-text-primary tabular-nums">
          {headlineSign}{fmt(card.value, card.format)}
        </p>
        <p className="text-[11px] text-text-muted mt-0.5">
          {card.label}{asOf ? ` thru ${fmtDate(asOf)}` : ''}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 px-4 pb-4 mt-auto">
        {card.rows.map(row => {
          const isPct = row.format === 'pct'
          const lowerIsBetter = LOWER_IS_BETTER.has(card.key) || LOSS_ROW.test(row.label)
          return (
            <div key={row.label} className="text-center">
              <dd className={`text-sm font-bold tabular-nums ${isPct ? toneFor(row.value, lowerIsBetter) : 'text-text-primary'}`}>
                {fmt(row.value, row.format)}
              </dd>
              <dt className="text-[10px] text-text-muted leading-tight mt-0.5">{row.label}</dt>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

export default function Topline({ locationSlug }) {
  const [exclusion, setExclusion] = useState('exclude')

  const query = useMemo(
    () => new URLSearchParams({ clubs: locationSlug || 'all', exclusion }).toString(),
    [locationSlug, exclusion]
  )

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/topline?${query}`, { cache: true, signal }),
    [query]
  )

  if (loading) return <DesktopLoading />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }

  const cards = data?.cards || []
  const checkinNote = data?.meta?.notes?.checkins
  // Only under Exclude: under Include no conditional rule is applied, so
  // describing one would be describing something that did not happen.
  const conditionalNote = exclusion === 'exclude' ? data?.meta?.notes?.conditional : null

  return (
    <div className="space-y-4">
      <ExclusionToolbar value={exclusion} onChange={setExclusion} />

      <div className="bg-surface rounded-xl border border-border px-4 py-2.5 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm font-bold text-text-primary">
          Topline
          {data?.asOf && <span className="font-medium text-text-muted"> — as of {fmtDate(data.asOf)}</span>}
        </p>
        <p className="text-[11px] text-text-muted">
          Every comparison stops on the same day of the month, so a month to date is never measured
          against a whole month. Check-ins are the exception: they compare whole months, and the
          card names the month it is showing.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map(card => <Card key={card.key} card={card} asOf={data?.asOf} />)}
      </div>

      {checkinNote && (
        <p className="text-xs text-text-muted px-1">
          <span className="font-semibold text-text-primary">Check-ins.</span> {checkinNote}
        </p>
      )}

      {conditionalNote && (
        <p className="text-xs text-text-muted px-1">
          <span className="font-semibold text-text-primary">Member counts.</span> {conditionalNote}
        </p>
      )}
    </div>
  )
}

// Portalled next to the shared date range, matching the other Analytics reports.
function ExclusionToolbar({ value, onChange }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
      Member Count
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium"
      >
        <option value="exclude">Exclude</option>
        <option value="include">Include</option>
      </select>
    </label>,
    slot
  )
}
