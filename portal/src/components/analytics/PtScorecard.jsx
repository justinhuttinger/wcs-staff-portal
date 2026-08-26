import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'

// ---------------------------------------------------------------------------
// PT Scorecard — Analytics (admin only)
//
// The Day One funnel and PT money per club, with three adjustable goals.
//
// Only Book, Show and Close carry goals — Justin does not run revenue or draft
// targets, so those columns from the source dashboard are deliberately absent
// rather than invented.
//
// Diff columns are the one place colour is used, and it is applied by whether
// the movement is GOOD rather than by sign: every diff here is "actual minus
// goal", so above is good in all three. The sign is always printed, so colour
// never carries the meaning alone.
// ---------------------------------------------------------------------------

const GOALS = [
  { key: 'book', label: 'Book Goal %' },
  { key: 'show', label: 'Show Goal %' },
  { key: 'close', label: 'Close Goal %' },
]

const COLUMNS = [
  { key: 'ptRevenue', label: 'PT Revenue', format: 'money' },
  { key: 'newMembers', label: 'New Members', format: 'int' },
  { key: 'ptOnJoinPct', label: '% w/ PT on Join', format: 'pct' },
  { key: 'bookCount', label: 'Book Count', format: 'int', group: true },
  { key: 'bookPct', label: 'Book %', format: 'pct' },
  { key: 'bookGoal', label: 'Book Goal', format: 'int', goal: true },
  { key: 'bookDiff', label: 'Book Diff', format: 'signed', diff: true },
  { key: 'bookOnJoinCount', label: 'Book on Join', format: 'int', group: true },
  { key: 'bookOnJoinPct', label: 'Book on Join %', format: 'pct' },
  { key: 'setToDate', label: 'Set to Date', format: 'int', group: true },
  { key: 'setInclFuture', label: 'Set incl. Future', format: 'int' },
  { key: 'showCount', label: 'Show Count', format: 'int', group: true },
  { key: 'showPct', label: 'Show %', format: 'pct' },
  { key: 'showGoal', label: 'Show Goal', format: 'int', goal: true },
  { key: 'showDiff', label: 'Show Diff', format: 'signed', diff: true },
  { key: 'closeCount', label: 'Close Count', format: 'int', group: true },
  { key: 'closePct', label: 'Close %', format: 'pct' },
  { key: 'closeGoal', label: 'Close Goal', format: 'int', goal: true },
  { key: 'closeDiff', label: 'Close Diff', format: 'signed', diff: true },
  { key: 'newEftDraft', label: 'New PT EFT Draft', format: 'money', group: true },
  { key: 'cancelledEftDraft', label: 'Cancelled PT EFT Draft', format: 'money' },
  { key: 'netEftDraft', label: 'Net PT EFT Draft', format: 'signedMoney' },
  { key: 'newPifRevenue', label: 'New PT PIF Revenue', format: 'money', group: true },
  { key: 'pifOnJoinPct', label: '% w/ PT PIF on Join', format: 'pct' },
]

function fmt(v, format) {
  if (v === null || v === undefined) return 'N/A'
  const n = Number(v)
  switch (format) {
    case 'money': return `$${Math.round(n).toLocaleString()}`
    case 'signedMoney': return `${n > 0 ? '+' : n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`
    case 'pct': return `${n.toFixed(1)}%`
    case 'signed': return `${n > 0 ? '+' : ''}${n.toLocaleString()}`
    default: return Math.round(n).toLocaleString()
  }
}

// Every diff here is actual minus goal, so above zero is good in all three.
function diffTone(v) {
  if (v === null || v === undefined || v === 0) return 'text-text-muted'
  return v > 0 ? 'text-emerald-600' : 'text-wcs-red'
}

function Cell({ row, col }) {
  const v = row[col.key]
  const tone = col.diff ? diffTone(v) : (v === null ? 'text-text-muted' : 'text-text-primary')
  return (
    <td className={`px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap ${tone} ${col.group ? 'border-l border-border' : ''}`}>
      {fmt(v, col.format)}
    </td>
  )
}

export default function PtScorecard({ startDate, endDate, locationSlug }) {
  const [goals, setGoals] = useState({ book: 50, show: 50, close: 50 })
  const [exclusion, setExclusion] = useState('exclude')

  const query = useMemo(() => {
    const p = new URLSearchParams({
      start: startDate, end: endDate, clubs: locationSlug || 'all', exclusion,
    })
    for (const g of GOALS) p.set(`${g.key}Goal`, String(goals[g.key]))
    return p.toString()
  }, [startDate, endDate, locationSlug, exclusion, goals])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/pt-scorecard?${query}`, { cache: true, signal }),
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

  const overall = data?.overall
  const clubs = data?.clubs || []

  return (
    <div className="space-y-4">
      <ExclusionToolbar value={exclusion} onChange={setExclusion} />

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 bg-surface rounded-xl border border-border">
          <div className="overflow-auto max-h-[calc(100vh-16rem)]">
            <table className="min-w-max w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 bg-surface text-left font-semibold text-text-primary px-4 py-3 min-w-[200px] border-b border-border">
                    Club
                  </th>
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      className={`sticky top-0 z-20 bg-surface text-right font-semibold px-3 py-3 text-xs min-w-[110px] border-b border-border ${col.group ? 'border-l' : ''} ${col.goal ? 'text-wcs-red' : 'text-text-muted'}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overall && (
                  <tr className="bg-bg font-semibold">
                    <td className="sticky left-0 z-10 bg-bg px-4 py-2 text-text-primary whitespace-nowrap border-b border-border">
                      {overall.club}
                    </td>
                    {COLUMNS.map(col => <Cell key={col.key} row={overall} col={col} />)}
                  </tr>
                )}
                {clubs.map(row => (
                  <tr key={row.clubNumber} className="hover:bg-bg/60">
                    <td className="sticky left-0 z-10 bg-surface px-4 py-2 text-text-primary whitespace-nowrap border-b border-border/60">
                      {row.club}
                    </td>
                    {COLUMNS.map(col => <Cell key={col.key} row={row} col={col} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {clubs.length === 0 && (
            <p className="text-sm text-text-muted text-center py-10">No activity in this range.</p>
          )}
        </div>

        {/* Goals sit beside the table so a change and its effect are visible
            together, rather than behind a popup. */}
        <aside className="w-56 flex-shrink-0 bg-surface rounded-xl border border-border p-4 space-y-4">
          <p className="text-sm font-bold text-text-primary">Goals</p>
          {GOALS.map(g => (
            <label key={g.key} className="block">
              <span className="flex items-baseline justify-between text-[11px] font-semibold text-text-muted uppercase tracking-wide">
                {g.label}
                <span className="text-sm font-bold text-text-primary tabular-nums normal-case">{goals[g.key]}%</span>
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={goals[g.key]}
                onChange={e => setGoals(v => ({ ...v, [g.key]: Number(e.target.value) }))}
                className="w-full mt-1 accent-wcs-red"
                aria-label={g.label}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => setGoals({ book: 50, show: 50, close: 50 })}
            className="text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors"
          >
            Reset to 50%
          </button>
          <p className="text-[10px] text-text-muted leading-snug pt-2 border-t border-border">
            Each goal applies to the same base as its rate: Book against new members,
            Show against sets to date, Close against shows.
          </p>
        </aside>
      </div>

      <div className="text-xs text-text-muted px-1 space-y-1">
        {Object.values(data?.meta?.definitions || {}).map(d => <p key={d}>{d}</p>)}
      </div>
    </div>
  )
}

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
