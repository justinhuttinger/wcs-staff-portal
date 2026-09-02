import { useEffect, useMemo, useRef, useState } from 'react'
import { getDeactivatedPT, getDeactivatedPTMember } from '../../../lib/api'
import MobileLoading from '../MobileLoading'
import { useCancellableFetch } from '../../../hooks/useCancellableFetch'
import WcsLoadingMark from '../../../components/WcsLoadingMark'

function fmtMoney(n) {
  const v = Number(n || 0)
  if (!v) return '—'
  return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt)) return d
  return `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(2)}`
}

const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'Deactivated RS', label: 'Deactivated RS' },
  { key: 'PIF Burned', label: 'PIF Burned' },
]

export default function MobileDeactivatedPT({ startDate, endDate, locationSlug }) {
  const [typeFilter, setTypeFilter] = useState('all')
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [memberDetail, setMemberDetail] = useState(null)

  const memberReqRef = useRef(0)

  function openMemberDetail(row) {
    const id = ++memberReqRef.current
    setMemberDetail({ row, loading: true, data: null, error: null })
    getDeactivatedPTMember(
      { memberId: row.memberId, locationSlug: row.locationSlug },
      { cache: true }
    )
      .then(res => {
        if (id !== memberReqRef.current) return
        setMemberDetail({ row, loading: false, data: res, error: null })
      })
      .catch(err => {
        if (id !== memberReqRef.current) return
        setMemberDetail({ row, loading: false, data: null, error: err.message })
      })
  }

  function closeMemberDetail() {
    memberReqRef.current++
    setMemberDetail(null)
  }

  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      if (!startDate || !endDate) return Promise.resolve(null)
      return getDeactivatedPT(
        { start_date: startDate, end_date: endDate, location_slug: locationSlug || 'all' },
        { cache: true, signal }
      )
    },
    [startDate, endDate, locationSlug]
  )

  const trainers = useMemo(() => {
    if (!data?.rows) return []
    return [...new Set(data.rows.map(r => r.serviceEmployee).filter(Boolean))].sort()
  }, [data])

  const filtered = useMemo(() => {
    if (!data?.rows) return []
    const q = search.trim().toLowerCase()
    return data.rows.filter(r => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (trainerFilter !== 'all' && r.serviceEmployee !== trainerFilter) return false
      if (q) {
        const hay = `${r.memberName} ${r.package} ${r.serviceEmployee || ''} ${r.clubName}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data, typeFilter, trainerFilter, search])

  const summary = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        if (r.type === 'Deactivated RS') acc.deactivatedCount++
        else acc.burnedCount++
        acc.totalValue += r.value || 0
        return acc
      },
      { deactivatedCount: 0, burnedCount: 0, totalValue: 0 }
    )
  }, [filtered])

  if (loading) return <MobileLoading variant="report" />

  if (error) return (
    <div className="p-4">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-red-600">{error.message || String(error)}</p>
      </div>
    </div>
  )

  if (!data) return null

  return (
    <div className="p-4 space-y-3">
      {/* Stat cards */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 min-w-max">
          <StatCard label="Total Deactivated" value={filtered.length} />
          <StatCard label="Deactivated RS" value={summary.deactivatedCount} tone="red" />
          <StatCard label="PIF Burned" value={summary.burnedCount} tone="amber" />
          <StatCard label="$ Burned" value={fmtMoney(summary.totalValue)} tone="amber" />
        </div>
      </div>

      {/* Errors per club */}
      {data.errors?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs text-amber-900">
          Some locations failed to load:
          <ul className="mt-1 list-disc pl-5">
            {data.errors.map((e, i) => <li key={i}>{e.club}: {e.error}</li>)}
          </ul>
        </div>
      )}

      {/* Type filter pills */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          {TYPES.map(t => (
            <button
              key={t.key}
              onClick={() => setTypeFilter(t.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                typeFilter === t.key
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Trainer filter pills */}
      {trainers.length > 0 && (
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 min-w-max">
            <button
              onClick={() => setTrainerFilter('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                trainerFilter === 'all'
                  ? 'bg-wcs-red text-white'
                  : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              All Trainers
            </button>
            {trainers.map(t => (
              <button
                key={t}
                onClick={() => setTrainerFilter(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  trainerFilter === t
                    ? 'bg-wcs-red text-white'
                    : 'bg-surface border border-border text-text-secondary'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Search member, package..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-text-muted"
      />

      {/* Row cards */}
      {filtered.length === 0 ? (
        <div className="bg-surface border border-border rounded-2xl p-8 text-center text-text-muted text-sm">
          No deactivated PT in this date range.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r, i) => (
            <button
              key={`${r.memberId}-${r.type}-${r.saleDate}-${i}`}
              type="button"
              onClick={() => openMemberDetail(r)}
              className="w-full text-left bg-surface border border-border rounded-2xl p-4 space-y-2 active:bg-bg transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-text-primary leading-tight">{r.memberName}</p>
                <TypePill kind={r.type} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                {r.serviceEmployee && (
                  <span className="font-medium text-text-secondary">{r.serviceEmployee}</span>
                )}
                <span>Cancel: {fmtDate(r.cancelDate)}</span>
                <span className="font-semibold text-text-primary">{fmtMoney(r.value)}</span>
              </div>
              {r.package && (
                <p className="text-xs text-text-muted truncate">{r.package}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Member detail modal */}
      {memberDetail && (
        <MemberDetailModal detail={memberDetail} onClose={closeMemberDetail} />
      )}
    </div>
  )
}

function StatCard({ label, value, tone }) {
  const toneCls = tone === 'red'
    ? 'border-red-200 bg-red-50'
    : tone === 'amber'
      ? 'border-amber-200 bg-amber-50'
      : 'border-border bg-surface'
  return (
    <div className={`min-w-[130px] rounded-2xl border p-4 flex-shrink-0 ${toneCls}`}>
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      <p className="text-xs text-text-muted uppercase tracking-wide mt-1">{label}</p>
    </div>
  )
}

function TypePill({ kind }) {
  const isRS = kind === 'Deactivated RS'
  const cls = isRS
    ? 'bg-red-50 text-red-700 border-red-200'
    : 'bg-amber-50 text-amber-700 border-amber-200'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${cls}`}>
      {kind}
    </span>
  )
}

function MemberDetailModal({ detail, onClose }) {
  const { row, loading, data, error } = detail
  const name = data?.name || row.memberName

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex flex-col justify-end"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-t-3xl border-t border-border shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-border rounded-full" />
        </div>

        <div className="px-5 pb-8 pt-2 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-text-muted">{row.clubName}</p>
              <h3 className="text-lg font-bold text-text-primary mt-0.5">{name}</h3>
              <TypePill kind={row.type} />
            </div>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary text-2xl leading-none px-1 pt-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Row summary */}
          <div className="bg-bg rounded-2xl border border-border p-3 text-xs space-y-1.5">
            <DetailRow label="Package" value={row.package} />
            <DetailRow label="Cancel / Last Used" value={fmtDate(row.cancelDate)} />
            <DetailRow label="Sale Date" value={fmtDate(row.saleDate)} />
            <DetailRow label="Value" value={fmtMoney(row.value)} />
            <DetailRow label="Trainer" value={row.serviceEmployee || '—'} />
          </div>

          {/* Contact info */}
          {loading && (
            <div className="flex items-center gap-2 py-3 text-sm text-text-muted">
              <WcsLoadingMark size={24} className="text-wcs-red" />
              Loading from ABC…
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {data && !loading && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-text-muted font-semibold">Contact</p>
              <ContactRow label="Email" value={data.email} kind="email" />
              <ContactRow label="Primary Phone" value={data.primaryPhone} kind="phone" />
              <ContactRow label="Mobile Phone" value={data.mobilePhone} kind="phone" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-text-muted shrink-0">{label}</span>
      <span className="text-text-primary font-medium text-right">{value || '—'}</span>
    </div>
  )
}

function ContactRow({ label, value, kind }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.warn('Clipboard write failed:', err.message)
    }
  }

  if (!value) {
    return (
      <div className="flex items-center gap-2 py-2.5 border-b border-border last:border-0">
        <span className="text-xs uppercase tracking-wide text-text-muted w-28 shrink-0">{label}</span>
        <span className="text-text-muted text-sm">—</span>
      </div>
    )
  }

  const href = kind === 'email' ? `mailto:${value}` : `tel:${value}`
  return (
    <div className="flex items-center gap-2 py-2.5 border-b border-border last:border-0">
      <span className="text-xs uppercase tracking-wide text-text-muted w-28 shrink-0">{label}</span>
      <a href={href} className="text-text-primary font-medium text-sm hover:text-wcs-red break-all flex-1">
        {value}
      </a>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={handleCopy}
          className="p-2 rounded-xl text-text-muted hover:text-wcs-red hover:bg-bg active:bg-bg focus:outline-none transition-colors"
          title={`Copy ${label.toLowerCase()}`}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-green-600">
              <path fillRule="evenodd" d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
            </svg>
          )}
        </button>
        <span
          aria-live="polite"
          className={`pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide bg-green-600 text-white whitespace-nowrap shadow-sm transition-all duration-200 ${
            copied ? 'opacity-100 -translate-x-0' : 'opacity-0 translate-x-1'
          }`}
        >
          Copied!
        </span>
      </div>
    </div>
  )
}
