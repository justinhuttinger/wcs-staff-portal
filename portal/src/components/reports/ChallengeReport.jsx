import { useEffect, useMemo, useState } from 'react'
import { getChallengeReport } from '../../lib/api'
import { exportCSV } from '../../lib/export'
import DesktopLoading from '../DesktopLoading'

// Transformation Challenge entries: who bought a challenge tier through the GHL
// payment links, per club. Seasonal; on/off in Admin -> Challenge Report.

const TIER_ORDER = ['kick_start', 'challenger', 'all_in', 'other']
const TIER_STYLE = {
  kick_start: 'bg-sky-100 text-sky-800 border-sky-200',
  challenger: 'bg-amber-100 text-amber-800 border-amber-200',
  all_in: 'bg-wcs-red/10 text-wcs-red border-wcs-red/30',
  other: 'bg-bg text-text-muted border-border',
}

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'tier', label: 'Plan' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'club_name', label: 'Club' },
  { key: 'amount', label: 'Paid', align: 'right' },
  { key: 'purchased_at', label: 'Purchased' },
]

function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (ten.length !== 10) return p || ''
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function sortValue(row, key) {
  if (key === 'tier') return TIER_ORDER.indexOf(row.tier)
  if (key === 'amount') return row.amount
  if (key === 'phone') return String(row.phone || '').replace(/\D/g, '')
  return String(row[key] || '').toLowerCase()
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">{label}</div>
      <div className="text-2xl font-bold text-text-primary mt-0.5">{value}</div>
      {sub && <div className="text-xs text-text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

export default function ChallengeReport({ locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [club, setClub] = useState('all')
  const [tier, setTier] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'purchased_at', dir: 'desc' })

  function load(refresh = false) {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    getChallengeReport({ refresh })
      .then(setData)
      .catch(setError)
      .finally(() => { setLoading(false); setRefreshing(false) })
  }

  useEffect(() => { load(false) }, [])

  // Follow the header's club picker when it points at a single club.
  useEffect(() => {
    if (locationSlug && locationSlug !== 'all' && !locationSlug.includes(',')) setClub(locationSlug)
  }, [locationSlug])

  const rows = data?.rows || []
  const clubs = data?.clubs || []

  const clubRows = useMemo(
    () => (club === 'all' ? rows : rows.filter(r => r.club_slug === club)),
    [rows, club]
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    const filtered = clubRows.filter(r => {
      if (tier !== 'all' && r.tier !== tier) return false
      if (!q) return true
      return r.name.toLowerCase().includes(q)
        || r.email.includes(q)
        || (qDigits.length >= 3 && String(r.phone).replace(/\D/g, '').includes(qDigits))
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [clubRows, tier, search, sort])

  const tierCounts = useMemo(() => {
    const counts = { kick_start: 0, challenger: 0, all_in: 0, other: 0 }
    for (const r of clubRows) counts[r.tier] = (counts[r.tier] || 0) + 1
    return counts
  }, [clubRows])

  const clubCounts = useMemo(() => {
    const counts = {}
    for (const r of rows) counts[r.club_slug] = (counts[r.club_slug] || 0) + 1
    return counts
  }, [rows])

  function toggleSort(key) {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'purchased_at' || key === 'amount' ? 'desc' : 'asc' })
  }

  function exportRows(list, label) {
    const header = ['Name', 'Plan', 'Phone', 'Email', 'Club', 'Paid', 'Purchased']
    const body = list.map(r => [r.name, r.tier_label, fmtPhone(r.phone), r.email, r.club_name, r.amount, fmtDate(r.purchased_at)])
    const day = new Date().toISOString().slice(0, 10)
    exportCSV([header, ...body], `challenge-${label}-${day}`)
  }

  if (loading) return <DesktopLoading variant="report" />

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">
        {error.message || String(error)}
      </div>
    )
  }
  if (!data) return null

  if (!data.enabled) {
    return (
      <div className="bg-surface border border-border rounded-xl p-8 text-center text-text-muted text-sm">
        The Challenge report is turned off. An admin can turn it on in Admin, Challenge Report.
      </div>
    )
  }

  const revenue = clubRows.reduce((s, r) => s + r.amount, 0)
  const clubLabel = club === 'all' ? 'all-clubs' : club

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Participants" value={clubRows.length} sub={tierCounts.other ? `incl. ${tierCounts.other} other entries` : null} />
        <StatCard label="Kick Start" value={tierCounts.kick_start} sub="$25" />
        <StatCard label="Challenger" value={tierCounts.challenger} sub="$57" />
        <StatCard label="All In" value={tierCounts.all_in} sub="$97" />
        <StatCard label="Total Collected" value={fmtMoney(revenue)} sub={club === 'all' ? 'All clubs' : (clubs.find(c => c.slug === club)?.name || '')} />
      </div>

      {data.failed_clubs?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
          Could not load from GHL: {data.failed_clubs.join(', ')}. Those clubs may be missing entries.
        </div>
      )}

      {/* Club + plan filters, search, export */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {[{ slug: 'all', name: 'All Clubs' }, ...clubs].map(c => {
            const active = club === c.slug
            const count = c.slug === 'all' ? rows.length : (clubCounts[c.slug] || 0)
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => setClub(c.slug)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
                  active ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'
                }`}
              >
                {c.name} <span className={active ? 'text-white/80' : 'text-text-muted'}>({count})</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={tier}
            onChange={e => setTier(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red"
          >
            <option value="all">All plans</option>
            <option value="kick_start">Kick Start</option>
            <option value="challenger">Challenger</option>
            <option value="all_in">All In</option>
            {tierCounts.other > 0 && <option value="other">Other</option>}
          </select>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, phone..."
            className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red min-w-[240px]"
          />
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => load(true)}
              disabled={refreshing}
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-muted text-xs hover:text-text-primary disabled:opacity-50"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            {club !== 'all' && (
              <button
                type="button"
                onClick={() => exportRows(visible, clubLabel)}
                disabled={!visible.length}
                className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-muted text-xs hover:text-text-primary disabled:opacity-50"
              >
                Export {clubs.find(c => c.slug === club)?.name || 'Club'}
              </button>
            )}
            <button
              type="button"
              onClick={() => exportRows([...rows].sort((a, b) => a.club_name.localeCompare(b.club_name) || a.name.localeCompare(b.name)), 'all-clubs')}
              disabled={!rows.length}
              className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              Export Full List
            </button>
          </div>
        </div>
      </div>

      {/* Participants */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-xs uppercase tracking-wide text-text-muted">
                {COLUMNS.map(col => {
                  const active = sort.key === col.key
                  return (
                    <th key={col.key} className={`px-4 py-2 font-semibold ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-text-primary ${active ? 'text-text-primary' : ''}`}
                      >
                        {col.label}
                        <span className="text-[10px]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-text-muted text-sm">
                    {rows.length === 0 ? 'No challenge entries yet this season.' : 'No entries match these filters.'}
                  </td>
                </tr>
              ) : visible.map(r => (
                <tr key={r.id} className="border-t border-border hover:bg-bg/60">
                  <td className="px-4 py-2 font-medium text-text-primary whitespace-nowrap">{r.name || '(no name)'}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${TIER_STYLE[r.tier] || TIER_STYLE.other}`}>
                      {r.tier_label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-text-primary whitespace-nowrap">
                    {r.phone ? <a href={`tel:${r.phone}`} className="hover:text-wcs-red">{fmtPhone(r.phone)}</a> : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-2 text-text-primary">
                    {r.email ? <a href={`mailto:${r.email}`} className="hover:text-wcs-red">{r.email}</a> : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-2 text-text-primary whitespace-nowrap">{r.club_name}</td>
                  <td className="px-4 py-2 text-right text-text-primary">{fmtMoney(r.amount)}</td>
                  <td className="px-4 py-2 text-text-muted whitespace-nowrap">{fmtDate(r.purchased_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.fetched_at && (
          <div className="px-4 py-2 border-t border-border text-[11px] text-text-muted">
            Showing {visible.length} of {clubRows.length}. From GHL payments, updated {new Date(data.fetched_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.
          </div>
        )}
      </div>
    </div>
  )
}
