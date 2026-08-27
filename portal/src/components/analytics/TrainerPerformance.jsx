import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { fmtInt, fmtPct, fmtMoney } from './chartPalette'
import { zebra, HOVER_TINT } from './tableTints'

// ---------------------------------------------------------------------------
// Trainer Performance — Analytics (admin only)
//
// ONE ROW CAN BELONG TO TWO PEOPLE, on purpose. The session and member columns
// are whoever DELIVERED the training; Close Amount is whoever the COMMISSION
// was paid to. For July 2026 those disagree on 40% of the money, so the header
// groups the columns and says which is which — otherwise a manager with no
// sessions and $5,860 closed reads as a data error.
//
// The columns for Available Hours and Utilization Rate from the source
// dashboard are deliberately absent: ABC holds no hire date or scheduled
// availability, so both would be invented.
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: 'club', label: 'Club', format: 'text', align: 'left' },
  { key: 'lastSession', label: 'Last Session', format: 'date' },
  { key: 'uniqueMembers', label: 'Members', format: 'int', group: 'Delivered' },
  { key: 'completedSessions', label: 'Sessions', format: 'int' },
  { key: 'cancellationRate', label: 'Cancel %', format: 'pct' },
  { key: 'avgSessionMinutes', label: 'Avg Min', format: 'int' },
  { key: 'memberMonths', label: 'Months w/ Trainer', format: 'num' },
  { key: 'ptHours', label: 'PT Hours', format: 'num' },
  { key: 'classHours', label: 'Class Hours', format: 'num' },
  { key: 'dayOnesBooked', label: 'Day Ones Booked', format: 'int', group: 'Day Ones' },
  { key: 'dayOnesCompleted', label: 'Completed', format: 'int' },
  { key: 'dayOnesSold', label: 'Sold', format: 'int' },
  { key: 'closeRate', label: 'Close Rate', format: 'pct' },
  { key: 'closeAmount', label: 'PT Close Amount', format: 'money', group: 'Commission' },
]

function fmt(v, format) {
  if (v === null || v === undefined) return 'N/A'
  switch (format) {
    case 'money': return fmtMoney(v)
    case 'pct': return fmtPct(v)
    case 'num': return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })
    case 'date': return String(v)
    case 'text': return String(v)
    default: return fmtInt(v)
  }
}

function Tile({ tile }) {
  return (
    <div className="bg-surface rounded-xl border border-border px-3 py-2 text-center">
      <p className="text-lg font-bold tabular-nums text-text-primary">
        {tile.format === 'money' ? fmtMoney(tile.value)
          : tile.format === 'pct' ? fmtPct(tile.value)
          : tile.format === 'hours' ? fmt(tile.value, 'num')
          : fmtInt(tile.value)}
      </p>
      <p className="text-[10px] font-medium text-text-muted leading-tight mt-0.5">{tile.label}</p>
    </div>
  )
}

export default function TrainerPerformance({ startDate, endDate, locationSlug }) {
  const [sort, setSort] = useState('sessions_desc')

  const query = useMemo(() => new URLSearchParams({
    start: startDate, end: endDate, clubs: locationSlug || 'all', sort,
  }).toString(), [startDate, endDate, locationSlug, sort])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/trainer-performance?${query}`, { cache: true, signal }),
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

  const rows = data?.rows || []
  const anyEstimated = rows.some(r => r.closeAmountEstimated)

  return (
    <div className="space-y-3">
      <Toolbar sort={sort} setSort={setSort} sorts={data?.sorts || []} />

      <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-2">
        {(data?.tiles || []).map(t => <Tile key={t.key} tile={t} />)}
      </div>

      <div className="bg-surface rounded-xl border border-border">
        <div className="overflow-auto max-h-[calc(100vh-18rem)]">
          <table className="min-w-max w-full text-sm border-separate border-spacing-0">
            <thead>
              {/* Grouping header: it is the only thing that stops "Sessions" and
                  "PT Close Amount" reading as one person's numbers. */}
              <tr>
                <th className="sticky left-0 top-0 z-40 bg-surface border-b border-border" />
                <th className="sticky top-0 z-30 bg-surface border-b border-border" colSpan={2} />
                <th className="sticky top-0 z-30 bg-surface border-b border-l border-border text-[10px] font-bold uppercase tracking-wide text-text-muted px-3 pt-2" colSpan={7}>
                  Delivered the training
                </th>
                <th className="sticky top-0 z-30 bg-surface border-b border-l border-border text-[10px] font-bold uppercase tracking-wide text-text-muted px-3 pt-2" colSpan={4}>
                  Ran the Day One
                </th>
                <th className="sticky top-0 z-30 bg-surface border-b border-l border-border text-[10px] font-bold uppercase tracking-wide text-text-muted px-3 pt-2" colSpan={1}>
                  Paid the commission
                </th>
              </tr>
              <tr>
                <th className="sticky left-0 top-7 z-40 bg-surface text-left font-semibold text-text-primary px-4 py-2 min-w-[170px] border-b border-border">
                  Trainer
                </th>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className={`sticky top-7 z-30 bg-surface font-semibold text-text-muted px-3 py-2 text-xs whitespace-nowrap border-b border-border ${col.group ? 'border-l' : ''} ${col.align === 'left' ? 'text-left' : 'text-right'}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.trainer} className="group">
                  <td className={`sticky left-0 z-20 px-4 py-1.5 text-text-primary font-medium whitespace-nowrap border-b border-border/60 ${zebra(i)} ${HOVER_TINT}`}>
                    {r.trainer}
                  </td>
                  {COLUMNS.map(col => (
                    <td
                      key={col.key}
                      className={`px-3 py-1.5 text-xs tabular-nums whitespace-nowrap border-b border-border/60 ${col.group ? 'border-l border-border' : ''} ${col.align === 'left' ? 'text-left' : 'text-right'} ${r[col.key] === null || r[col.key] === undefined ? 'text-text-muted' : 'text-text-primary'} ${zebra(i)} ${HOVER_TINT}`}
                    >
                      {fmt(r[col.key], col.format)}
                      {col.key === 'closeAmount' && r.closeAmountEstimated && (
                        <span
                          className="ml-1 text-[10px] text-amber-600 font-bold"
                          title="No commission record for at least one of these sales, so the trainer who delivered it stood in."
                        >*</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="text-sm text-text-muted text-center py-10">No trainer activity in this range.</p>
        )}
      </div>

      {anyEstimated && (
        <p className="text-[11px] text-text-muted px-1">
          <span className="text-amber-600 font-bold">*</span> No commission record for at least one of
          those sales, so the trainer who delivered it stood in. Commission data starts April 2026.
        </p>
      )}
    </div>
  )
}

function Toolbar({ sort, setSort, sorts }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  const wrap = 'flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide'
  return createPortal(
    <label className={wrap}>
      Sort
      <select value={sort} onChange={e => setSort(e.target.value)} className={cls}>
        {sorts.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </label>,
    slot
  )
}
