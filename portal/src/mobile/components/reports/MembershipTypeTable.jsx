// Shared mobile horizontal-bar breakdown for membership-type tables.
// Fixed-width type column on the metadata row keeps the per-row layout
// identical across all instances; the progress bar is on its own
// full-width row underneath, so bars naturally line up to the card edge.
export default function MembershipTypeTable({ title, rows }) {
  const list = rows || []
  const totalMembers = list.reduce((s, r) => s + (r.members || 0), 0)
  const totalAgreements = list.reduce((s, r) => s + (r.agreements || 0), 0)
  const max = list.reduce((m, r) => Math.max(m, r.members || 0), 0)

  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">{title}</p>
      {list.length === 0 || totalMembers === 0 ? (
        <p className="text-sm text-text-muted py-2 text-center">No data</p>
      ) : (
        <>
          <div className="grid grid-cols-[110px_minmax(0,1fr)_auto_auto] items-center gap-2 text-[10px] font-semibold text-text-muted uppercase tracking-wide pb-1.5 border-b border-border mb-1.5">
            <span>Type</span>
            <span></span>
            <span className="text-right whitespace-nowrap">Mem</span>
            <span className="text-right whitespace-nowrap pl-2">Agr</span>
          </div>
          <div className="space-y-1.5">
            {list.map(r => {
              const barPct = max > 0 ? ((r.members || 0) / max) * 100 : 0
              const pct = totalMembers > 0 ? ((r.members || 0) / totalMembers) * 100 : 0
              return (
                <div key={r.membership_type} className="space-y-0.5">
                  <div className="grid grid-cols-[110px_minmax(0,1fr)_auto_auto] items-center gap-2 text-xs">
                    <span className="text-text-primary truncate" title={r.membership_type}>{r.membership_type}</span>
                    <span></span>
                    <span className="text-right tabular-nums whitespace-nowrap">
                      <span className="font-semibold text-text-primary">{r.members || 0}</span>
                      <span className="text-[10px] text-text-muted ml-1">({pct.toFixed(0)}%)</span>
                    </span>
                    <span className="text-right tabular-nums whitespace-nowrap pl-2 text-text-muted">{r.agreements || 0}</span>
                  </div>
                  <div className="relative h-1.5 bg-bg rounded-full border border-border overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-wcs-red/80" style={{ width: `${barPct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-[110px_minmax(0,1fr)_auto_auto] items-center gap-2 text-xs pt-2 mt-2 border-t border-border font-semibold">
            <span className="text-text-primary">Total</span>
            <span></span>
            <span className="text-right tabular-nums whitespace-nowrap text-text-primary">{totalMembers}</span>
            <span className="text-right tabular-nums whitespace-nowrap pl-2 text-text-primary">{totalAgreements}</span>
          </div>
        </>
      )}
    </div>
  )
}
