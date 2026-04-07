import { useState, useEffect } from 'react'
import { getVIPReport } from '../../lib/api'

export default function VIPReport({ startDate, endDate, locationId }) {
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
      const res = await getVIPReport(params)
      setData(res)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading VIP data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  const salespersons = Object.entries(data.by_salesperson).sort((a, b) => b[1].vips - a[1].vips)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-xl p-6 text-center">
          <p className="text-4xl font-bold text-wcs-red">{data.total_vips}</p>
          <p className="text-sm text-text-muted mt-1">Total VIPs</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-6 text-center">
          <p className="text-4xl font-bold text-text-primary">{data.total_contacts}</p>
          <p className="text-sm text-text-muted mt-1">Members with VIPs</p>
        </div>
      </div>

      <h3 className="text-sm font-semibold text-text-primary">By Salesperson</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {salespersons.map(([name, stats]) => (
          <div key={name} className="bg-surface border border-border rounded-xl p-4">
            <p className="text-2xl font-bold text-text-primary">{stats.vips}</p>
            <p className="text-xs text-text-muted">VIPs from {stats.count} members</p>
            <p className="text-sm text-text-muted truncate mt-1">{name}</p>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Name</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted">VIPs</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Salesperson</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Sign Date</th>
            </tr>
          </thead>
          <tbody>
            {(data.contacts || []).map((c, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-text-primary font-medium">{c.first_name} {c.last_name}</td>
                <td className="px-4 py-3 text-center font-semibold text-wcs-red">{c.vip_count}</td>
                <td className="px-4 py-3 text-text-muted">{c.sale_team_member || '—'}</td>
                <td className="px-4 py-3 text-text-muted">{c.member_sign_date || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data.contacts || []).length === 0 && <p className="text-center text-text-muted text-sm py-8">No VIP data for this period</p>}
      </div>
    </div>
  )
}
