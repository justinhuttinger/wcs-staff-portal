import React, { Fragment, useMemo } from 'react'
import { getCheckinsReport } from '../../../lib/api'
import MobileLoading from '../MobileLoading'
import { useCancellableFetch } from '../../../hooks/useCancellableFetch'

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, h) => h)

function formatHour(h) {
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

function formatHourLong(h) {
  if (h === 0) return '12:00 AM'
  if (h === 12) return '12:00 PM'
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-3">
      <p className="text-[10px] text-text-muted uppercase tracking-wide font-semibold">{label}</p>
      <p className="text-2xl font-bold text-text-primary mt-1">{value}</p>
      {sub && <p className="text-[10px] text-text-muted mt-0.5 leading-tight">{sub}</p>}
    </div>
  )
}

function MiniBars({ title, points }) {
  const total = points.reduce((s, p) => s + p.count, 0)
  if (points.length === 0 || total === 0) {
    return (
      <div className="bg-surface rounded-2xl border border-border p-4 text-center">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{title}</p>
        <p className="text-sm text-text-muted">No data</p>
      </div>
    )
  }
  const max = Math.max(...points.map(p => p.count), 1)
  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{title}</p>
      <div className="flex items-end gap-[2px] h-20">
        {points.map((p, i) => (
          <div
            key={i}
            className="flex-1 bg-wcs-red rounded-sm"
            style={{ height: `${(p.count / max) * 100}%`, minHeight: p.count > 0 ? '2px' : '0' }}
            title={`${p.date}: ${p.count.toLocaleString()}`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] text-text-muted">
        <span>{points[0].date}</span>
        <span>{points[points.length - 1].date}</span>
      </div>
    </div>
  )
}

function DowBars({ rows }) {
  const max = Math.max(...rows.map(r => r.total), 1)
  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">By Day of Week</p>
      <div className="space-y-1.5">
        {rows.map(r => (
          <div key={r.dow} className="flex items-center gap-2 text-xs">
            <span className="w-8 text-text-muted font-medium">{r.dow}</span>
            <div className="flex-1 h-4 bg-bg rounded overflow-hidden">
              <div
                className="h-full bg-wcs-red"
                style={{ width: `${(r.total / max) * 100}%` }}
              />
            </div>
            <span className="w-14 text-right font-semibold text-text-primary tabular-nums">
              {r.total.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Heatmap({ grid }) {
  const max = useMemo(() => {
    let m = 0
    for (const row of grid) for (const v of row) if (v > m) m = v
    return m
  }, [grid])

  function cellColor(v) {
    if (max === 0 || v === 0) return '#f3f4f6'
    const t = v / max
    const lightness = 95 - t * 60
    return `hsl(0, 75%, ${lightness}%)`
  }

  function cellTextColor(v) {
    if (max === 0 || v === 0) return '#9ca3af'
    return v / max > 0.55 ? '#ffffff' : '#1f2937'
  }

  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
        Heatmap — Day × Hour
      </p>
      <div className="overflow-x-auto -mx-2 px-2">
        <div
          className="grid"
          style={{ gridTemplateColumns: '32px repeat(24, minmax(20px, 1fr))', gap: '2px', minWidth: '520px' }}
        >
          <div />
          {HOURS.map(h => (
            <div key={h} className="text-[9px] text-text-muted text-center font-medium">
              {h % 3 === 0 ? formatHour(h) : ''}
            </div>
          ))}
          {grid.map((row, dow) => (
            <Fragment key={dow}>
              <div className="text-[10px] text-text-muted font-medium pr-1 flex items-center justify-end">
                {DOW_NAMES[dow]}
              </div>
              {row.map((v, h) => (
                <div
                  key={`${dow}-${h}`}
                  className="aspect-square rounded-sm flex items-center justify-center text-[8px] font-semibold tabular-nums"
                  style={{ backgroundColor: cellColor(v), color: cellTextColor(v) }}
                  title={`${DOW_NAMES[dow]} ${formatHourLong(h)} — ${v.toFixed(1)} avg`}
                >
                  {v >= 1 ? Math.round(v) : ''}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-3 text-[10px] text-text-muted">
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <div
            key={i}
            className="w-4 h-2.5 rounded-sm border border-border"
            style={{ backgroundColor: `hsl(0, 75%, ${95 - t * 60}%)` }}
          />
        ))}
        <span>More</span>
        {max > 0 && <span className="ml-auto">peak ≈ {max.toFixed(1)}/hr</span>}
      </div>
    </div>
  )
}

function HourRanking({ title, hours, accent }) {
  if (!hours || hours.length === 0) return null
  const max = Math.max(...hours.map(x => x.avg), 1)
  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{title}</p>
      <div className="space-y-1.5">
        {hours.map(h => (
          <div key={h.hour} className="flex items-center gap-2 text-xs">
            <span className="w-12 text-text-muted font-medium tabular-nums">{formatHourLong(h.hour)}</span>
            <div className="flex-1 h-4 bg-bg rounded overflow-hidden">
              <div className="h-full" style={{ width: `${(h.avg / max) * 100}%`, backgroundColor: accent }} />
            </div>
            <span className="w-14 text-right font-semibold text-text-primary tabular-nums">
              {h.avg.toFixed(1)}/hr
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LocationList({ rows }) {
  if (!rows || rows.length === 0) return null
  const total = rows.reduce((s, r) => s + r.total, 0)
  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">By Location</p>
      <div className="space-y-1.5">
        {rows.map(r => (
          <div key={r.slug} className="flex items-center justify-between text-xs">
            <span className="capitalize text-text-primary font-medium">{r.slug}</span>
            <span className="text-text-muted tabular-nums">
              {r.total.toLocaleString()}{' '}
              <span className="text-[10px]">({total ? Math.round((r.total / total) * 100) : 0}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MobileCheckins({ startDate, endDate, locationSlug }) {
  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getCheckinsReport(params, { cache: true, signal })
    },
    [startDate, endDate, locationSlug]
  )

  if (loading) return <MobileLoading variant="report" className="px-0 py-0" />
  if (error) return <p className="text-wcs-red text-sm py-4 text-center">{error.message || String(error)}</p>
  if (!data) return null

  const s = data.summary || {}

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <KpiCard
          label="Total Check-ins"
          value={(s.total_checkins ?? 0).toLocaleString()}
          sub={`${s.days_with_data ?? 0} days w/ data`}
        />
        <KpiCard
          label="Member-Hours"
          value={(s.member_hours ?? 0).toLocaleString()}
          sub={s.visits_per_member_hour ? `${s.visits_per_member_hour}× per member-hr` : ''}
        />
        <KpiCard
          label="Avg Members / Hr"
          value={(s.avg_members_per_active_hour ?? 0).toLocaleString()}
          sub="while active"
        />
        <KpiCard
          label="Avg Check-ins / Day"
          value={(s.avg_per_open_day ?? 0).toLocaleString()}
        />
        <KpiCard
          label="Peak Day"
          value={s.peak_day ? s.peak_day.count.toLocaleString() : '—'}
          sub={s.peak_day ? s.peak_day.date : ''}
        />
        <KpiCard
          label="Peak Hour"
          value={s.peak_hour ? formatHour(s.peak_hour.hour) : '—'}
          sub={s.peak_hour ? `${s.peak_hour.avg.toFixed(1)} avg/hr` : ''}
        />
      </div>

      <MiniBars title="Check-ins by Day" points={data.by_date || []} />

      <Heatmap grid={data.heatmap || Array.from({ length: 7 }, () => Array(24).fill(0))} />

      <DowBars rows={data.by_dow || []} />

      <HourRanking title="Most Popular Hours" hours={data.popular_hours || []} accent="#e53e3e" />
      <HourRanking title="Least Popular Hours" hours={data.unpopular_hours || []} accent="#94a3b8" />

      <LocationList rows={data.by_location} />
    </div>
  )
}
