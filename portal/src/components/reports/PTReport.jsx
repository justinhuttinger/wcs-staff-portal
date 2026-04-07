import { useState, useEffect } from 'react'
import { getPTReport } from '../../lib/api'

export default function PTReport({ startDate, endDate, locationId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { loadData() }, [startDate, endDate, locationId])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      if (locationId) params.location_id = locationId
      const res = await getPTReport(params)
      setData(res)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading PT data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  const bookers = Object.entries(data.by_booker).sort((a, b) => b[1].set - a[1].set)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface border border-border rounded-xl p-6 text-center">
          <p className="text-4xl font-bold text-blue-600">{data.total_set}</p>
          <p className="text-sm text-text-muted mt-1">Set</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-6 text-center">
          <p className="text-4xl font-bold text-yellow-600">{data.total_showed}</p>
          <p className="text-sm text-text-muted mt-1">Showed ({data.show_rate}%)</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-6 text-center">
          <p className="text-4xl font-bold text-green-600">{data.total_closed}</p>
          <p className="text-sm text-text-muted mt-1">Closed ({data.close_rate}%)</p>
        </div>
      </div>

      <h3 className="text-sm font-semibold text-text-primary">By Team Member</h3>
      <div className="bg-surface border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Team Member</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted">Set</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted">Show</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted">Close</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted">Show %</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted">Close %</th>
            </tr>
          </thead>
          <tbody>
            {bookers.map(([name, stats]) => (
              <tr key={name} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-text-primary font-medium">{name}</td>
                <td className="px-4 py-3 text-center text-blue-600 font-semibold">{stats.set}</td>
                <td className="px-4 py-3 text-center text-yellow-600 font-semibold">{stats.show}</td>
                <td className="px-4 py-3 text-center text-green-600 font-semibold">{stats.close}</td>
                <td className="px-4 py-3 text-center text-text-muted">{stats.set > 0 ? Math.round((stats.show / stats.set) * 100) : 0}%</td>
                <td className="px-4 py-3 text-center text-text-muted">{stats.show > 0 ? Math.round((stats.close / stats.show) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {bookers.length === 0 && <p className="text-center text-text-muted text-sm py-8">No data for this period</p>}
      </div>

      <h3 className="text-sm font-semibold text-text-primary">All Day Ones</h3>
      <div className="bg-surface border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Booking Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Booked By</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Trainer</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Show</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Sale</th>
            </tr>
          </thead>
          <tbody>
            {(data.contacts || []).map((c, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-text-primary font-medium">{c.first_name} {c.last_name}</td>
                <td className="px-4 py-3 text-text-muted">{c.day_one_booking_date}</td>
                <td className="px-4 py-3 text-text-muted text-xs">{c.day_one_booking_team_member || '—'}</td>
                <td className="px-4 py-3 text-text-muted text-xs">{c.day_one_trainer || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${
                    c.show_or_no_show === 'Show' ? 'bg-green-50 text-green-700 border-green-200' :
                    c.show_or_no_show === 'No Show' ? 'bg-red-50 text-red-500 border-red-200' :
                    'bg-gray-50 text-gray-500 border-gray-200'
                  }`}>{c.show_or_no_show || c.day_one_status || '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${
                    c.day_one_sale === 'Sale' ? 'bg-green-50 text-green-700 border-green-200' :
                    'bg-gray-50 text-gray-500 border-gray-200'
                  }`}>{c.day_one_sale || '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data.contacts || []).length === 0 && <p className="text-center text-text-muted text-sm py-8">No data for this period</p>}
      </div>
    </div>
  )
}
