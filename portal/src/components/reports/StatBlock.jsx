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

// THE LABEL NEVER WRAPS. At six columns "Trial Conversion" broke onto a second
// line while its neighbours stayed on one, which pushed that card's number down
// and left the row of headline figures visibly out of step.
//
// So it is sized to fit instead. The cell is a container query container, and
// the label asks for the largest size at which its own text still fits the
// column: 12px wherever there is room, less only where the label is long and
// the column is narrow. Sizing every label the same would shrink "Members"
// to make room for "Cancel Reasons Captured" two reports away, which is a
// worse trade than a long label being a point smaller than a short one.
//
// The estimate is deliberately pessimistic — 0.68em per character against a
// real ~0.64em for uppercase system sans with tracking-wide — so the result
// errs a little small rather than clipping.
const LABEL_EM_PER_CHAR = 0.68

/** The largest of 12px / 7px / "as wide as the cell" at which `label` fits one line. */
function labelFontSize(label) {
  const len = String(label ?? '').length
  if (!len) return undefined
  const cqi = 100 / (LABEL_EM_PER_CHAR * len)
  return `clamp(7px, ${cqi.toFixed(2)}cqi, 12px)`
}

export function StatCell({ label, value, sub, valueClassName = '', className = '' }) {
  return (
    <div className={`@container bg-surface p-6 text-center ${className}`}>
      <p
        className="leading-tight text-text-muted uppercase tracking-wide whitespace-nowrap"
        style={{ fontSize: labelFontSize(label) }}
      >
        {label}
      </p>
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
