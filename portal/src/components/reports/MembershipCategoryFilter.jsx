import { useEffect, useState } from 'react'
import { getMembershipCategories } from '../../lib/api'

// ---------------------------------------------------------------------------
// Which kinds of membership to count.
//
// TICK BOXES, NOT A DROPDOWN, and everything ticked to begin with. A dropdown
// asks "which one kind of membership are you looking at" — one at a time, and
// never the combination anybody actually wants, which is usually "everything
// except Insurance". Tick boxes let the question be asked the way it is asked
// out loud.
//
// EVERYTHING TICKED MEANS NO FILTER AT ALL, not "include these three". The
// named categories do not sum to the whole: a membership type nobody has mapped
// yet belongs to none of them. Reading this as an allow-list would quietly drop
// those the day it shipped, and every figure would move for a reason invisible
// on the page. The server takes the UNTICKED list and excludes exactly that,
// so the default is byte-identical to the numbers before this existed.
//
// The list comes from the mapping in the database rather than a constant here,
// so a category added in Admin appears without a deploy.
// ---------------------------------------------------------------------------

export default function MembershipCategoryFilter({ excluded = [], onChange }) {
  const [categories, setCategories] = useState([])

  useEffect(() => {
    let alive = true
    getMembershipCategories({ cache: true })
      .then(r => { if (alive) setCategories(r?.categories || []) })
      // A failed lookup hides the control rather than showing an empty one:
      // no boxes means no filter, which is the safe reading.
      .catch(() => { if (alive) setCategories([]) })
    return () => { alive = false }
  }, [])

  if (categories.length === 0) return null

  const toggle = (cat) => {
    const next = excluded.includes(cat)
      ? excluded.filter(c => c !== cat)
      : [...excluded, cat]
    onChange(next)
  }

  const filtering = excluded.length > 0

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-text-muted uppercase tracking-wide">Membership</span>
      <div className={`flex items-center gap-0.5 p-0.5 rounded-lg bg-bg border ${filtering ? 'border-wcs-red' : 'border-border'}`}>
        {categories.map(cat => {
          const on = !excluded.includes(cat)
          return (
            <label
              key={cat}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer select-none transition-colors ${
                on ? 'text-text-primary' : 'text-text-muted line-through'
              }`}
              title={on ? `Counting ${cat} memberships` : `${cat} memberships are left out`}
            >
              <input
                id={`membership-category-${cat.toLowerCase()}`}
                type="checkbox"
                checked={on}
                onChange={() => toggle(cat)}
                className="accent-wcs-red"
              />
              {cat}
            </label>
          )
        })}
      </div>
      {/* Unticking everything is allowed but says so, because an empty report
          and a broken one look identical otherwise. */}
      {excluded.length === categories.length && (
        <span className="text-[11px] text-wcs-red">Every category is unticked</span>
      )}
    </div>
  )
}
