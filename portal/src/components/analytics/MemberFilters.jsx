// ---------------------------------------------------------------------------
// The two shared member filters: which kind of membership, and what a "1" means.
//
// Rendered only for reports that declare them in ANALYTICS_REPORTS, because a
// control that cannot change the answer invites reading noise as signal — the
// same reason each report picks its own segment list.
//
// Category and basis sit beside the location and date range rather than inside
// a report's own Filters popup: they are properties of the question being asked,
// they persist across reports the way location and dates do, and a reader who
// has narrowed to Insurance needs to see that on every report they click to.
// ---------------------------------------------------------------------------

export const MEMBER_CATEGORY_OPTIONS = [
  { value: 'all', label: 'All memberships' },
  { value: 'Insurance', label: 'Insurance' },
  { value: 'Temp', label: 'Temporary' },
  { value: 'Dues', label: 'Dues paying' },
  // No 'Other' option on purpose. Unmapped is a state of our configuration,
  // not a kind of membership, and listing it beside Insurance invites reading
  // it as one. Admin -> Membership Categories shows what is unmapped, where it
  // is a job to do rather than something to report on.
]

export const MEMBER_BASIS_OPTIONS = [
  { value: 'members', label: 'Members' },
  { value: 'agreements', label: 'Agreements' },
]

const SELECT_CLASS =
  'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary'

export default function MemberFilters({ filters, category, basis, onCategory, onBasis }) {
  const wants = Array.isArray(filters) ? filters : []
  const showCategory = wants.includes('category')
  const showBasis = wants.includes('basis')
  if (!showCategory && !showBasis) return null

  return (
    <div className="flex items-center gap-2">
      {showCategory && (
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Membership category</span>
          <select
            value={category}
            onChange={e => onCategory(e.target.value)}
            className={`${SELECT_CLASS} ${category !== 'all' ? 'border-wcs-red text-wcs-red font-semibold' : ''}`}
            title="Which kind of membership to count"
          >
            {MEMBER_CATEGORY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      )}
      {showBasis && (
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Count by</span>
          <select
            value={basis}
            onChange={e => onBasis(e.target.value)}
            className={`${SELECT_CLASS} ${basis !== 'members' ? 'border-wcs-red text-wcs-red font-semibold' : ''}`}
            title="Members counts people; Agreements counts primary members only, so a family counts once"
          >
            {MEMBER_BASIS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

/**
 * The banner a filtered report carries.
 *
 * Insurance alone is 32% of the member base, so a filtered chart looks exactly
 * like a collapse. The server sends the sentence; this renders it where it
 * cannot be missed, and renders nothing at all when nothing is filtered.
 */
export function MemberFilterNote({ note }) {
  if (!note) return null
  return (
    <div className="mb-3 px-3 py-2 rounded-lg bg-wcs-red/10 border border-wcs-red/30 text-xs font-semibold text-wcs-red">
      {note}
    </div>
  )
}
