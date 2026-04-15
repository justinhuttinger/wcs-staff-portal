import React, { useState, useEffect, useMemo } from 'react'
import { getPTReport } from '../../../lib/api'

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

export default function MobilePTReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedContact, setSelectedContact] = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setLoading(true)
    setError(null)
    const params = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
    getPTReport(params)
      .then(res => { if (!cancelled) setData(res) })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load report') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, locationSlug])

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


  if (loading) return (
    <div className="p-4 space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="bg-surface rounded-2xl border border-border p-4 animate-pulse">
          <div className="h-4 bg-bg rounded w-1/3 mb-2" />
          <div className="h-8 bg-bg rounded w-1/2" />
        </div>
      ))}
    </div>
  )

  if (error) return (
    <div className="p-4">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    </div>
  )

  return (
    <div className="p-4 space-y-3">
      {/* Top stat cards */}
      <div className="grid grid-cols-3 gap-3">
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
      </div>

      {/* Trainer cards */}
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Trainers</p>
      <div className="space-y-2">
        {trainers.map(trainer => {
          const tShowPct = trainer.total > 0 ? Math.round((trainer.completed / trainer.total) * 100) : 0
          const tClosePct = trainer.completed > 0 ? Math.round((trainer.sales / trainer.completed) * 100) : 0

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
              </div>
            </div>
          )
        })}
      </div>

      {/* Day One contacts */}
      {(data?.contacts || []).length > 0 && (
        <>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide pt-2">Day One Contacts</p>
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
