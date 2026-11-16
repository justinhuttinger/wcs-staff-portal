import { useState } from 'react'
import { hub } from '../../lib/api'
import { Modal, Button, ErrorBanner, Spinner } from '../adsmanager/ui'

const fmt = m => {
  const h = Math.floor(m / 60), mm = m % 60
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
}
const dayLabel = key => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

// Puts open tasks and tickets on Google Calendar as yellow Focus blocks (the
// /briefing rules), replacing the blocks from the last run, then shows the plan.
export default function PlanWeekButton() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const run = async () => {
    setOpen(true); setBusy(true); setError(''); setResult(null)
    try { setResult(await hub.planWeek()) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const byDay = new Map()
  for (const b of result?.added || []) {
    if (!byDay.has(b.date)) byDay.set(b.date, [])
    byDay.get(b.date).push(b)
  }

  return (
    <>
      <button onClick={run} disabled={busy}
        className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-wcs-red text-white hover:bg-wcs-red/90 disabled:opacity-50">
        {busy ? 'Planning…' : 'Plan my week'}
      </button>
      {open && (
        <Modal title="Your week" subtitle="Focus blocks on your Google Calendar (last plan replaced)" onClose={() => setOpen(false)}
          footer={<Button variant="ghost" onClick={() => setOpen(false)}>Done</Button>}>
          <ErrorBanner error={error} />
          {busy && <Spinner label="Reading your calendar and planning…" />}
          {result && result.added.length === 0 && <p className="text-sm text-text-muted">Nothing to schedule right now.</p>}
          {[...byDay.entries()].map(([date, list]) => (
            <div key={date} className="space-y-1">
              <p className="text-xs font-bold uppercase tracking-widest text-text-muted">{dayLabel(date)}</p>
              {list.map((b, i) => (
                <p key={i} className="text-sm text-text-primary">
                  <span className="inline-block w-32 text-text-muted tabular-nums">{fmt(b.start)}–{fmt(b.end)}</span>
                  {b.title.replace(/^Focus: /, '')}
                  {b.kind === 'ticket' && <span className="ml-1.5 text-[10px] font-semibold text-text-muted">ticket</span>}
                </p>
              ))}
            </div>
          ))}
          {result?.unfit?.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">Didn't fit this week ({result.unfit.length})</p>
              <p className="text-xs text-text-primary">{result.unfit.join(' · ')}</p>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
