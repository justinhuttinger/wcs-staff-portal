import { useState } from 'react'
import { getPTHealth } from '../../../lib/api'
import MobileLoading from '../MobileLoading'
import { useCancellableFetch } from '../../../hooks/useCancellableFetch'

// ── Formatters (mirrors PTHealthReport.jsx) ──────────────────────────────────

function fmtMoney(n) {
  const v = Number(n || 0)
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  return `${sign}$${abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

function fmtSignedNum(n) {
  const v = Number(n || 0)
  if (v > 0) return `+${v.toLocaleString()}`
  if (v < 0) return v.toLocaleString()
  return '0'
}

function fmtSignedMoney(n) {
  const v = Number(n || 0)
  return (v > 0 ? '+' : '') + fmtMoney(v)
}

function pct(numerator, denominator) {
  const n = Number(numerator || 0)
  const d = Number(denominator || 0)
  if (!d) return '0%'
  return `${Math.round((n / d) * 100)}%`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="bg-surface/95 backdrop-blur-sm rounded-lg border border-border px-3 py-1.5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

function toneClasses(tone) {
  if (tone === 'green') return 'border-green-200 bg-green-50'
  if (tone === 'red') return 'border-red-200 bg-red-50'
  if (tone === 'blue') return 'border-blue-200 bg-blue-50'
  return 'border-border bg-surface'
}

function valueColor(v) {
  const n = Number(v || 0)
  if (n > 0) return 'text-green-600'
  if (n < 0) return 'text-red-600'
  return 'text-text-primary'
}

/** Big headline card — net change style */
function HeadlineCard({ label, value, sub, tone }) {
  return (
    <div className={`rounded-2xl border p-4 ${toneClasses(tone)}`}>
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">{label}</p>
      <div className="text-3xl font-bold text-text-primary mt-1">{value}</div>
      {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

/** Detail card with a big number + row breakdown */
function DetailCard({ label, value, rows, tone }) {
  return (
    <div className={`rounded-2xl border p-4 ${toneClasses(tone)}`}>
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-text-primary mt-1">{value}</p>
      <div className="mt-3 space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs">
            <span className="text-text-muted">{k}</span>
            <span className="font-semibold text-text-primary">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Percentage strip row */
function PctStrip({ label, numerator, denominator, subLabel }) {
  const ratio = Number(denominator || 0) > 0 ? Math.round((Number(numerator || 0) / Number(denominator || 0)) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">{label}</span>
        <span className="font-semibold text-text-primary">{numerator} <span className="text-text-muted font-normal">/ {denominator} ({ratio}%)</span></span>
      </div>
      <div className="h-1.5 bg-bg rounded-full overflow-hidden">
        <div className="h-full bg-wcs-red rounded-full" style={{ width: `${ratio}%` }} />
      </div>
      {subLabel && <p className="text-[10px] text-text-muted">{subLabel}</p>}
    </div>
  )
}

/** Per-location accordion row */
function LocationRow({ c }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface hover:bg-bg/60 transition-colors"
      >
        <span className="text-sm font-semibold text-text-primary">{c.clubName}</span>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold ${valueColor(c.netClients)}`}>{fmtSignedNum(c.netClients)} clients</span>
          <span className={`text-xs font-semibold ${valueColor(c.netRevenue)}`}>{fmtSignedMoney(c.netRevenue)}</span>
          <svg className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 space-y-3 bg-bg border-t border-border">
          {/* Day Ones */}
          <div>
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">Day Ones</p>
            <div className="space-y-1.5">
              <PctStrip label="Set → Show" numerator={c.dayOnes.show} denominator={c.dayOnes.set} />
              <PctStrip label="Show → Close" numerator={c.dayOnes.close} denominator={c.dayOnes.show} />
            </div>
            <div className="flex gap-4 mt-2 text-xs">
              <span className="text-text-muted">Set <span className="font-semibold text-text-primary">{c.dayOnes.set}</span></span>
              <span className="text-text-muted">Show <span className="font-semibold text-text-primary">{c.dayOnes.show}</span></span>
              <span className="text-text-muted">Close <span className="font-semibold text-text-primary">{c.dayOnes.close}</span></span>
            </div>
          </div>
          {/* New PT */}
          <div>
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">New PT</p>
            <div className="space-y-1">
              {[
                ['New Clients', c.newPT.newClientCount],
                ['Resigns', c.newPT.resignCount],
                ['Revenue', fmtMoney(c.newPT.revenue)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-text-muted">{k}</span>
                  <span className="font-semibold text-text-primary">{v}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Deactivated */}
          <div>
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">Deactivated PT</p>
            <div className="space-y-1">
              {[
                ['Deactivated RS', c.deactivated.deactivatedRSCount],
                ['PIF Burned', c.deactivated.burnedPIFCount],
                ['Monthly RS lost', fmtMoney(c.deactivated.deactivatedRSValue)],
                ['PIF total lost', fmtMoney(c.deactivated.burnedPIFValue)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-text-muted">{k}</span>
                  <span className="font-semibold text-text-primary">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MobilePTHealth({ startDate, endDate, locationSlug }) {
  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      if (!startDate || !endDate) return Promise.resolve(null)
      return getPTHealth(
        { start_date: startDate, end_date: endDate, location_slug: locationSlug || 'all' },
        { cache: true, signal }
      )
    },
    [startDate, endDate, locationSlug]
  )

  if (loading) return <MobileLoading variant="report" className="px-0 py-0" />

  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
      <p className="text-sm text-red-600">{error.message || String(error)}</p>
    </div>
  )

  if (!data) return null

  const t = data.totals
  const netClientsTone = t.netClients > 0 ? 'green' : t.netClients < 0 ? 'red' : 'default'
  const netRevenueTone = t.netRevenue > 0 ? 'green' : t.netRevenue < 0 ? 'red' : 'default'

  return (
    <div className="space-y-4 px-4 pb-6">

      {/* ── Net Change Headlines ── */}
      <SectionHeader title="Net Change" />

      <div className="grid grid-cols-2 gap-3">
        <HeadlineCard
          label="Net Clients"
          value={<span className={valueColor(t.netClients)}>{fmtSignedNum(t.netClients)}</span>}
          sub={`${t.newPT.count} new − ${t.deactivated.count} deactivated`}
          tone={netClientsTone}
        />
        <HeadlineCard
          label="Net Revenue"
          value={<span className={valueColor(t.netRevenue)}>{fmtSignedMoney(t.netRevenue)}</span>}
          sub={`${fmtMoney(t.newPT.revenue)} new − ${fmtMoney(t.deactivated.value)} lost`}
          tone={netRevenueTone}
        />
      </div>

      {/* ── Day Ones ── */}
      <SectionHeader title="Day Ones" />

      <DetailCard
        label="Day Ones"
        value={t.dayOnes.set}
        rows={[
          ['Set', t.dayOnes.set],
          [`Show (${pct(t.dayOnes.show, t.dayOnes.set)})`, t.dayOnes.show],
          [`Close (${pct(t.dayOnes.close, t.dayOnes.show)} of show)`, t.dayOnes.close],
        ]}
        tone="blue"
      />

      <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
        <PctStrip
          label="Set → Show rate"
          numerator={t.dayOnes.show}
          denominator={t.dayOnes.set}
        />
        <PctStrip
          label="Show → Close rate"
          numerator={t.dayOnes.close}
          denominator={t.dayOnes.show}
        />
        <PctStrip
          label="Set → Close rate"
          numerator={t.dayOnes.close}
          denominator={t.dayOnes.set}
        />
      </div>

      {/* ── New PT Sales ── */}
      <SectionHeader title="New PT Sales" />

      <DetailCard
        label="New PT Sales"
        value={t.newPT.count}
        rows={[
          ['New Clients', t.newPT.newClientCount],
          ['Resigns', t.newPT.resignCount],
          ['Revenue', fmtMoney(t.newPT.revenue)],
        ]}
        tone="green"
      />

      {/* ── Deactivated PT ── */}
      <SectionHeader title="Deactivated PT" />

      <DetailCard
        label="Deactivated PT"
        value={t.deactivated.count}
        rows={[
          ['Deactivated RS', t.deactivated.deactivatedRSCount],
          ['PIF Burned', t.deactivated.burnedPIFCount],
          ['Monthly RS lost', fmtMoney(t.deactivated.deactivatedRSValue)],
          ['PIF total lost', fmtMoney(t.deactivated.burnedPIFValue)],
        ]}
        tone="red"
      />

      {/* ── By Location ── */}
      {data.byLocation.length > 0 && (
        <>
          <SectionHeader title="By Location" />
          <div className="space-y-2">
            {data.byLocation.map(c => (
              <LocationRow key={c.locationSlug} c={c} />
            ))}
          </div>

          {/* Totals summary row */}
          <div className="bg-surface rounded-2xl border border-border p-4">
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-3">All Locations Totals</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              {[
                ['Day Ones Set', t.dayOnes.set],
                ['Day Ones Show', t.dayOnes.show],
                ['Day Ones Close', t.dayOnes.close],
                ['New PT', t.newPT.count],
                ['New Revenue', fmtMoney(t.newPT.revenue)],
                ['Deactivated', t.deactivated.count],
                ['Lost $', fmtMoney(t.deactivated.value)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-text-muted">{k}</span>
                  <span className="font-semibold text-text-primary">{v}</span>
                </div>
              ))}
              <div className="flex justify-between text-xs col-span-2 border-t border-border pt-1.5 mt-0.5">
                <span className="text-text-muted">Net Clients</span>
                <span className={`font-bold ${valueColor(t.netClients)}`}>{fmtSignedNum(t.netClients)}</span>
              </div>
              <div className="flex justify-between text-xs col-span-2">
                <span className="text-text-muted">Net Revenue</span>
                <span className={`font-bold ${valueColor(t.netRevenue)}`}>{fmtSignedMoney(t.netRevenue)}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {data.byLocation.length === 0 && (
        <div className="bg-surface rounded-2xl border border-border px-4 py-8 text-center">
          <p className="text-sm text-text-muted">No data in this date range.</p>
        </div>
      )}

      {/* ── Footnote ── */}
      <div className="bg-surface border border-border rounded-2xl px-4 py-3 text-xs text-text-primary leading-relaxed">
        <span className="font-semibold">Set</span> = Day One booked in the range.{' '}
        <span className="font-semibold">Show</span> = day_one_status is <em>Completed</em>.{' '}
        <span className="font-semibold">Close</span> = Show ∩ day_one_sale is <em>Sale</em>.{' '}
        Net = (new − deactivated) for both counts and dollars.
      </div>
    </div>
  )
}
