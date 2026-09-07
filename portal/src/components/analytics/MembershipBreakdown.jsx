import { useState } from 'react'

// ---------------------------------------------------------------------------
// The membership breakdown on Club Snapshot and Daily Snapshot.
//
// These two reports do NOT take the Insurance / Temp / Dues filter. Only a
// handful of their metrics are member counts — the rest are Day Ones, VIPs,
// tours, PT and revenue — so filtering would empty most of the page. This adds
// instead of subtracting: switched on, it shows how the membership block's own
// Members, Joined and Left split by category, and everything else on the report
// keeps meaning exactly what it meant before.
//
// The rows sum to the block above them by construction, because the SQL behind
// them uses the same three rules (migration 197). That is the whole promise of
// the thing: a breakdown that does not add up is worse than none.
//
// Collapsed by default. Somebody who wants the club's numbers should not have
// to read past four extra rows to find them.
// ---------------------------------------------------------------------------

const int = (n) => (typeof n === 'number' ? n.toLocaleString() : '—')

function Delta({ value, prior, betterWhen = 'up' }) {
  if (typeof value !== 'number' || typeof prior !== 'number') return null
  const d = value - prior
  if (d === 0) return <span className="text-text-muted">·</span>
  const good = betterWhen === 'up' ? d > 0 : d < 0
  return (
    <span className={good ? 'text-emerald-600' : 'text-wcs-red'}>
      {d > 0 ? '+' : ''}{d.toLocaleString()}
    </span>
  )
}

export default function MembershipBreakdown({ rows, comparisonLabel }) {
  const [open, setOpen] = useState(false)
  if (!rows || rows.length === 0) return null

  return (
    <div className="bg-surface rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full px-4 py-2.5 flex items-center gap-2 text-left"
      >
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`w-3.5 h-3.5 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-xs font-semibold text-text-primary">Membership breakdown</span>
        <span className="text-[11px] text-text-muted">
          Insurance, Dues and Temporary
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-text-muted">
                <th className="text-left font-medium py-1.5 pr-3">Category</th>
                <th className="text-right font-medium py-1.5 px-3">Members</th>
                <th className="text-right font-medium py-1.5 px-3">Joined</th>
                <th className="text-right font-medium py-1.5 px-3">Left</th>
                <th className="text-right font-medium py-1.5 pl-3">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.category} className="border-t border-border">
                  <td className="py-1.5 pr-3 font-semibold text-text-primary">
                    {r.category === 'Temp' ? 'Temporary' : r.category}
                    {r.category === 'Unmapped' && (
                      // Only ever rendered when it holds somebody. It is the
                      // reconciliation remainder, not a category, and saying so
                      // is what turns it from a puzzle into a task.
                      <span className="ml-1.5 font-normal text-[11px] text-text-muted">
                        not mapped yet — set these in Admin → Membership Categories
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-text-primary">{int(r.members)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-text-primary">
                    {int(r.joined)}{' '}
                    <span className="text-[10px]"><Delta value={r.joined} prior={r.priorJoined} /></span>
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-text-primary">
                    {int(r.left)}{' '}
                    <span className="text-[10px]"><Delta value={r.left} prior={r.priorLeft} betterWhen="down" /></span>
                  </td>
                  <td className={`py-1.5 pl-3 text-right tabular-nums font-semibold ${
                    r.net > 0 ? 'text-emerald-600' : r.net < 0 ? 'text-wcs-red' : 'text-text-primary'
                  }`}>
                    {r.net > 0 ? '+' : ''}{int(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {comparisonLabel && (
            <p className="mt-2 text-[11px] text-text-muted">
              Small figures compare against {comparisonLabel}. Rows add up to the Members,
              Joined and Left above.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
