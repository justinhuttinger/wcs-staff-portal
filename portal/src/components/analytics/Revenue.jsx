import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtMoney, GOOD_COLOR, BAD_COLOR } from './chartPalette'
import { MultiTrend, RankedBars } from './charts'
import { CategoryTable } from './revenueCategoryTable'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { LOCATION_NAMES } from '../../config/locations'

// ---------------------------------------------------------------------------
// Revenue Analysis — Analytics (admin only)
//
// Every profit center against the same span a month ago and a year ago.
//
// TWO TABLES, BOTH ALWAYS PRESENT. Priority carries the centers that get
// managed; All carries every one of them. Hiding the long tail behind a toggle
// meant a $289,021 guest-fee line was one click further away than a $4,138
// snack line, which is backwards.
//
// ANY ROW OPENS INTO ITS LAST SIX MONTHS. A single period against two
// comparisons says whether something moved; it does not say whether the move is
// a trend or a blip, and that is usually the actual question. Small rows get
// the same treatment as large ones — the reason to open a small row is to ask
// whether it is small and shrinking or small and growing.
// ---------------------------------------------------------------------------

const CLUB_NAMES = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))
const CLUB_LABEL = s => (s ? (CLUB_NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1)) : s)

export default function Revenue({ startDate, endDate, locationSlug }) {
  const [openKey, setOpenKey] = useState(null)

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error, retrying } = useCancellableFetch(
    signal => api(`/analytics/revenue?${query}`, { cache: true, signal }),
    [query]
  )

  const s = data?.summary || {}
  const headline = data?.headline || []
  const all = data?.all || []
  const sparklines = data?.sparklines || {}

  return (
    <div className="space-y-3">
      <Toolbar />

      {loading && <DesktopLoading retrying={retrying} />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Above the numbers: a window shorter than the one asked for is not
              something to discover afterwards. */}
          {data.notes?.dataEdge && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.dataEdge}</p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              {[
                { label: 'Gross Revenue', value: fmtMoney(s.gross) },
                {
                  label: 'vs Last Month',
                  value: s.grossMom === null || s.grossMom === undefined
                    ? '—' : `${s.grossMom > 0 ? '+' : ''}${s.grossMom}%`,
                  tone: s.grossMom,
                },
                {
                  label: 'vs Last Year',
                  value: s.grossYoy === null || s.grossYoy === undefined
                    ? '—' : `${s.grossYoy > 0 ? '+' : ''}${s.grossYoy}%`,
                  tone: s.grossYoy,
                },
                { label: 'Refunds', value: fmtMoney(s.refunds), muted: true },
                { label: 'Net', value: fmtMoney(s.net), muted: true },
                { label: 'Profit Centers', value: fmtInt(s.categories), muted: true },
              ].map(t => (
                <div key={t.label} className="px-5 py-4 text-center min-w-[130px] flex-1">
                  <p
                    className={`text-xl font-bold tabular-nums ${t.muted ? 'text-text-muted' : 'text-text-primary'}`}
                    style={t.tone !== undefined && t.tone !== null && t.tone !== 0
                      ? { color: t.tone > 0 ? GOOD_COLOR : BAD_COLOR } : undefined}
                  >
                    {t.value}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* The windows being compared, stated plainly. A percentage against an
              unnamed period is a number nobody can check. */}
          <div className="bg-surface rounded-xl border border-border p-3">
            <p className="text-[11px] text-text-muted">
              {data.meta?.spanDays} days ending {data.meta?.end}, against{' '}
              {data.meta?.lastMonthStart} to {data.meta?.lastMonthEnd} and{' '}
              {data.meta?.lastYearStart} to {data.meta?.lastYearEnd} — the same number of days each
              time, so a short month cannot read as a decline. {data.notes?.totals}
            </p>
          </div>

          <MultiTrend
            title="Revenue by Priority Profit Center"
            months={data.trendMonths || []}
            series={data.trendSeries || []}
            format="int"
            subtitle={`${(data.trendSeries || []).length} centers`}
          />

          <CategoryTable
            title="Priority Profit Centers"
            subtitle="click a row for its last six months"
            rows={headline}
            sparklines={sparklines}
            meta={data.meta}
            openKey={openKey}
            setOpenKey={setOpenKey}
          />

          <CategoryTable
            title="All Profit Centers"
            subtitle={`every center, A to Z — ${all.length} in total`}
            rows={all}
            sparklines={sparklines}
            meta={data.meta}
            openKey={openKey}
            setOpenKey={setOpenKey}
          />

          <RankedBars
            title="Revenue by Club"
            rows={(data.byClub || []).map(c => ({ ...c, label: CLUB_LABEL(c.slug) }))}
            labelKey="label" valueKey="revenue" format="int"
            emptyText="No revenue in this selection."
          />

          <p className="text-[11px] text-text-muted px-1">{data.notes?.mapping}</p>
        </>
      )}
    </div>
  )
}

function Toolbar() {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <span className="text-[11px] text-text-muted">
      Both tables open a row for its six-month trend
    </span>,
    slot
  )
}
