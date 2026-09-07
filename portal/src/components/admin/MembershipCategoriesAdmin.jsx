import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

// ---------------------------------------------------------------------------
// Membership categories — Insurance / Temp / Dues.
//
// Drives the category filter on the Analytics member reports. A type that is
// not mapped here reads as Other: it counts under All and appears under none of
// the three, which is why the unmapped list sits at the top of this screen
// rather than being something you have to go looking for.
// ---------------------------------------------------------------------------

const CATEGORY_HELP = {
  Insurance: 'Third-party programmes (Active Adult, Active&Fit). No monthly dues to us.',
  Temp: 'Memberships meant to end — temporary and summer plans.',
  Dues: 'Pays us every month.',
}

export default function MembershipCategoriesAdmin() {
  const [items, setItems] = useState([])
  const [unmapped, setUnmapped] = useState([])
  const [categories, setCategories] = useState(['Insurance', 'Temp', 'Dues'])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api('/abc-sync/membership-categories')
      setItems(res.items || [])
      setUnmapped(res.unmapped || [])
      if (res.categories?.length) setCategories(res.categories)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function assign(membershipType, category) {
    setBusy(membershipType)
    setError(null)
    try {
      await api('/abc-sync/membership-categories', {
        method: 'POST',
        body: JSON.stringify({ membership_type: membershipType, category }),
      })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function unmap(membershipType) {
    setBusy(membershipType)
    setError(null)
    try {
      await api(`/abc-sync/membership-categories/${encodeURIComponent(membershipType)}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <p className="text-sm text-text-muted">Loading…</p>

  const grouped = categories.map(c => ({ category: c, rows: items.filter(i => i.category === c) }))

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-text-primary">Membership Categories</h3>
        <p className="text-sm text-text-muted mt-1">
          Powers the Insurance / Temporary / Dues filter on the Analytics member reports.
          A type that is not mapped counts under <strong>All</strong> and under none of the three.
        </p>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-wcs-red/10 border border-wcs-red/30 text-sm text-wcs-red">
          {error}
        </div>
      )}

      {unmapped.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-text-primary mb-2">
            {unmapped.length} membership type{unmapped.length === 1 ? '' : 's'} not mapped yet
          </p>
          <p className="text-xs text-text-muted mb-3">
            These count under All and appear under none of the three buckets. Map them, or leave
            them in Other on purpose.
          </p>
          <div className="space-y-2">
            {unmapped.map(u => (
              <div key={u.membership_type} className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-text-primary font-medium">{u.membership_type}</span>
                <span className="text-xs text-text-muted">{u.active_members} active</span>
                <div className="ml-auto flex gap-1.5">
                  {categories.map(c => (
                    <button
                      key={c}
                      disabled={busy === u.membership_type}
                      onClick={() => assign(u.membership_type, c)}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border bg-bg text-text-muted hover:text-text-primary disabled:opacity-50"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {grouped.map(({ category, rows }) => (
        <div key={category}>
          <h4 className="text-sm font-bold text-text-primary">{category}</h4>
          <p className="text-xs text-text-muted mb-2">{CATEGORY_HELP[category]}</p>
          {rows.length === 0 ? (
            <p className="text-xs text-text-muted italic">Nothing mapped here.</p>
          ) : (
            <div className="rounded-lg border border-border divide-y divide-border">
              {rows.map(r => (
                <div key={r.membership_type} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-sm text-text-primary">{r.membership_type}</span>
                  {r.note && <span className="text-xs text-text-muted">{r.note}</span>}
                  <button
                    disabled={busy === r.membership_type}
                    onClick={() => unmap(r.membership_type)}
                    className="ml-auto text-xs text-text-muted hover:text-wcs-red disabled:opacity-50"
                  >
                    Unmap
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
