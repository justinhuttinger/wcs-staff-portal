import { useState } from 'react'

// Shared horizontal-bar breakdown used by Club Health (Active Members,
// Sales by Membership Type) and Cancels (by Membership Type).
// When `collapsible` is true the component renders as a compact pill
// (auto-width) until clicked, then expands to the full breakdown card.
export default function MembershipTypeTable({ title, rows, collapsible = false }) {
  const [open, setOpen] = useState(!collapsible)
  const list = rows || []
  const totalMembers = list.reduce((s, r) => s + (r.members || 0), 0)
  const totalAgreements = list.reduce((s, r) => s + (r.agreements || 0), 0)
  const max = list.reduce((m, r) => Math.max(m, r.members || 0), 0)

  // Compact bubble — collapsed state
  if (collapsible && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="inline-flex items-center gap-3 px-4 py-2 bg-surface rounded-full border border-border hover:border-wcs-red/40 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all group"
      >
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide group-hover:text-text-primary">
          {title}
        </span>
        <span className="inline-flex items-baseline gap-1 text-sm border-l border-border pl-3">
          <span className="font-bold text-text-primary tabular-nums">{totalMembers.toLocaleString()}</span>
          <span className="text-[10px] uppercase tracking-wide text-text-muted">members</span>
        </span>
        <span className="inline-flex items-baseline gap-1 text-sm">
          <span className="font-bold text-text-primary tabular-nums">{totalAgreements.toLocaleString()}</span>
          <span className="text-[10px] uppercase tracking-wide text-text-muted">agreements</span>
        </span>
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-bg border border-border text-text-muted group-hover:text-wcs-red group-hover:bg-wcs-red/10 group-hover:border-wcs-red/30 transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </span>
      </button>
    )
  }

  // Expanded card — full breakdown
  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-expanded={true}
          className="flex items-center justify-between w-full text-left mb-4 group"
        >
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{title}</p>
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-bg border border-border text-text-muted group-hover:text-wcs-red transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 rotate-180">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        </button>
      ) : (
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</p>
      )}
      {list.length === 0 || totalMembers === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">No data</p>
      ) : (
        <>
          <div className="grid grid-cols-[200px_minmax(0,1fr)_auto_auto] items-center gap-3 text-[11px] font-semibold text-text-muted uppercase tracking-wide pb-2 border-b border-border mb-2">
            <span>Type</span>
            <span></span>
            <span className="text-right whitespace-nowrap">Members</span>
            <span className="text-right whitespace-nowrap pl-3">Agreements</span>
          </div>
          <div className="space-y-2">
            {list.map(r => {
              const barPct = max > 0 ? ((r.members || 0) / max) * 100 : 0
              const pct = totalMembers > 0 ? ((r.members || 0) / totalMembers) * 100 : 0
              return (
                <div key={r.membership_type} className="grid grid-cols-[200px_minmax(0,1fr)_auto_auto] items-center gap-3 text-sm">
                  <span className="text-text-primary truncate" title={r.membership_type}>{r.membership_type}</span>
                  <div className="relative h-5 bg-bg rounded-md border border-border overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-wcs-red/80" style={{ width: `${barPct}%` }} />
                  </div>
                  <span className="text-right tabular-nums whitespace-nowrap">
                    <span className="font-semibold text-text-primary">{r.members || 0}</span>
                    <span className="text-xs text-text-muted ml-1">({pct.toFixed(1)}%)</span>
                  </span>
                  <span className="text-right tabular-nums whitespace-nowrap pl-3 text-text-muted">{r.agreements || 0}</span>
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-[200px_minmax(0,1fr)_auto_auto] items-center gap-3 text-sm pt-3 mt-2 border-t border-border font-semibold">
            <span className="text-text-primary">Total</span>
            <span></span>
            <span className="text-right tabular-nums whitespace-nowrap text-text-primary">{totalMembers}</span>
            <span className="text-right tabular-nums whitespace-nowrap pl-3 text-text-primary">{totalAgreements}</span>
          </div>
        </>
      )}
    </div>
  )
}
