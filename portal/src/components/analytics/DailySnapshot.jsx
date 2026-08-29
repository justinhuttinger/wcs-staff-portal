import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtMoney, GOOD_COLOR, BAD_COLOR, colorFor } from './chartPalette'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'

// ---------------------------------------------------------------------------
// Daily Snapshot — Analytics (admin only)
//
// ONE DAY, AND ONLY EVER ONE DAY. This report owns its own date and ignores the
// shell's range: Today, Yesterday, or a specific day. A range picker on a card
// whose every label says "day" would be an invitation to ask a question it
// cannot answer.
//
// COMPARED WITH YESTERDAY, and shown as a plain difference rather than a
// percentage. On a single day a base of one turns one extra sale into +100%,
// which reads as a story and is not one. The fourteen-day chart underneath is
// where direction should be read from.
// ---------------------------------------------------------------------------

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'custom', label: 'Pick a day' },
]

/** Local calendar date, so "today" means the club's today. */
function isoToday(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toLocaleDateString('en-CA')
}

function formatValue(v, format) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (format === 'money') return fmtMoney(v)
  if (format === 'pct') return `${v}%`
  return fmtInt(v)
}

/** The day-over-day movement, coloured by whether it is the good direction. */
function Delta({ stat }) {
  if (stat.delta === null || stat.delta === undefined || stat.delta === 0) {
    return <span className="text-[11px] text-text-muted">no change</span>
  }
  const good = stat.betterWhen === 'down' ? stat.delta < 0 : stat.delta > 0
  const sign = stat.delta > 0 ? '+' : ''
  return (
    <span className="text-[11px] tabular-nums" style={{ color: good ? GOOD_COLOR : BAD_COLOR }}>
      {sign}{formatValue(stat.delta, stat.format)} vs yesterday
    </span>
  )
}

/**
 * Fourteen days of one measure.
 *
 * Bars rather than a line: these are discrete days, and a line implies a
 * continuous quantity that was sampled — it invites reading a slope between
 * Saturday and Monday that does not mean anything. The selected day is solid,
 * the rest dimmed.
 *
 * Zero-based, and negative values draw below the axis, so a day that lost more
 * members than it gained reads as a loss rather than a short bar.
 */
