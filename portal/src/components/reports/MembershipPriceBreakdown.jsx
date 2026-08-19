import { useState, useMemo } from 'react'
import { getMembershipPriceBreakdown, downloadMembershipPriceDetail } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'

const BASIS_PILLS = [
  { key: 'monthly', label: 'Monthly Equivalent' },
  { key: 'charged', label: 'As Charged' },
]

// Club column order matches the portal's location list, not club-number order.
const CLUB_ORDER = ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']

function money2(n) {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}
function money(n) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
function title(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

export default function MembershipPriceBreakdown({ locationSlug = 'all' }) {
  const [basis, setBasis] = useState('monthly')
  const [type, setType] = useState('all')
  const [payingOnly, setPayingOnly] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(null)

  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const params = {}
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getMembershipPriceBreakdown(params, { signal })
    },
    [locationSlug]
  )

  const allRows = data?.rows || []

  const membershipTypes = useMemo(() => {
    const set = new Set(allRows.map(r => r.membership_type).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [allRows])

  // Pivot the grouped rows into price -> { club: members }. The price basis and
  // the type/$0 filters are all applied client-side off the single fetch.
  const { prices, clubs, byPrice, totalMembers } = useMemo(() => {
    const priceKey = basis === 'charged' ? 'charged_amount' : 'monthly_price'
    const map = new Map()
    const clubSet = new Set()
    let total = 0
    for (const r of allRows) {
      if (type !== 'all' && r.membership_type !== type) continue
      const price = Number(r[priceKey]) || 0
      if (payingOnly && price <= 0) continue
      const n = Number(r.members) || 0
      if (!map.has(price)) map.set(price, {})
      const bucket = map.get(price)
      bucket[r.club] = (bucket[r.club] || 0) + n
      clubSet.add(r.club)
      total += n
    }
    // Omit clubs with no members under the current filters entirely.
    const cols = CLUB_ORDER.filter(c => clubSet.has(c))
    for (const c of clubSet) if (!cols.includes(c)) cols.push(c)
    return {
      prices: [...map.keys()].sort((a, b) => b - a),
      clubs: cols,
      byPrice: map,
      totalMembers: total,
    }
  }, [allRows, basis, type, payingOnly])

  async function onExport() {
    setDownloading(true)
    setDownloadError(null)
    try {
      await downloadMembershipPriceDetail({ locationSlug, basis })
    } catch (e) {
      setDownloadError(e.message || String(e))
    } finally {
      setDownloading(false)
    }
  }

  const basisLabel = basis === 'charged' ? 'amount charged per billing cycle' : 'monthly-equivalent price'

  return (
    <div className="px-5 sm:px-6 py-5 border-t border-border">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
          Price Breakdown — active members by {basisLabel}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onExport}
            disabled={downloading || loading}
            className="text-xs font-semibold text-wcs-red hover:text-wcs-red/80 disabled:opacity-50"
          >
            {downloading ? 'Generating…' : 'Export Excel'}
          </button>
        </div>
      </div>

      {/* Controls: price basis, membership type, $0 members */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-1.5">
          {BASIS_PILLS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => setBasis(p.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                basis === p.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm max-w-[18rem] focus:outline-none focus:border-wcs-red"
        >
          <option value="all">All Membership Types</option>
          {membershipTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-text-muted select-none cursor-pointer">
          <input
            type="checkbox"
            checked={!payingOnly}
            onChange={e => setPayingOnly(!e.target.checked)}
            className="accent-wcs-red"
          />
          Include $0 members
        </label>
      </div>

      {downloadError && <p className="text-wcs-red text-xs mb-3">{downloadError}</p>}

      {loading && <p className="text-text-muted text-xs py-4">Loading price breakdown…</p>}
      {error && <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>}

      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                <th className="text-left font-semibold py-2">Price</th>
                {clubs.map(c => (
                  <th key={c} className="text-right font-semibold py-2 pl-3">{title(c)}</th>
                ))}
                <th className="text-right font-semibold py-2 pl-4">Members</th>
                <th className="text-right font-semibold py-2 pl-3">% of Members</th>
                <th className="text-right font-semibold py-2 pl-3">Monthly Revenue</th>
              </tr>
            </thead>
            <tbody>
              {prices.map(price => {
                const bucket = byPrice.get(price)
                const rowTotal = clubs.reduce((n, c) => n + (bucket[c] || 0), 0)
                return (
                  <tr key={price} className="border-b border-border/60">
                    <td className="py-1.5 tabular-nums font-semibold text-text-primary">{money2(price)}</td>
                    {clubs.map(c => (
                      <td key={c} className={`py-1.5 pl-3 text-right tabular-nums ${bucket[c] ? 'text-text-primary' : 'text-text-muted/50'}`}>
                        {bucket[c] ? bucket[c].toLocaleString() : '—'}
                      </td>
                    ))}
                    <td className="py-1.5 pl-4 text-right tabular-nums font-semibold text-text-primary">{rowTotal.toLocaleString()}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums text-text-muted">
                      {totalMembers ? `${((100 * rowTotal) / totalMembers).toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums text-text-muted">{money(price * rowTotal)}</td>
                  </tr>
                )
              })}
              {prices.length > 0 && (
                <tr className="border-t border-border font-semibold">
                  <td className="py-2 text-text-primary">Total</td>
                  {clubs.map(c => (
                    <td key={c} className="py-2 pl-3 text-right tabular-nums text-text-primary">
                      {prices.reduce((n, p) => n + (byPrice.get(p)[c] || 0), 0).toLocaleString()}
                    </td>
                  ))}
                  <td className="py-2 pl-4 text-right tabular-nums text-text-primary">{totalMembers.toLocaleString()}</td>
                  <td className="py-2 pl-3 text-right tabular-nums text-text-muted">100%</td>
                  <td className="py-2 pl-3 text-right tabular-nums text-text-primary">
                    {money(prices.reduce((sum, p) => sum + p * clubs.reduce((n, c) => n + (byPrice.get(p)[c] || 0), 0), 0))}
                  </td>
                </tr>
              )}
              {prices.length === 0 && (
                <tr><td colSpan={clubs.length + 4} className="py-6 text-center text-text-muted text-xs">No members for this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
