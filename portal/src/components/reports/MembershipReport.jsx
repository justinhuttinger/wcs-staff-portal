import { useState, useEffect } from 'react'
import { getMembershipReport } from '../../lib/api'
import { exportCSV, exportPDF } from '../../lib/export'

function buildDateBars(contacts, startDate, endDate) {
  // Build a map of date -> count from contacts
  const countByDate = {}
  for (const c of contacts) {
    const d = c.member_sign_date
    if (d) countByDate[d] = (countByDate[d] || 0) + 1
  }

  // Determine the range: last 14 days or actual range, whichever is shorter
  const end = endDate ? new Date(endDate) : new Date()
  const start = startDate ? new Date(startDate) : new Date()
  const rangeMs = end - start
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000
  const useStart = rangeMs > fourteenDaysMs ? new Date(end.getTime() - fourteenDaysMs) : start

  const bars = []
  const cur = new Date(useStart)
  while (cur <= end) {
    const dateStr = cur.toISOString().split('T')[0]
    bars.push({ date: dateStr, count: countByDate[dateStr] || 0 })
    cur.setDate(cur.getDate() + 1)
  }
  return bars
}

export default function MembershipReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { loadData() }, [startDate, endDate, locationSlug])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      const res = await getMembershipReport(params)
      setData(res)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading membership data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  const contacts = data.contacts || []

  // Use pre-aggregated data from API
  const totalMemberships = data.total_memberships || 0
  const tc = data.trial_conversion || {}
  const trialRate = tc.rate || 0
  const dayOneBooked = data.total_day_one_booked || 0
  const totalVips = data.total_vips || 0

  const salespersonRows = Object.entries(data.by_salesperson || {}).sort((a, b) => b[1].memberships - a[1].memberships)

  function handleExportCSV() {
    const csvRows = [
      ['Salesperson', 'Memberships', 'VIPs', 'Day One Booked'],
      ...salespersonRows.map(([name, s]) => [name, s.memberships, s.vips, s.day_one_booked]),
    ]
    exportCSV(csvRows, `membership-report-${startDate}-${endDate}`)
  }

  // Bar chart
  const bars = buildDateBars(contacts, startDate, endDate)
  const maxCount = Math.max(...bars.map(b => b.count), 1)

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total Memberships</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalMemberships}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Trial Conversion</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{trialRate}%</p>
          <p className="text-xs text-text-muted mt-0.5">{tc.won || 0} won / {tc.trial_started || 0} started</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total Day One Booked</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{dayOneBooked}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total VIPs</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalVips}</p>
        </div>
      </div>

      {/* Bar Chart */}
      {bars.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Memberships by Date</p>
          <div className="flex items-end gap-1" style={{ height: '120px' }}>
            {bars.map(bar => (
              <div key={bar.date} className="flex flex-col items-center flex-1 min-w-0 h-full justify-end">
                <div
                  className="w-full bg-wcs-red rounded-t"
                  style={{ height: bar.count === 0 ? '2px' : `${Math.round((bar.count / maxCount) * 100)}%`, opacity: bar.count === 0 ? 0.2 : 1 }}
                  title={`${bar.date}: ${bar.count}`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-text-muted mt-1">
            <span>{bars[0]?.date}</span>
            <span>{bars[bars.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Export Controls */}
      <div className="flex justify-end gap-2">
        <button onClick={handleExportCSV} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">CSV</button>
        <button onClick={exportPDF} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary transition-colors">PDF</button>
      </div>

      {/* Salesperson Summary Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Salesperson</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Memberships</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">VIPs</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Day One Booked</th>
            </tr>
          </thead>
          <tbody>
            {salespersonRows.map(([name, stats]) => (
              <tr key={name} className="border-b border-border hover:bg-bg/50 transition-colors">
                <td className="px-4 py-3 font-medium text-text-primary">{name}</td>
                <td className="px-4 py-3 text-center text-wcs-red font-semibold">{stats.memberships}</td>
                <td className="px-4 py-3 text-center text-text-primary">{stats.vips}</td>
                <td className="px-4 py-3 text-center text-text-primary">{stats.day_one_booked}</td>
              </tr>
            ))}
            {salespersonRows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-text-muted text-sm">No data for this period</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
