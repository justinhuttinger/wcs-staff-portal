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

export function StatBlock({ cols = 4, children, className = '', flush = false }) {
  const grid = (
    <div className={`grid ${COL_CLASS[cols] || COL_CLASS[4]} gap-px bg-border`}>
      {children}
    </div>
  )
  // flush = no own border/rounding; used inside a ReportBlock where the outer
  // panel provides the border and the grid sits edge-to-edge.
  if (flush) return <div className={className}>{grid}</div>
  return (
    <div className={`bg-surface border border-border rounded-xl overflow-hidden ${className}`}>
      {grid}
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

// "Whole report = one block": a single bordered panel whose direct children
// (sections) are separated by hairline dividers. Inner content should be
// borderless and rely on this panel's border + the dividers.
export function ReportBlock({ children, className = '' }) {
  return (
    <div className={`bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border ${className}`}>
      {children}
    </div>
  )
}

// One section inside a ReportBlock: an uppercase heading followed by content.
// The heading sits directly above its content (no divider between them); the
// divider falls between sections via ReportBlock's divide-y.
export function ReportSection({ title, action, children, bodyClassName = 'px-5 sm:px-6 pb-5' }) {
  return (
    <div>
      {title && (
        <div className="flex items-center gap-3 px-5 sm:px-6 pt-4 pb-3">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
          {action}
        </div>
      )}
      {bodyClassName ? <div className={bodyClassName}>{children}</div> : children}
    </div>
  )
}
