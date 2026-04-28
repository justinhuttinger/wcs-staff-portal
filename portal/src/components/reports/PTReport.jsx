import { useState, useEffect, useRef } from 'react'
import { getPTReport } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function formatDate(val) {
  if (!val) return '—'
  if (typeof val === 'number' || (typeof val === 'string' && /^\d{10,}$/.test(val))) {
    return new Date(parseInt(val)).toLocaleDateString()
  }
  return val
}

function StatusPill({ status }) {
  const s = (status || '').toLowerCase()
  if (s === 'show' || s === 'completed' || s === 'complete') {
    return <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">{status}</span>
  }
  if (s === 'no show' || s === 'no-show' || s === 'noshow') {
    return <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-500 text-xs border border-red-200">{status}</span>
  }
  return <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 text-xs border border-gray-200">{status || '—'}</span>
}

function DetailModal({ contact, onClose }) {
  const c = contact
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-2xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-text-primary">{capitalize(c.first_name)} {capitalize(c.last_name)}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Booking Team Member</span>
            <span className="text-text-primary font-medium">{c.day_one_booking_team_member || '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Date Scheduled</span>
            <span className="text-text-primary font-medium">{formatDate(c.day_one_booking_date)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Day One Date</span>
            <span className="text-text-primary font-medium">{formatDate(c.day_one_date)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Trainer</span>
            <span className="text-text-primary font-medium">{c.day_one_trainer || '—'}</span>
          </div>
          <div className="flex justify-between text-sm items-center">
            <span className="text-text-muted">Status</span>
            <StatusPill status={c.day_one_status} />
          </div>
          {(c.day_one_status || '').toLowerCase() !== 'scheduled' && (
            <>
              <div className="flex justify-between text-sm items-center">
                <span className="text-text-muted">Sale Result</span>
                <span className="text-text-primary font-medium">
                  {c.day_one_sale === 'Sale'
                    ? <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-xs">Sale</span>
                    : c.day_one_sale || '—'
                  }
                </span>
              </div>
              {c.pt_sale_type && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">PT Sale Type</span>
                  <span className="text-text-primary font-medium">{c.pt_sale_type}</span>
                </div>
              )}
              {c.why_no_sale && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Why No Sale</span>
                  <span className="text-text-primary font-medium">{c.why_no_sale}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PTReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedTrainer, setExpandedTrainer] = useState(null)
  const [detailContact, setDetailContact] = useState(null)

  const requestRef = useRef(0)

  useEffect(() => {
    const id = ++requestRef.current
    setData(null)
    setLoading(true)
    setError('')
    const params = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
    getPTReport(params).then(res => {
      if (id === requestRef.current) { setData(res); setLoading(false) }
    }).catch(err => {
      if (id === requestRef.current) { setError(err.message); setLoading(false) }
    })
  }, [startDate, endDate, locationSlug])

  if (loading) return <p className="mx-auto w-fit bg-surface text-text-primary text-sm px-4 py-2 my-6 rounded-lg border border-border shadow-sm block">Loading PT data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  const totalDayOnes = data.total_day_ones || 0
  const completionRate = data.completion_rate || 0
  const closeRate = data.close_rate || 0

  const contacts = data.contacts || []
  const byStatus = data.by_status || {}
  const totalCompleted = byStatus['Completed'] || 0
  const totalSales = Object.values(data.by_trainer || {}).reduce((sum, t) => sum + (t.sales || 0), 0)

  const trainerRows = Object.entries(data.by_trainer || {}).sort((a, b) => b[1].total - a[1].total)

  const totals = trainerRows.reduce((acc, [, s]) => {
    acc.total += s.total || 0
    acc.scheduled += s.scheduled || 0
    acc.completed += s.completed || 0
    acc.no_show += s.no_show || 0
    acc.sales += s.sales || 0
    acc.no_sales += s.no_sales || 0
    return acc
  }, { total: 0, scheduled: 0, completed: 0, no_show: 0, sales: 0, no_sales: 0 })

  return (
    <div className="space-y-6">
      {/* Stat Cards — Set / Show / Close */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Set</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalDayOnes}</p>
          <p className="text-xs text-text-muted mt-0.5">Total Day Ones</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Show</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalCompleted}</p>
          <p className="text-xs text-text-muted mt-0.5">{completionRate}% of {totalDayOnes} set</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Close</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalSales}</p>
          <p className="text-xs text-text-muted mt-0.5">{closeRate}% of {totalCompleted} shown</p>
        </div>
      </div>

      {/* Trainer Summary Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-bg">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Trainer Stats</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Trainer</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Set</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Completed</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">No Show</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Sales</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">No Sale</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Show %</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Close %</th>
            </tr>
          </thead>
          <tbody>
            {trainerRows.map(([name, stats]) => {
              const rowTotal = stats.total || 0
              const rowCompleted = stats.completed || 0
              const rowNoShow = stats.no_show || 0
              const rowSales = stats.sales || 0
              const rowNoSales = stats.no_sales || 0
              const showPct = rowTotal > 0 ? Math.round((rowCompleted / rowTotal) * 100) : 0
              const closePct = rowCompleted > 0 ? Math.round((rowSales / rowCompleted) * 100) : 0
              return (
                <tr key={name} className="border-b border-border hover:bg-bg/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-text-primary">{name}</td>
                  <td className="px-4 py-3 text-center font-semibold text-text-primary">{rowTotal}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">{rowCompleted}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-500 text-xs border border-red-200">{rowNoShow}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-wcs-red font-semibold">{rowSales}</td>
                  <td className="px-4 py-3 text-center text-text-muted">{rowNoSales}</td>
                  <td className="px-4 py-3 text-center text-text-primary font-medium">{showPct}%</td>
                  <td className="px-4 py-3 text-center text-text-primary font-medium">{closePct}%</td>
                </tr>
              )
            })}
            {trainerRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-text-muted text-sm">No data for this period</td>
              </tr>
            )}
            {trainerRows.length > 0 && (
              <tr className="border-t-2 border-border font-bold bg-bg/30">
                <td className="px-4 py-3 text-text-primary">Total</td>
                <td className="px-4 py-3 text-center text-text-primary">{totals.total}</td>
                <td className="px-4 py-3 text-center text-green-700">{totals.completed}</td>
                <td className="px-4 py-3 text-center text-red-500">{totals.no_show}</td>
                <td className="px-4 py-3 text-center text-wcs-red">{totals.sales}</td>
                <td className="px-4 py-3 text-center text-text-muted">{totals.no_sales}</td>
                <td className="px-4 py-3 text-center">{totals.total > 0 ? Math.round((totals.completed / totals.total) * 100) : 0}%</td>
                <td className="px-4 py-3 text-center">{totals.completed > 0 ? Math.round((totals.sales / totals.completed) * 100) : 0}%</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Day One Breakdown — clickable rows */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-bg">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Day One Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Member Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Booking Team Member</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Date Scheduled</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Day One Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Trainer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Sale</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr
                  key={i}
                  onClick={() => setDetailContact(c)}
                  className="border-b border-border hover:bg-bg/50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-2 font-medium text-text-primary">{capitalize(c.first_name)} {capitalize(c.last_name)}</td>
                  <td className="px-4 py-2 text-text-muted">{c.day_one_booking_team_member || '—'}</td>
                  <td className="px-4 py-2 text-text-muted">{formatDate(c.day_one_booking_date)}</td>
                  <td className="px-4 py-2 text-text-muted">{formatDate(c.day_one_date)}</td>
                  <td className="px-4 py-2 text-text-muted">{c.day_one_trainer || '—'}</td>
                  <td className="px-4 py-2"><StatusPill status={c.day_one_status} /></td>
                  <td className="px-4 py-2">
                    {(c.day_one_status || '').toLowerCase() === 'scheduled' ? '—' :
                      c.day_one_sale === 'Sale'
                        ? <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-xs">Sale</span>
                        : <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 text-xs">{c.day_one_sale || 'No Sale'}</span>
                    }
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted text-sm">No Day One data for this period</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export Controls */}
      <div className="flex justify-end gap-2">
        <button onClick={() => {
          const csvRows = [
            ['Member Name', 'Booking Team Member', 'Date Scheduled', 'Day One Date', 'Trainer', 'Status', 'Sale'],
            ...contacts.map(c => [
              (c.first_name || '') + ' ' + (c.last_name || ''),
              c.day_one_booking_team_member || '',
              formatDate(c.day_one_booking_date),
              formatDate(c.day_one_date),
              c.day_one_trainer || '',
              c.day_one_status || '',
              c.day_one_sale || '',
            ]),
          ]
          exportCSV(csvRows, `pt-day-one-report-${startDate}-${endDate}`)
        }} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">CSV</button>
        <button onClick={() => exportPDF('PT / Day One Report')} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">PDF</button>
      </div>

      {/* Detail Modal */}
      {detailContact && (
        <DetailModal contact={detailContact} onClose={() => setDetailContact(null)} />
      )}
    </div>
  )
}
