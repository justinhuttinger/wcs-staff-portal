import { useState, useEffect } from 'react'
import { getMembershipReport } from '../../lib/api'

export default function MembershipReport({ startDate, endDate, locationId }) {
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

  const salespersons = Object.entries(data.by_salesperson).sort((a, b) => b[1].length - a[1].length)

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="text-center">
          <p className="text-4xl font-bold text-wcs-red">{data.total}</p>
          <p className="text-sm text-text-muted mt-1">New Members</p>
        </div>
      </div>

      <h3 className="text-sm font-semibold text-text-primary">By Salesperson</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {salespersons.map(([name, contacts]) => (
          <div key={name} className="bg-surface border border-border rounded-xl p-4">
            <p className="text-2xl font-bold text-text-primary">{contacts.length}</p>
            <p className="text-sm text-text-muted truncate">{name}</p>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Sign Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Salesperson</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Same Day</th>
            </tr>
          </thead>
          <tbody>
            {(data.contacts || []).map((c, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-text-primary font-medium">{c.first_name} {c.last_name}</td>
                <td className="px-4 py-3 text-text-muted">{c.member_sign_date}</td>
                <td className="px-4 py-3 text-text-muted">{c.sale_team_member || '—'}</td>
                <td className="px-4 py-3 text-text-muted text-xs">{c.membership_type || '—'}</td>
                <td className="px-4 py-3">
                  {c.same_day_sale === 'Sale' ? (
                    <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">Sale</span>
                  ) : c.same_day_sale ? (
                    <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 text-xs border border-gray-200">{c.same_day_sale}</span>
                  ) : '—'}
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
