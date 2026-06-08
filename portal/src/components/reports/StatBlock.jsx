// Shared "one block" primitives for the reports.
//
// Replaces stacks/grids of individually-bordered "bubble" cards with a single
// bordered panel whose cells are separated by hairline dividers. The divider
// effect is a 1px grid gap over a border-colored background, with each cell
// painted bg-surface — this stays clean when cells wrap to multiple rows.
//
//   <StatBlock cols={4}>
//     <StatCell label="Members" value={120} />
//     ...
//   </StatBlock>

const COL_CLASS = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
}

export function StatBlock({ cols = 4, children, className = '' }) {
  return (
    <div className={`bg-surface border border-border rounded-xl overflow-hidden ${className}`}>
      <div className={`grid ${COL_CLASS[cols] || COL_CLASS[4]} gap-px bg-border`}>
        {children}
      </div>
    </div>
  )
}

export function StatCell({ label, value, sub, valueClassName = '', className = '' }) {
  return (
    <div className={`bg-surface p-6 text-center ${className}`}>
      <p className="text-xs text-text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-4xl font-bold text-text-primary mt-2 ${valueClassName}`}>{value}</p>
      {sub && <p className="text-[11px] text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

// A generic panel wrapper for non-stat content (charts, tables) that should sit
// in the same single-block style. Children that were individually bordered
// cards should drop their own border/bg and rely on the gap-px divider.
export function Panel({ children, className = '' }) {
  return (
    <div className={`bg-surface border border-border rounded-xl overflow-hidden ${className}`}>
      {children}
    </div>
  )
}
