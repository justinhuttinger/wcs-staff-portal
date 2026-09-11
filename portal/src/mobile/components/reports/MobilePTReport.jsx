import React, { useState, useMemo } from 'react'
import { getPTReport } from '../../../lib/api'
import MobileLoading from '../MobileLoading'
import { useCancellableFetch } from '../../../hooks/useCancellableFetch'

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function formatDate(val) {
  if (!val) return '\u2014'
  if (typeof val === 'number' || (typeof val === 'string' && /^\d{10,}$/.test(val))) return new Date(parseInt(val)).toLocaleDateString()
  return val
}

function statusPillClass(status) {
  const s = (status || '').toLowerCase()
  if (s === 'show' || s === 'completed' || s === 'complete') return 'bg-green-50 text-green-700 border-green-200'
  if (s === 'no show') return 'bg-red-50 text-red-500 border-red-200'
  return 'bg-gray-50 text-gray-500 border-gray-200'
}

/** One key for a person however their name was typed. */
function normaliseName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * A trainer's open Day Ones, each linking to the outcome form they already get
 * sent — the same public page, addressed by GHL contact, so this is a route
 * into the existing form rather than a second place to record an outcome.
 *
 * A row whose appointment carries no contact id still shows with the link
 * withheld: hiding it would make the count on the pill disagree with the list
 * under it, and the chase is still worth making by hand.
 */
