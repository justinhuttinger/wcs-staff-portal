// Shared horizontal-bar breakdown used by Club Health (Active Members,
// Sales by Membership Type) and Cancels (by Membership Type).
// Fixed-width type column so bars start at the same x across all instances.
export default function MembershipTypeTable({ title, rows }) {
  const list = rows || []
  const totalMembers = list.reduce((s, r) => s + (r.members || 0), 0)
  const totalAgreements = list.reduce((s, r) => s + (r.agreements || 0), 0)
  const max = list.reduce((m, r) => Math.max(m, r.members || 0), 0)

  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">{title}</p>
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
