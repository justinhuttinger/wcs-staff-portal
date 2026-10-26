import { useState } from 'react'
import { getChildcareKioskReport } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtDay } from './chartPalette'
import { zebraColumn } from './charts'

// ---------------------------------------------------------------------------
// Childcare -> Kiosk Check-Ins (admin only)
//
// What the childcare iPad recorded (Admin -> Childcare Kiosk): one row per
// child per visit, all typed by the desk. Nothing is linked to ABC or to
// another visit, so "families" are grouped by parent name + phone as typed.
//
// A CHILD NOBODY CHECKED OUT HAS NO PICKUP TIME. Those visits are counted on
// their own and left out of stay lengths and the hourly grid rather than
// guessed at.
// ---------------------------------------------------------------------------

const TZ = 'America/Los_Angeles'
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
const localDate = iso => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const fmtHour = h => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—')

function fmtStay(min) {
  if (min == null) return '—'
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`
}

function fmtAge(months) {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} mo`
  if (m === 0) return `${y} yr${y === 1 ? '' : 's'}`
  return `${y} yr ${m} mo`
}

const PICKUP = { same_parent: 'Parent', approved_alternate: 'Approved', other: 'Someone else' }

function KindBadge({ kind }) {
  return kind === 'monthly'
    ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 border border-blue-500/30">Monthly</span>
    : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 border border-amber-500/30">Drop-in</span>
}