function PendingList({ rows }) {
  if (!rows || rows.length === 0) {
    return <p className="mt-2 text-[11px] text-text-muted">Nothing open for this trainer in this range.</p>
  }
  return (
    <div className="mt-2 space-y-1.5 border-t border-border pt-2">
      {rows.map(r => (
        <div key={r.id} className="flex items-center gap-2 text-[11px]">
          <span className="text-text-primary flex-1 truncate">{r.member || 'Unnamed'}</span>
          <span className="text-text-muted tabular-nums">{r.date}</span>
          <span className={`tabular-nums ${r.daysOverdue >= 14 ? 'text-wcs-red font-semibold' : 'text-text-muted'}`}>
            {r.daysOverdue}d
          </span>
          {r.contactId ? (
            <a
              href={`/day-one/outcome?c=${encodeURIComponent(r.contactId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-0.5 rounded-lg border border-border text-text-primary font-semibold"
            >
              Record
            </a>
          ) : (
            <span className="text-text-muted" title="No GHL contact on this appointment">—</span>
          )}
        </div>
      ))}
    </div>
  )
}

export default function MobilePTReport({ startDate, endDate, locationSlug }) {
  const [selectedContact, setSelectedContact] = useState(null)

  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getPTReport(params, { cache: true, signal })
    },
    [startDate, endDate, locationSlug]
  )

  // Transform by_trainer object to array
  const trainers = useMemo(() => {
    return Object.entries(data?.by_trainer || {}).map(([name, stats]) => ({
      name,
      total: stats.total || 0,
      scheduled: stats.scheduled || 0,
      completed: stats.completed || 0,
      no_show: stats.no_show || 0,
      sales: stats.sales || 0,
      no_sales: stats.no_sales || 0,
    })).sort((a, b) => b.total - a.total)
  }, [data?.by_trainer])

  // Which trainer's open Day Ones are expanded, if any.
  const [pendingFor, setPendingFor] = useState(null)

  // Keyed the way the trainer names are, so a doubled space or a case
  // difference does not leave the pill missing for somebody who plainly has
  // open forms.
  const pendingByTrainer = {}
  for (const [who, n] of Object.entries(data?.pending?.byTrainer || {})) {
    pendingByTrainer[normaliseName(who)] = (pendingByTrainer[normaliseName(who)] || 0) + n
  }

  const totalDayOnes = data?.total_day_ones || 0
  const completionRate = data?.completion_rate || 0
  const closeRate = data?.close_rate || 0

  const totals = useMemo(() => {
    return trainers.reduce((acc, t) => ({
      total: acc.total + t.total,
      completed: acc.completed + t.completed,
      no_show: acc.no_show + t.no_show,
      sales: acc.sales + t.sales,
      no_sales: acc.no_sales + t.no_sales,
    }), { total: 0, completed: 0, no_show: 0, sales: 0, no_sales: 0 })
  }, [trainers])


  if (loading) return <MobileLoading variant="report" />

  if (error) return (
    <div className="p-4">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-red-600">{error.message || String(error)}</p>
      </div>
    </div>
  )

  return (
    <div className="p-4 space-y-3">
      {/* Top stat cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface rounded-2xl border border-border p-4 text-center">
          <p className="text-3xl font-bold text-text-primary">{totalDayOnes}</p>
          <p className="text-xs text-text-muted uppercase mt-1">Set</p>
        </div>
        <div className="bg-surface rounded-2xl border border-border p-4 text-center">
          <p className="text-3xl font-bold text-text-primary">{totals.completed}</p>
          <p className="text-xs text-text-muted uppercase mt-1">Show</p>
          <p className="text-[10px] text-text-secondary">{completionRate}% of set</p>
        </div>
        <div className="bg-surface rounded-2xl border border-border p-4 text-center">
          <p className="text-3xl font-bold text-text-primary">{totals.sales}</p>
          <p className="text-xs text-text-muted uppercase mt-1">Close</p>
          <p className="text-[10px] text-text-secondary">{closeRate}% of shown</p>
        </div>
        {/* The card that says how far to trust the two above it: a Day One
            whose date has passed with nothing recorded is neither held nor
            missed, so Show and Close are measured on an incomplete picture. */}
        <div className="bg-surface rounded-2xl border border-border p-4 text-center">
          <p className="text-3xl font-bold text-text-primary">{data?.pending_outcome ?? '—'}</p>
          <p className="text-xs text-text-muted uppercase mt-1">Pending</p>
          <p className="text-[10px] text-text-secondary">Passed, no outcome</p>
        </div>
      </div>

      {/* Trainer cards */}
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide bg-surface/95 backdrop-blur-sm rounded-lg border border-border px-3 py-1.5 shadow-sm inline-block">Trainers</p>
      <div className="space-y-2">
        {trainers.map(trainer => {
          const tShowPct = trainer.total > 0 ? Math.round((trainer.completed / trainer.total) * 100) : 0
          const tClosePct = trainer.completed > 0 ? Math.round((trainer.sales / trainer.completed) * 100) : 0
          const tPending = pendingByTrainer[normaliseName(trainer.name)] || 0
          const tPendingRows = (data?.pending?.list || [])
            .filter(r => normaliseName(r.trainer) === normaliseName(trainer.name))

          return (
            <div key={trainer.name} className="bg-surface rounded-2xl border border-border p-4">
              <p className="text-sm font-semibold text-text-primary mb-2">{trainer.name}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
                <span>Set: <strong className="text-text-primary">{trainer.total}</strong></span>
                <span>Completed: <strong className="text-text-primary">{trainer.completed}</strong></span>
                <span>No Show: <strong className="text-text-primary">{trainer.no_show}</strong></span>
                <span>Sales: <strong className="text-text-primary">{trainer.sales}</strong></span>
              </div>
              <div className="flex gap-2 mt-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  Show {tShowPct}%
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-50 text-green-700 border border-green-200">
                  Close {tClosePct}%
                </span>
                {tPending > 0 && (
                  <button
                    type="button"
                    onClick={() => setPendingFor(pendingFor === trainer.name ? null : trainer.name)}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
                  >
                    Pending {tPending}
                  </button>
                )}
              </div>
              {pendingFor === trainer.name && <PendingList rows={tPendingRows} />}
            </div>
          )
        })}
      </div>

      {/* Day One contacts */}
      {(data?.contacts || []).length > 0 && (
        <>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide pt-2 bg-surface/95 backdrop-blur-sm rounded-lg border border-border px-3 py-1.5 shadow-sm inline-block">Day One Contacts</p>
          <div className="space-y-2">
            {(data?.contacts || []).map((c, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedContact(c)}
                className="w-full text-left bg-surface rounded-2xl border border-border p-4 active:bg-bg transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-text-primary">{capitalize(c.first_name)} {capitalize(c.last_name)}</p>
                  <span className="text-[10px] text-text-muted">{formatDate(c.day_one_booking_date)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {c.day_one_booking_team_member && (
                    <span className="text-text-secondary">by {c.day_one_booking_team_member}</span>
                  )}
                  {c.day_one_trainer && (
                    <span className="text-text-secondary">w/ {c.day_one_trainer}</span>
                  )}
                </div>
                <div className="flex gap-2 mt-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusPillClass(c.day_one_status)}`}>
                    {c.day_one_status || 'Scheduled'}
                  </span>
                  {c.day_one_sale === 'Sale' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-50 text-green-700 border border-green-200">
                      Sale
                    </span>
                  )}
                  {c.day_one_sale && c.day_one_sale !== 'Sale' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-50 text-red-600 border border-red-200">
                      No Sale
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}


      {/* Contact detail modal */}
      {selectedContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setSelectedContact(null)}>
          <div className="bg-surface w-full max-w-sm rounded-2xl p-5 shadow-xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-text-primary">{capitalize(selectedContact.first_name)} {capitalize(selectedContact.last_name)}</h3>
              <button onClick={() => setSelectedContact(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-bg text-text-muted text-lg leading-none">&times;</button>
            </div>
            <div className="space-y-3 text-sm">
              <Detail label="Booking Date" value={formatDate(selectedContact.day_one_booking_date)} />
              <Detail label="Day One Date" value={formatDate(selectedContact.day_one_date)} />
              <Detail label="Booking Team Member" value={selectedContact.day_one_booking_team_member} />
              <Detail label="Trainer" value={selectedContact.day_one_trainer} />
              <Detail label="Status" value={selectedContact.day_one_status || 'Scheduled'} />
              <Detail label="Sale" value={selectedContact.day_one_sale || '\u2014'} />
              {selectedContact.pt_sale_type && <Detail label="Sale Type" value={selectedContact.pt_sale_type} />}
              {selectedContact.why_no_sale && <Detail label="Why No Sale" value={selectedContact.why_no_sale} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary font-medium">{value || '\u2014'}</span>
    </div>
  )
}
