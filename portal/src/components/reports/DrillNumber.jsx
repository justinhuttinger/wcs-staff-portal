import Drillable from '../analytics/Drillable'

// ---------------------------------------------------------------------------
// A number inside a table, one click from the rows it counted.
//
// The stat-card version of this lives in ClubHealthReport as DrillCell. This is
// the table-cell one: same Drillable underneath, sized and styled for a cell so
// a row of figures still reads as a row of figures rather than a row of
// buttons.
//
// NOTHING IS CLICKABLE BY ACCIDENT, same rule as everywhere else. A zero opens
// nothing — an empty list under a 0 tells you what you already knew and makes
// every other zero on the page look clickable too. A cell with no record set
// renders plain.
// ---------------------------------------------------------------------------

export default function DrillNumber({
  value, set, params, title, enabled = true, className = '',
}) {
  const n = Number(value) || 0
  if (!enabled || !set || n === 0) {
    return <span className={className}>{value ?? 0}</span>
  }
  return (
    <Drillable
      set={set}
      title={title}
      params={params}
      rounded="rounded"
      className="inline-block w-auto px-1 -mx-1 hover:underline decoration-dotted underline-offset-2"
    >
      <span className={className}>{value}</span>
    </Drillable>
  )
}