function Th({ cols }) {
  return (
    <thead>
      <tr className="border-b border-border text-text-muted">
        {cols.map(([label, right], i) => (
          <th key={label} className={`py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
            style={zebraColumn(i)}>{label}</th>
        ))}
      </tr>
    </thead>
  )
}

export default function ChildcareKiosk({ startDate, endDate, locationSlug }) {
  const { data, loading, error, retrying } = useCancellableFetch(
    signal => getChildcareKioskReport(
      { start: startDate, end: endDate, locationSlug },
      { cache: true, signal }
    ),
    [startDate, endDate, locationSlug]
  )

  if (loading) return <DesktopLoading retrying={retrying} />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }
  if (!data) return null

  const t = data.totals
  if (t.visits === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-text-muted">No children were checked in on the childcare kiosk in this range.</p>
        <p className="text-[11px] text-text-muted/70 mt-2 max-w-md mx-auto">
          Check-ins come from the childcare iPad link. Create a club's link in Admin → Childcare Kiosk.
        </p>
      </div>
    )
  }

  const outCount = t.pickup.same_parent + t.pickup.approved_alternate + t.pickup.other

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <div className="flex min-w-max divide-x divide-border">
          {[
            { label: 'Visits', value: fmtInt(t.visits), sub: `${fmtInt(t.days)} day${t.days === 1 ? '' : 's'} with check-ins` },
            { label: 'Monthly', value: pct(t.monthly, t.visits), sub: `${fmtInt(t.monthly)} visits` },
            { label: 'Drop-in', value: pct(t.drop_in, t.visits), sub: `${fmtInt(t.drop_in)} visits` },
            { label: 'Avg Stay', value: fmtStay(t.avg_stay_min), sub: `median ${fmtStay(t.median_stay_min)}` },
            { label: 'Under 1 Year', value: fmtInt(t.under1), sub: pct(t.under1, t.visits) + ' of visits' },
            { label: 'Someone Else Picked Up', value: fmtInt(t.pickup.other), sub: `${fmtInt(t.pickup.approved_alternate)} approved at check-in`, muted: true },
            { label: 'Not Checked Out', value: fmtInt(t.not_checked_out), sub: outCount ? `${fmtInt(outCount)} checked out` : 'closed at end of day', muted: true },
          ].map(c => (
            <div key={c.label} className="px-5 py-4 text-center min-w-[140px] flex-1">
              <p className={`text-xl font-bold tabular-nums ${c.muted ? 'text-text-muted' : 'text-text-primary'}`}>{c.value}</p>
              <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{c.label}</p>
              <p className="text-[10px] text-text-muted/70 mt-0.5 leading-tight">{c.sub}</p>
            </div>
          ))}
        </div>
      </div>

      <HourGrid rows={data.hourly || []} />
      {(data.by_club || []).length > 1 && <ByClub rows={data.by_club} />}
      <DropInFamilies rows={data.drop_in_families || []} />
      <VisitLog rows={data.log || []} />
    </div>
  )
}

/**
 * Average children in the room, weekday x hour. Each weekday is averaged over
 * the days the kiosk was used that weekday, so a day with no check-ins (room
 * closed, or the iPad not used) never reads as an empty room.
 */
function HourGrid({ rows }) {
  if (rows.length === 0) return null
  const hours = rows[0].hours.map(h => h.hour)
  const max = Math.max(1, ...rows.flatMap(r => r.hours.map(h => h.avg)))

  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">Average Children in the Room</p>
        <p className="text-[11px] text-text-muted">by hour, averaged over days with check-ins · hover for peak</p>
      </div>
      <table className="text-sm">
        <thead>
          <tr className="text-text-muted">
            <th className="py-1 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide">Day</th>
            {hours.map(h => (
              <th key={h} className="py-1 px-0.5 text-[10px] font-semibold text-center min-w-[34px]">{fmtHour(h)}</th>
            ))}
            <th className="py-1 pl-3 text-right text-[11px] font-semibold uppercase tracking-wide">Days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.day_of_week}>
              <td className="py-0.5 pr-3 text-text-primary whitespace-nowrap">{r.day_of_week.slice(0, 3)}</td>
              {r.hours.map(h => {
                const share = h.avg / max
                return (
                  <td key={h.hour} className="p-0.5">
                    <div
                      title={`${r.day_of_week} ${fmtHour(h.hour)}: avg ${h.avg}, peak ${h.peak}`}
                      className={`h-8 rounded flex items-center justify-center text-[11px] tabular-nums ${share > 0.55 ? 'text-white font-semibold' : 'text-text-primary'}`}
                      style={{ background: h.avg > 0 ? `color-mix(in srgb, var(--color-wcs-red) ${Math.round(12 + share * 78)}%, transparent)` : 'transparent' }}
                    >
                      {h.avg > 0 ? h.avg : <span className="text-border">·</span>}
                    </div>
                  </td>
                )
              })}
              <td className="py-0.5 pl-3 text-right tabular-nums text-text-muted">{fmtInt(r.days)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ByClub({ rows }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <p className="text-xs font-bold text-text-primary mb-2">By Club</p>
      <table className="w-full text-sm">
        <Th cols={[['Club'], ['Visits', 1], ['Per Day', 1], ['Monthly', 1], ['Drop-in', 1], ['Under 1', 1], ['Avg Stay', 1], ['Someone Else', 1], ['Not Checked Out', 1]]} />
        <tbody>
          {rows.map(c => (
            <tr key={c.club_number} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 px-2 text-text-primary whitespace-nowrap" style={zebraColumn(0)}>{c.name}</td>
              <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-text-primary" style={zebraColumn(1)}>{fmtInt(c.visits)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(2)}>{c.avg_per_day}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(3)}>{fmtInt(c.monthly)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(4)}>{fmtInt(c.drop_in)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(5)}>{fmtInt(c.under1)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(6)}>{fmtStay(c.avg_stay_min)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(7)}>{fmtInt(c.other_pickups)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(8)}>{fmtInt(c.not_checked_out)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Drop-in families, most days first: the people a monthly plan would save
 * money. Grouped by parent name + phone exactly as typed.
 */
function DropInFamilies({ rows }) {
  const [limit, setLimit] = useState(15)
  if (rows.length === 0) return null
  const shown = rows.slice(0, limit)
  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">Drop-in Families</p>
        <p className="text-[11px] text-text-muted">most days first · grouped by parent name + phone as typed</p>
      </div>
      <table className="w-full text-sm">
        <Th cols={[['Parent'], ['Phone'], ['Club'], ['Children'], ['Days', 1], ['Visits', 1], ['Last Visit', 1]]} />
        <tbody>
          {shown.map(f => (
            <tr key={`${f.club}|${f.parent}|${f.phone}`} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 px-2 text-text-primary whitespace-nowrap" style={zebraColumn(0)}>{f.parent}</td>
              <td className="py-1.5 px-2 text-text-muted whitespace-nowrap" style={zebraColumn(1)}>{f.phone}</td>
              <td className="py-1.5 px-2 text-text-muted whitespace-nowrap" style={zebraColumn(2)}>{f.club}</td>
              <td className="py-1.5 px-2 text-text-muted" style={zebraColumn(3)}>{f.children.join(', ')}</td>
              <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-text-primary" style={zebraColumn(4)}>{fmtInt(f.days)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(5)}>{fmtInt(f.visits)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted whitespace-nowrap" style={zebraColumn(6)}>{fmtDay(localDate(f.last_visit))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <button type="button" onClick={() => setLimit(l => l + 50)}
          className="mt-2 w-full py-1.5 rounded-lg border border-border bg-bg text-xs text-text-muted hover:text-text-primary">
          Show more ({fmtInt(rows.length - shown.length)} more)
        </button>
      )}
    </div>
  )
}

function VisitLog({ rows }) {
  const [limit, setLimit] = useState(40)
  const shown = rows.slice(0, limit)
  return (
    <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-text-primary">Visit Log</p>
        <p className="text-[11px] text-text-muted">newest first</p>
      </div>
      <table className="w-full text-sm">
        <Th cols={[['Date'], ['Club'], ['Child'], ['Age', 1], ['Parent'], ['Type'], ['In', 1], ['Out', 1], ['Stay', 1], ['Picked Up By']]} />
        <tbody>
          {shown.map(v => (
            <tr key={v.id} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 px-2 text-text-primary whitespace-nowrap" style={zebraColumn(0)}>{fmtDay(localDate(v.checked_in_at))}</td>
              <td className="py-1.5 px-2 text-text-muted whitespace-nowrap" style={zebraColumn(1)}>{v.club}</td>
              <td className="py-1.5 px-2 text-text-primary whitespace-nowrap" style={zebraColumn(2)}>{v.child}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted whitespace-nowrap" style={zebraColumn(3)}>{fmtAge(v.child_age_months)}</td>
              <td className="py-1.5 px-2 text-text-muted whitespace-nowrap" style={zebraColumn(4)}>{v.parent}</td>
              <td className="py-1.5 px-2" style={zebraColumn(5)}><KindBadge kind={v.membership_kind} /></td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted whitespace-nowrap" style={zebraColumn(6)}>{fmtTime(v.checked_in_at)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted whitespace-nowrap" style={zebraColumn(7)}>
                {v.checked_out_at ? fmtTime(v.checked_out_at) : v.auto_closed ? <span className="text-amber-600">not checked out</span> : 'in room'}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-text-muted whitespace-nowrap" style={zebraColumn(8)}>{fmtStay(v.stay_min)}</td>
              <td className="py-1.5 px-2 text-text-muted whitespace-nowrap" style={zebraColumn(9)}>
                {v.picked_up_by ? (
                  <>
                    <span className="text-text-primary">{v.picked_up_by}</span>
                    {v.checked_out_by !== 'same_parent' && <span className="ml-1 text-[11px]">({PICKUP[v.checked_out_by]})</span>}
                  </>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <button type="button" onClick={() => setLimit(l => l + 100)}
          className="mt-2 w-full py-1.5 rounded-lg border border-border bg-bg text-xs text-text-muted hover:text-text-primary">
          Show more ({fmtInt(rows.length - shown.length)} older)
        </button>
      )}
    </div>
  )
}