function DayBars({ title, days, valueKey, format, selected }) {
  const values = days.map(d => d[valueKey] || 0)
  const max = Math.max(1, ...values.map(Math.abs))
  const hasNegative = values.some(v => v < 0)
  const colour = colorFor(valueKey, 0)
  const H = 92
  const zeroY = hasNegative ? H / 2 : H

  return (
    <div className="bg-surface rounded-xl border border-border p-3">
      <p className="text-xs font-bold text-text-primary mb-2">{title}</p>
      <div className="flex items-end gap-1" style={{ height: H }}>
        {days.map(d => {
          const v = d[valueKey] || 0
          const h = (Math.abs(v) / max) * (hasNegative ? H / 2 : H)
          const isSel = d.day === selected
          return (
            <div key={d.day} className="flex-1 flex flex-col justify-end h-full relative"
              title={`${d.day}: ${formatValue(v, format)}`}>
              {hasNegative && <div style={{ height: zeroY - (v > 0 ? h : 0) }} />}
              <div
                className="w-full rounded-sm"
                style={{
                  height: Math.max(2, h),
                  background: v < 0 ? BAD_COLOR : colour,
                  opacity: isSel ? 1 : 0.38,
                }}
              />
              {hasNegative && v > 0 && <div style={{ height: H / 2 }} />}
            </div>
          )
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {days.map(d => (
          <span key={d.day}
            className={`flex-1 text-center text-[9px] tabular-nums ${
              d.day === selected ? 'text-text-primary font-semibold' : 'text-text-muted'
            }`}>
            {d.day.slice(8)}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function DailySnapshot({ locationSlug }) {
  const [range, setRange] = useState('today')
  const [customDay, setCustomDay] = useState(isoToday())

  const day = useMemo(() => {
    if (range === 'today') return isoToday()
    if (range === 'yesterday') return isoToday(-1)
    return customDay
  }, [range, customDay])

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all', day })
    return p.toString()
  }, [day, locationSlug])

  const { data, loading, error, retrying } = useCancellableFetch(
    signal => api(`/analytics/daily-snapshot?${query}`, { cache: true, signal }),
    [query]
  )

  const stats = data?.stats || []
  const days = data?.days || []

  return (
    <div className="space-y-3">
      <Toolbar
        range={range} setRange={setRange}
        customDay={customDay} setCustomDay={setCustomDay}
      />

      {loading && <DesktopLoading retrying={retrying} />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Above the numbers. Someone who has already read $0 revenue as a bad
              day will not come back for a footnote. */}
          {data.notes?.revenue && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.revenue}</p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-sm font-bold text-text-primary">
              {new Date(`${data.day}T12:00:00`).toLocaleDateString(undefined, {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })}
            </p>
            <p className="text-[11px] text-text-muted">{data.notes?.comparison}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-2">
            {stats.map(s => (
              <div key={s.key} className="bg-surface rounded-xl border border-border px-3 py-2.5">
                <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide leading-tight">
                  {s.label}
                </p>
                <p className="text-xl font-bold tabular-nums text-text-primary mt-0.5">
                  {formatValue(s.value, s.format)}
                </p>
                <Delta stat={s} />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <DayBars title="Joined" days={days} valueKey="newMembers" format="int" selected={data.day} />
            <DayBars title="Left" days={days} valueKey="lostMembers" format="int" selected={data.day} />
            <DayBars title="Net Members" days={days} valueKey="netMembers" format="int" selected={data.day} />
            <DayBars title="Day Ones" days={days} valueKey="dayOnes" format="int" selected={data.day} />
            <DayBars title="Day Ones Sold" days={days} valueKey="dayOnesSold" format="int" selected={data.day} />
            <DayBars title="PT Sold" days={days} valueKey="ptNewValue" format="money" selected={data.day} />
          </div>

          <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
            <p className="text-xs font-bold text-text-primary mb-2">
              Last {data.meta?.seriesDays} days
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="text-left font-semibold py-1.5">Day</th>
                  <th className="text-right font-semibold py-1.5">Joined</th>
                  <th className="text-right font-semibold py-1.5">Left</th>
                  <th className="text-right font-semibold py-1.5">Net</th>
                  <th className="text-right font-semibold py-1.5">Day Ones</th>
                  <th className="text-right font-semibold py-1.5">Sold</th>
                  <th className="text-right font-semibold py-1.5">PT Sold</th>
                  <th className="text-right font-semibold py-1.5">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map(d => (
                  <tr key={d.day}
                    className={`border-b border-border/60 last:border-0 ${
                      d.day === data.day ? 'font-semibold' : ''
                    }`}>
                    <td className="py-1.5 text-text-primary">{d.day}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(d.newMembers)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(d.lostMembers)}</td>
                    <td className="py-1.5 text-right tabular-nums"
                      style={{ color: d.netMembers < 0 ? BAD_COLOR : d.netMembers > 0 ? GOOD_COLOR : undefined }}>
                      {d.netMembers > 0 ? '+' : ''}{fmtInt(d.netMembers)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(d.dayOnes)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(d.dayOnesSold)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtMoney(d.ptNewValue)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-primary">{fmtMoney(d.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Toolbar({ range, setRange, customDay, setCustomDay }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
        Day
        <select value={range} onChange={e => setRange(e.target.value)} className={cls}>
          {RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </label>
      {range === 'custom' && (
        <input
          type="date"
          value={customDay}
          max={isoToday()}
          onChange={e => setCustomDay(e.target.value)}
          className={cls}
        />
      )}
    </div>,
    slot
  )
}
