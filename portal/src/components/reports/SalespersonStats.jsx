import { useState, useEffect } from 'react'
import { getSalespersonStats } from '../../lib/api'

export default function SalespersonStats({ startDate, endDate, locationSlug }) {
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
      const res = await getSalespersonStats(params)
      setData(res)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading salesperson data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  const rows = Object.entries(data.by_salesperson || {}).sort((a, b) => b[1].total_sales - a[1].total_sales)

  const totalSales = rows.reduce((sum, [, s]) => sum + (s.total_sales || 0), 0)
  const totalVIPs = rows.reduce((sum, [, s]) => sum + (s.vips || 0), 0)
  const totalDayOneYes = rows.reduce((sum, [, s]) => sum + (s.day_one_yes || 0), 0)
  const totalDayOneNo = rows.reduce((sum, [, s]) => sum + (s.day_one_no || 0), 0)
  const dayOneTotal = totalDayOneYes + totalDayOneNo
  const dayOneRate = dayOneTotal > 0 ? Math.round((totalDayOneYes / dayOneTotal) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total Sales</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalSales}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total VIPs</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{totalVIPs}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Day One Booked Rate</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{dayOneRate}%</p>
          <p className="text-xs text-text-muted mt-0.5">{totalDayOneYes} yes / {dayOneTotal} total</p>
        </div>
      </div>

      {/* Summary Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase">Salesperson</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Total Sales</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">VIPs</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Day One Yes</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-text-muted uppercase">Day One No</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, stats]) => (
              <tr key={name} className="border-b border-border hover:bg-bg/50 transition-colors">
                <td className="px-4 py-3 font-medium text-text-primary">{name}</td>
                <td className="px-4 py-3 text-center text-wcs-red font-semibold">{stats.total_sales || 0}</td>
                <td className="px-4 py-3 text-center text-text-primary">{stats.vips || 0}</td>
                <td className="px-4 py-3 text-center text-green-600">{stats.day_one_yes || 0}</td>
                <td className="px-4 py-3 text-center text-text-muted">{stats.day_one_no || 0}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">No data for this period</td>
              </tr>
            )}
            {rows.length > 0 && (
              <tr className="border-t-2 border-border font-bold bg-bg/30">
                <td className="px-4 py-3 text-text-primary">Total</td>
                <td className="px-4 py-3 text-center text-wcs-red">{totalSales}</td>
                <td className="px-4 py-3 text-center text-text-primary">{totalVIPs}</td>
                <td className="px-4 py-3 text-center text-green-600">{totalDayOneYes}</td>
                <td className="px-4 py-3 text-center text-text-muted">{totalDayOneNo}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
